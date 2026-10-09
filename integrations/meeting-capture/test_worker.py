import copy
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from types import SimpleNamespace
import uuid

from worker_core import AudioStore, MAX_BYTES, MAX_DURATION_MS, command_valid, transcribe
from worker import loopback_url, Worker


def command():
    return {"kind": "capture", "sessionId": str(uuid.uuid4()), "revision": 1,
            "workspace": "fixture", "meetingId": "meeting", "roomName": "fixture_meeting",
            "identity": "chief-capture-fixture", "token": "fixture-token", "expiresAt": time.time() * 1000 + 9000,
            "participants": [{"personId": "person1", "identity": "person1", "sid": "PA_one", "name": "Fixture"}],
            "limits": {"maxBytes": MAX_BYTES, "maxDurationMs": MAX_DURATION_MS}}


class WorkerTests(unittest.TestCase):
    def test_capture_requires_bounded_exact_roster_and_room(self):
        original = command()
        self.assertEqual(command_valid(original), original)
        for field, value in [("roomName", "different"), ("revision", True), ("expiresAt", 0), ("sessionId", "../escape")]:
            bad = copy.deepcopy(original)
            bad[field] = value
            with self.assertRaises(ValueError):
                command_valid(bad)
        bad = copy.deepcopy(original)
        bad["participants"] *= 2
        with self.assertRaises(ValueError):
            command_valid(bad)

    def test_transcription_retry_cannot_have_room_token(self):
        value = command()
        value.update(kind="transcribe", durationMs=2000)
        with self.assertRaises(ValueError):
            command_valid(value)
        del value["token"]
        self.assertEqual(command_valid(value)["kind"], "transcribe")

    def test_worker_endpoints_are_local_and_have_no_credentials(self):
        self.assertEqual(loopback_url("http://localhost:18087/_love", "http"), "http://localhost:18087/_love")
        for value in ["https://example.com", "http://localhost@evil.test", "http://localhost/?token=secret", "file:///tmp/test", "http://localhost/#secret"]:
            with self.assertRaises(ValueError):
                loopback_url(value, "http")

    def test_snapshot_requires_exact_livekit_session(self):
        worker = object.__new__(Worker)
        worker.command = command()
        self.assertIsNotNone(worker.known(SimpleNamespace(identity="person1", sid="PA_one")))
        self.assertIsNone(worker.known(SimpleNamespace(identity="person1", sid="PA_reconnected")))
        self.assertIsNone(worker.known(SimpleNamespace(identity="latejoin", sid="PA_two")))

    def test_storage_quota_provenance_and_selective_deletion(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            job = command()
            data = store.create(job)
            path = store.path(job["sessionId"])
            self.assertNotIn("token", (path / "session.json").read_text())
            track = store.track(data, "person1", "TR_fixture", 0)
            store.append(data, track, bytes(640), 640)
            with self.assertRaises(ValueError):
                store.append(data, track, bytes(2), 640)
            with self.assertRaises(ValueError):
                store.track(data, "outsider", "TR_two", 0)
            store.close()
            store.save(data)
            self.assertEqual(store.load(job["sessionId"])["bytes"], 640)
            sibling = Path(temporary) / "unrelated.txt"
            sibling.write_text("untouched")
            store.delete(job["sessionId"])
            self.assertFalse(path.exists())
            self.assertEqual(sibling.read_text(), "untouched")
            with self.assertRaises(ValueError):
                store.path("../outside")

    def test_existing_capture_cannot_restart_without_consent(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            job = command()
            store.create(job)
            with self.assertRaises(ValueError):
                store.create(job)

    def test_unexpected_file_blocks_delete(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            data = store.create(command())
            (store.path(data["sessionId"]) / "unrelated.txt").write_text("keep")
            with self.assertRaises(ValueError):
                store.delete(data["sessionId"])

    def test_failed_audio_expires_after_72_hours(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            data = store.create(command())
            data["createdAt"] -= 73 * 3600
            store.save(data)
            store.cleanup(active=data["sessionId"])
            self.assertTrue(store.path(data["sessionId"]).exists())
            store.cleanup()
            self.assertFalse(store.path(data["sessionId"]).exists())

    def test_interrupted_metadata_does_not_block_other_cleanup(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            unfinished = store.path(command()["sessionId"])
            unfinished.mkdir()
            (unfinished / "session.next").write_text("incomplete")
            data = store.create(command())
            data["createdAt"] -= 73 * 3600
            store.save(data)
            result = store.cleanup()
            self.assertEqual(result, {"removed": 1, "preservedIncomplete": 1})
            self.assertTrue(unfinished.exists())

    def test_transcription_attributes_tracks_and_bounds_offsets(self):
        class Model:
            def transcribe(self, _path, **options):
                self.options = options
                return iter([SimpleNamespace(start=0.1, end=2.0, text=" We agreed to test. ")]), None
        with tempfile.TemporaryDirectory() as temporary:
            store = AudioStore(temporary)
            data = store.create(command())
            track = store.track(data, "person1", "TR_fixture", 500)
            store.append(data, track, bytes(640))
            store.close()
            data["durationMs"] = 2000
            model = Model()
            result = transcribe(model, store, data, threading.Event())
            self.assertEqual(result, [{"personId": "person1", "startMs": 600, "endMs": 2000, "text": "We agreed to test."}])
            self.assertTrue(model.options["vad_filter"])
            cancelled = threading.Event()
            cancelled.set()
            with self.assertRaises(ValueError):
                transcribe(model, store, data, cancelled)


if __name__ == "__main__":
    unittest.main()
