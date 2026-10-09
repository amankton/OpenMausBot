"""Native, listen-only worker. Configuration is a private file, never CLI secrets."""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
from pathlib import Path
import threading
import time
import traceback
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler
import uuid

from worker_core import (AudioStore, MODEL_REVISION, MAX_DURATION_MS, command_valid,
                         transcribe, verify_model, regular_path)


def failure_code(stage, error):
    # No exception messages, paths, tokens or captured content enter logs.
    locations = [f"{Path(frame.filename).name}:{frame.lineno}" for frame in traceback.extract_tb(error.__traceback__)
                 if Path(frame.filename).name in ("worker.py", "worker_core.py")]
    print(json.dumps({"event": stage, "type": type(error).__name__,
                      "status": getattr(error, "code", None), "locations": locations}), flush=True)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args, **_kwargs):
        raise ValueError("Redirect refused")


def loopback_url(value, scheme):
    parsed = urlsplit(value)
    if parsed.scheme != scheme or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("Only local worker endpoints are supported")
    return value.rstrip("/")


class Api:
    def __init__(self, config):
        self.url = loopback_url(config["loveUrl"], "http")
        self.secret = config["workerSecret"]
        if not isinstance(self.secret, str) or len(self.secret) < 32:
            raise ValueError("Worker credential is not configured")
        self.opener = build_opener(NoRedirect(), ProxyHandler({}))

    def _request(self, route, body):
        raw = json.dumps(body).encode()
        if len(raw) > 512 * 1024:
            raise ValueError("Worker request exceeds limit")
        request = Request(self.url + "/capture/worker/" + route, data=raw,
                          headers={"Authorization": "Bearer " + self.secret,
                                   "Content-Type": "application/json"})
        with self.opener.open(request, timeout=3) as response:
            raw = response.read(600_000)
            if len(raw) >= 600_000:
                raise ValueError("Worker response exceeds limit")
            return json.loads(raw) if raw else {}

    async def request(self, route, body):
        return await asyncio.to_thread(self._request, route, body)


class Worker:
    def __init__(self, config, model):
        self.api = Api(config)
        self.rtc_url = loopback_url(config["livekitUrl"], "ws")
        self.store = AudioStore(config["audioDirectory"])
        self.model = model
        self.worker_id = "native-" + str(uuid.uuid4())
        self.command = None
        self.data = None
        self.room = None
        self.phase = "idle"
        self.lease = 0.0
        self.started = 0.0
        self.readers = set()
        self.subscribed = set()
        self.capture_stop = asyncio.Event()
        self.cancelled = threading.Event()
        self.job = None
        self.stopping = False
        self.stop_path = Path(config["audioDirectory"]).parent / "stop.request"

    def known(self, participant):
        return next((p for p in self.command["participants"] if p["identity"] == participant.identity and p["sid"] == participant.sid), None)

    def duration(self):
        return min(self.command["limits"]["maxDurationMs"], max(0, round((time.monotonic() - self.started) * 1000))) if self.started else 0

    async def event(self, kind, **fields):
        return await self.api.request("event", {"workerId": self.worker_id,
            "sessionId": self.command["sessionId"], "revision": self.command["revision"],
            "type": kind, **fields})

    async def read_track(self, track, publication, participant):
        from livekit import rtc
        stream = None
        try:
            person = self.known(participant)
            if person is None or publication.source != rtc.TrackSource.SOURCE_MICROPHONE:
                raise ValueError("Unknown audio source")
            name = self.store.track(self.data, person["personId"], publication.sid, self.duration())
            offset = self.duration()
            written_samples = 0
            stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1, capacity=100, frame_size_ms=20)
            async for event in stream:
                if self.capture_stop.is_set() or time.monotonic() >= self.lease or self.duration() >= self.command["limits"]["maxDurationMs"]:
                    self.capture_stop.set()
                    break
                pcm = bytes(event.frame.data)
                # Muting or discontinuous transmission must not collapse timestamps.
                # Allow a small jitter window; fill longer gaps with bounded silence.
                expected_samples = max(0, (self.duration() - offset) * 16 - len(pcm) // 2)
                gap = expected_samples - written_samples
                if gap > 3200:
                    while gap > 0:
                        if self.capture_stop.is_set() or time.monotonic() >= self.lease:
                            self.capture_stop.set()
                            return
                        count = min(gap, 3200)
                        self.store.append(self.data, name, bytes(count * 2), self.command["limits"]["maxBytes"])
                        gap -= count
                        written_samples += count
                        await asyncio.sleep(0)
                if self.capture_stop.is_set() or time.monotonic() >= self.lease:
                    self.capture_stop.set()
                    return
                self.store.append(self.data, name, pcm, self.command["limits"]["maxBytes"])
                written_samples += len(pcm) // 2
        except Exception as error:
            failure_code("capture_track_failed", error)
            self.capture_stop.set()
        finally:
            if stream is not None:
                await stream.aclose()

    async def disconnect(self):
        self.capture_stop.set()
        try:
            if self.room is not None:
                await asyncio.wait_for(self.room.disconnect(), timeout=4)
        finally:
            self.room = None
            readers = list(self.readers)
            for task in readers:
                task.cancel()
            try:
                if readers:
                    await asyncio.gather(*readers, return_exceptions=True)
            finally:
                self.readers.clear()
                self.store.close()

    async def capture(self):
        from livekit import rtc
        self.data = self.store.create(self.command)
        self.room = rtc.Room()
        connected = False
        try:
            @self.room.on("participant_connected")
            def joined(person):
                if self.known(person) is None:
                    self.capture_stop.set()

            @self.room.on("participant_disconnected")
            def left(_person):
                self.capture_stop.set()

            @self.room.on("reconnecting")
            def reconnecting():
                self.capture_stop.set()

            @self.room.on("disconnected")
            def disconnected(_reason):
                self.capture_stop.set()

            @self.room.on("track_published")
            def published(publication, person):
                if self.known(person) is None:
                    self.capture_stop.set()
                elif connected and not self.capture_stop.is_set() and publication.source == rtc.TrackSource.SOURCE_MICROPHONE and publication.kind == rtc.TrackKind.KIND_AUDIO:
                    publication.set_subscribed(True)

            @self.room.on("track_subscribed")
            def subscribed(track, publication, person):
                if not connected or self.capture_stop.is_set() or publication.sid in self.subscribed:
                    publication.set_subscribed(False)
                    return
                self.subscribed.add(publication.sid)
                task = asyncio.create_task(self.read_track(track, publication, person))
                self.readers.add(task)
                task.add_done_callback(self.readers.discard)

            await asyncio.wait_for(self.room.connect(self.rtc_url, self.command["token"], rtc.RoomOptions(auto_subscribe=False)), timeout=7)
            people = list(self.room.remote_participants.values())
            if self.capture_stop.is_set() or len(people) != len(self.command["participants"]) or any(self.known(p) is None for p in people):
                raise ValueError("Attendance changed before connection")
            await self.event("connected")
            self.started = time.monotonic()
            self.phase = "capturing"
            connected = True
            for person in people:
                for publication in person.track_publications.values():
                    published(publication, person)
            while not self.capture_stop.is_set():
                if time.monotonic() >= self.lease or self.duration() >= self.command["limits"]["maxDurationMs"]:
                    break
                await asyncio.sleep(0.1)
        finally:
            self.data["durationMs"] = self.duration()
            await self.disconnect()
            self.store.save(self.data)
        self.phase = "stopping"
        acknowledgment = await self.event("stopped", durationMs=self.data["durationMs"], bytes=self.data["bytes"])
        duration = acknowledgment.get("durationMs")
        if type(duration) is not int or not 0 <= duration <= self.data["durationMs"]:
            raise ValueError("Authoritative stop time missing")
        self.data["durationMs"] = duration
        self.store.save(self.data)
        await self.process()

    async def process(self):
        self.phase = "processing"
        if self.data is None:
            self.data = self.store.load(self.command["sessionId"])
            if self.data["revision"] != self.command["revision"] or set(self.data["people"]) != {p["personId"] for p in self.command["participants"]}:
                raise ValueError("Stored capture does not match retry")
            self.data["durationMs"] = min(self.data["durationMs"], self.command["durationMs"])
        result = await asyncio.to_thread(transcribe, self.model, self.store, self.data, self.cancelled)
        if self.cancelled.is_set():
            raise ValueError("Transcription cancelled")
        # Successful server acknowledgment is required before removing raw audio.
        await self.event("transcript", segments=result)
        self.store.delete(self.command["sessionId"])

    async def run_job(self, command):
        self.command = command
        self.data = None
        self.started = 0.0
        self.phase = "starting" if command["kind"] == "capture" else "processing"
        self.capture_stop.clear()
        self.cancelled.clear()
        self.subscribed.clear()
        try:
            if command["kind"] == "capture":
                await self.capture()
            else:
                await self.process()
        except Exception as error:
            failure_code("capture_job_failed", error)
            try:
                await self.event("failed")
            except Exception:
                pass
        finally:
            await self.disconnect()
            self.command = None
            self.data = None
            self.phase = "idle"

    async def poll(self):
        body = {"workerId": self.worker_id, "ready": self.job is None or self.job.done(),
                "model": "tiny.en@" + MODEL_REVISION}
        if self.command:
            body.update(activeSessionId=self.command["sessionId"], phase=self.phase)
            if self.data is not None:
                body.update(bytes=self.data["bytes"], durationMs=self.duration() if self.phase == "capturing" else self.data["durationMs"])
                if self.phase == "capturing":
                    self.data["durationMs"] = body["durationMs"]
                    self.store.save(self.data)
        sent = time.monotonic()
        response = await self.api.request("poll", body)
        # Use a monotonic local lease; never extend beyond the server's lease.
        remaining = (response["leaseUntil"] - response["serverTime"]) / 1000
        if not 0 < remaining <= 10:
            raise ValueError("Invalid lease")
        self.lease = sent + remaining - 0.5
        if self.lease <= time.monotonic():
            raise ValueError("Lease expired in transit")
        command = command_valid(response["command"])
        kind = command["kind"]
        if kind == "delete":
            if self.command and self.command["sessionId"] == command["sessionId"]:
                self.capture_stop.set()
                self.cancelled.set()
                return  # A later poll acknowledges deletion after the job releases files.
            self.store.delete(command["sessionId"])
            await self.api.request("event", {"workerId": self.worker_id, "sessionId": command["sessionId"], "revision": command["revision"], "type": "deleted"})
        elif kind == "stop" and self.command and self.command["sessionId"] == command["sessionId"]:
            self.capture_stop.set()
            # A stop response to an earlier capture heartbeat may arrive after
            # stopped acknowledgment. It ends listening, not authorized ASR.
            if self.phase == "processing" and body.get("phase") == "processing":
                self.cancelled.set()
        elif kind in ("capture", "transcribe") and (self.job is None or self.job.done()):
            self.job = asyncio.create_task(self.run_job(command))

    async def run(self):
        self.store.cleanup()
        print("capture_worker_ready", flush=True)
        cleanup_at = time.monotonic()
        try:
            while not self.stopping:
                if self.stop_path.exists():
                    break
                try:
                    await self.poll()
                except Exception:
                    # A failed authorization or transport check stops listening immediately.
                    self.capture_stop.set()
                    if self.phase == "processing":
                        self.cancelled.set()
                if time.monotonic() - cleanup_at > 60:
                    self.store.cleanup(self.command["sessionId"] if self.command else None)
                    cleanup_at = time.monotonic()
                await asyncio.sleep(1)
        finally:
            self.capture_stop.set()
            self.cancelled.set()
            await self.disconnect()
            if self.job:
                await asyncio.gather(self.job, return_exceptions=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    logging.disable(logging.CRITICAL)
    path = regular_path(args.config)
    if path.stat().st_size > 16384:
        raise ValueError("Invalid worker configuration")
    config = json.loads(path.read_text(encoding="utf-8-sig"))
    # OS-held lock survives errors without leaving a stale PID lock to bypass.
    # This process is Windows-only because its media transport is native loopback.
    if os.name != "nt":
        raise ValueError("This worker requires the reviewed native Windows transport")
    import msvcrt
    lock_path = path.parent / "worker.lock"
    if lock_path.is_symlink():
        raise ValueError("Unsafe lock path")
    with lock_path.open("a+b") as lock:
        lock.seek(0, 2)
        if lock.tell() == 0:
            lock.write(b"0")
            lock.flush()
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        run_config(config)


def run_config(config):
    model_path = verify_model(config["modelDirectory"])
    from faster_whisper import WhisperModel
    model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=2,
                         num_workers=1, local_files_only=True)
    asyncio.run(Worker(config, model).run())


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        print("capture_worker_unavailable", flush=True)
        raise SystemExit(1)
