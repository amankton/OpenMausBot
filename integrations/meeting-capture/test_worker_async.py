"""Synthetic async lifecycle tests: no SDK connection, model or physical device."""
import asyncio
import sys
import tempfile
import time
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import AsyncMock, Mock, patch

from worker import Worker


class FakeAudioStream:
    instances = []

    def __init__(self, _track, **_options):
        self.closed = False
        self.sent = False
        self.instances.append(self)

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.sent:
            raise StopAsyncIteration
        self.sent = True
        return SimpleNamespace(frame=SimpleNamespace(data=b"\x01\x00" * 320))

    async def aclose(self):
        self.closed = True


class AsyncWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.worker = Worker({"loveUrl": "http://localhost:18087/_love",
                              "livekitUrl": "ws://localhost:18087/_livekit",
                              "workerSecret": "synthetic-key-not-real-" * 3,
                              "audioDirectory": self.temporary.name}, None)
        self.worker.store = SimpleNamespace(track=Mock(return_value="track"), append=Mock(),
                                            close=Mock(), cleanup=Mock(), save=Mock())
        self.worker.command = {"sessionId": "synthetic", "revision": 1,
                               "participants": [{"personId": "a", "identity": "a", "sid": "sid-a"}],
                               "limits": {"maxDurationMs": 3600000, "maxBytes": 268435456}}
        self.worker.data = {"bytes": 0, "durationMs": 0}
        self.worker.lease = time.monotonic() + 100
        self.person = SimpleNamespace(identity="a", sid="sid-a")
        self.publication = SimpleNamespace(source="mic", sid="track-a")
        FakeAudioStream.instances = []
        sdk = ModuleType("livekit")
        sdk.rtc = SimpleNamespace(AudioStream=FakeAudioStream,
                                  TrackSource=SimpleNamespace(SOURCE_MICROPHONE="mic"))
        self.sdk = patch.dict(sys.modules, {"livekit": sdk})
        self.sdk.start()
        self.addCleanup(self.sdk.stop)

    async def test_disconnect_failure_still_cancels_readers_and_closes_files(self):
        finished = asyncio.Event()

        async def reader():
            try:
                await asyncio.Event().wait()
            finally:
                finished.set()

        task = asyncio.create_task(reader())
        await asyncio.sleep(0)
        self.worker.readers.add(task)
        self.worker.room = SimpleNamespace(disconnect=AsyncMock(side_effect=RuntimeError("synthetic RTC failure")))
        with self.assertRaisesRegex(RuntimeError, "synthetic RTC failure"):
            await self.worker.disconnect()
        self.assertTrue(finished.is_set())
        self.assertTrue(task.cancelled())
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertIsNone(self.worker.room)
        self.assertEqual(self.worker.readers, set())
        self.worker.store.close.assert_called_once()

    async def test_expired_lease_writes_no_pcm_and_closes_stream(self):
        self.worker.lease = 0
        self.worker.duration = Mock(return_value=0)
        await self.worker.read_track(object(), self.publication, self.person)
        self.worker.store.append.assert_not_called()
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertTrue(FakeAudioStream.instances[0].closed)

    async def test_stop_during_gap_yields_and_never_writes_real_frame(self):
        values = iter([0, 0])
        self.worker.duration = lambda: next(values, 5000)

        def append(_data, _name, pcm, _limit):
            self.assertEqual(pcm, bytes(len(pcm)))
            asyncio.get_running_loop().call_soon(self.worker.capture_stop.set)
            asyncio.get_running_loop().call_soon(self.worker.cancelled.set)

        self.worker.store.append.side_effect = append
        await self.worker.read_track(object(), self.publication, self.person)
        self.assertEqual(self.worker.store.append.call_count, 1)
        self.assertTrue(self.worker.cancelled.is_set())
        self.assertTrue(FakeAudioStream.instances[0].closed)

    async def test_lease_expiring_mid_gap_never_writes_real_frame(self):
        values = iter([0, 0])
        self.worker.duration = lambda: next(values, 5000)

        def expire(*_args):
            self.worker.lease = 0

        self.worker.store.append.side_effect = expire
        await self.worker.read_track(object(), self.publication, self.person)
        self.assertEqual(self.worker.store.append.call_count, 1)
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertTrue(FakeAudioStream.instances[0].closed)

    async def test_quota_exception_stops_and_closes_stream(self):
        self.worker.duration = Mock(return_value=0)
        self.worker.store.append.side_effect = ValueError("Audio quota reached")
        await self.worker.read_track(object(), self.publication, self.person)
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertTrue(FakeAudioStream.instances[0].closed)

    async def test_failed_poll_cancels_processing_and_closes_store(self):
        self.worker.phase = "processing"
        self.worker.poll = AsyncMock(side_effect=RuntimeError("authorization failed"))

        async def finish_loop(_seconds):
            self.worker.stopping = True

        with patch("worker.asyncio.sleep", finish_loop):
            await self.worker.run()
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertTrue(self.worker.cancelled.is_set())
        self.worker.store.close.assert_called_once()

    async def test_lease_expired_in_transit_does_not_start_job(self):
        self.worker.command = None
        clock = SimpleNamespace(value=100.0)

        async def response(_route, _body):
            clock.value = 111.0
            return {"serverTime": 100000, "leaseUntil": 110000, "command": {"kind": "idle"}}

        self.worker.api = SimpleNamespace(request=response)
        # Replace only worker's module binding, never asyncio's real monotonic clock.
        with patch("worker.time", SimpleNamespace(monotonic=lambda: clock.value)):
            with self.assertRaisesRegex(ValueError, "expired in transit"):
                await self.worker.poll()
        self.assertIsNone(self.worker.job)

    async def test_delayed_capture_stop_does_not_cancel_acknowledged_processing(self):
        self.worker.command["sessionId"] = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        self.worker.phase = "stopping"

        async def response(_route, body):
            self.assertEqual(body["phase"], "stopping")
            self.worker.phase = "processing"
            return {"serverTime": 100000, "leaseUntil": 110000,
                    "command": {"kind": "stop", "sessionId": self.worker.command["sessionId"]}}

        self.worker.api = SimpleNamespace(request=response)
        await self.worker.poll()
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertFalse(self.worker.cancelled.is_set())

    async def test_processing_authorization_stop_still_cancels_asr(self):
        self.worker.command["sessionId"] = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
        self.worker.phase = "processing"
        self.worker.api = SimpleNamespace(request=AsyncMock(return_value={
            "serverTime": 100000, "leaseUntil": 110000,
            "command": {"kind": "stop", "sessionId": self.worker.command["sessionId"]}}))
        await self.worker.poll()
        self.assertTrue(self.worker.capture_stop.is_set())
        self.assertTrue(self.worker.cancelled.is_set())


if __name__ == "__main__":
    unittest.main()
