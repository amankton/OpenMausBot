"""Bounded local audio storage and offline transcription for consented meetings."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import struct
import stat
import time
import wave

MAX_BYTES = 256 * 1024 * 1024
MAX_DURATION_MS = 3_600_000
MAX_RETAIN_SECONDS = 72 * 3600
MODEL_REVISION = "0d3d19a32d3338f10357c0889762bd8d64bbdeba"
MODEL_FILES = {
    "model.bin": "1a5afae06a4db91c975c9a9d78be5cc110ee4ea022ad57d55492e4550e936b2a",
    "config.json": "14b1b421a90349bc551b881461426b561a874049cb9e4c4864f2ca384f6a7cc5",
    "tokenizer.json": "929c5252409436dce1b38a75d1abbcb5e132d170d8e324e4e04ed915fa2d22df",
    "vocabulary.txt": "ff77588746d3a2595d32ab5b69ffd7b95ce2441ac57533cb66fc3eb575a115cf",
}


def regular_path(value):
    """Reject links/reparse points before resolving any configured path."""
    path = Path(os.path.abspath(value))
    for parent in (path, *path.parents):
        try:
            info = parent.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise ValueError("Configured paths cannot contain links or reparse points")
    return path


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-zA-Z0-9_-]{1,160}", value):
        raise ValueError("Invalid identifier")
    return value


def session_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value):
        raise ValueError("Invalid session ID")
    return value


def integer(value, maximum):
    if type(value) is not int or not 0 <= value <= maximum:
        raise ValueError("Invalid bound")
    return value


def command_valid(command):
    kind = command.get("kind")
    if kind == "idle":
        return command
    session_id(command.get("sessionId"))
    if kind in ("stop", "delete"):
        return command
    if kind not in ("capture", "transcribe"):
        raise ValueError("Unknown command")
    if integer(command.get("revision"), 1_000_000) < 1:
        raise ValueError("Invalid revision")
    people = command.get("participants")
    if not isinstance(people, list) or not 1 <= len(people) <= 8:
        raise ValueError("Invalid participant snapshot")
    ids = [identifier(p.get("personId")) for p in people]
    if len(set(ids)) != len(ids):
        raise ValueError("Ambiguous participants")
    if kind == "capture":
        identities = [identifier(p.get("identity")) for p in people]
        for person in people:
            identifier(person.get("sid"))
        if len(set(identities)) != len(identities):
            raise ValueError("Ambiguous identities")
        identifier(command.get("identity"))
        identifier(command.get("workspace"))
        identifier(command.get("meetingId"))
        if command.get("roomName") != command["workspace"] + "_" + command["meetingId"]:
            raise ValueError("Room mismatch")
        if not isinstance(command.get("token"), str) or not 1 <= len(command["token"]) <= 8192:
            raise ValueError("Invalid room credential")
        if not time.time() * 1000 < command.get("expiresAt", 0) <= time.time() * 1000 + 15_000:
            raise ValueError("Expired connection")
    else:
        integer(command.get("durationMs"), MAX_DURATION_MS)
        if "token" in command:
            raise ValueError("Retry cannot join a room")
    limits = command.get("limits", {})
    if not 1 <= integer(limits.get("maxBytes"), MAX_BYTES) or not 1 <= integer(limits.get("maxDurationMs"), MAX_DURATION_MS):
        raise ValueError("Invalid limits")
    return command


def verify_model(directory):
    directory = regular_path(directory).resolve(strict=True)
    for name, expected in MODEL_FILES.items():
        path = directory / name
        if path.is_symlink() or not path.is_file():
            raise ValueError("Model file missing")
        with path.open("rb") as stream:
            actual = hashlib.file_digest(stream, "sha256").hexdigest()
        if actual != expected:
            raise ValueError("Model integrity check failed")
    return directory


class AudioStore:
    """Only generated UUID directories and generated track filenames are writable."""

    def __init__(self, root):
        self.root = regular_path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.handles = {}

    def path(self, value):
        path = self.root / session_id(value)
        if path.is_symlink() or (path.exists() and path.resolve().parent != self.root):
            raise ValueError("Unsafe session path")
        return path

    def save(self, data):
        directory = self.path(data["sessionId"])
        directory.mkdir(mode=0o700, exist_ok=True)
        temporary = directory / "session.next"
        if temporary.is_symlink():
            raise ValueError("Unsafe metadata path")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(directory / "session.json")

    def load(self, value):
        path = self.path(value) / "session.json"
        if path.is_symlink() or path.stat().st_size > 256 * 1024:
            raise ValueError("Invalid stored capture")
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("sessionId") != value or not isinstance(data.get("tracks"), list) or len(data["tracks"]) > 128:
            raise ValueError("Invalid stored capture")
        integer(data.get("bytes"), MAX_BYTES)
        integer(data.get("durationMs"), MAX_DURATION_MS)
        return data

    def create(self, command):
        directory = self.path(command["sessionId"])
        if directory.exists():
            raise ValueError("Capture already exists; explicit retry required")
        # Never persist room credentials, participant SIDs or worker secrets.
        data = {"sessionId": command["sessionId"], "revision": command["revision"],
                "createdAt": time.time(), "bytes": 0, "durationMs": 0, "tracks": [],
                "people": [p["personId"] for p in command["participants"]]}
        self.save(data)
        return data

    def track(self, data, person_id, track_id, offset_ms):
        if person_id not in data["people"] or len(data["tracks"]) >= 128:
            raise ValueError("Unknown speaker or track limit")
        identifier(track_id)
        filename = hashlib.sha256((person_id + ":" + track_id).encode()).hexdigest() + ".wav"
        if any(t["file"] == filename for t in data["tracks"]):
            raise ValueError("Duplicate track")
        path = self.path(data["sessionId"]) / filename
        if path.exists() or path.is_symlink():
            raise ValueError("Track already exists")
        output = wave.open(str(path), "wb")
        output.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        # Write an empty header now so interrupted captures are recoverable.
        output.writeframes(b"")
        self.handles[filename] = output
        data["tracks"].append({"file": filename, "personId": person_id,
                               "offsetMs": integer(offset_ms, MAX_DURATION_MS)})
        self.save(data)
        return filename

    def append(self, data, filename, pcm, maximum=MAX_BYTES):
        if len(pcm) % 2 or len(pcm) > 6400 or data["bytes"] + len(pcm) > maximum:
            raise ValueError("Audio quota reached")
        self.handles[filename].writeframes(pcm)
        data["bytes"] += len(pcm)

    def close(self):
        for output in self.handles.values():
            output.close()
        self.handles.clear()

    def delete(self, value):
        directory = self.path(value)
        if not directory.exists():
            return
        files = list(directory.iterdir())
        for path in files:
            if path.is_symlink() or not path.is_file() or not (path.name in ("session.json", "session.next") or re.fullmatch(r"[0-9a-f]{64}\.wav", path.name)):
                raise ValueError("Unexpected capture storage entry")
        for path in files:
            path.unlink()
        directory.rmdir()

    def cleanup(self, active=None):
        removed = 0
        preserved = 0
        for path in self.root.iterdir():
            if path.name == active or not re.fullmatch(r"[0-9a-f-]{36}", path.name):
                continue
            try:
                data = self.load(path.name)
                if time.time() - data["createdAt"] > MAX_RETAIN_SECONDS:
                    self.delete(path.name)
                    removed += 1
            except (ValueError, KeyError, TypeError, OSError):
                # A crash before the first atomic metadata rename must not block
                # unrelated captures. Only known generated files can be removed.
                try:
                    directory = self.path(path.name)
                    entries = list(directory.iterdir())
                    newest = max([directory.stat().st_mtime, *(entry.lstat().st_mtime for entry in entries)])
                    if time.time() - newest <= MAX_RETAIN_SECONDS:
                        preserved += 1
                        continue
                    self.delete(path.name)
                    removed += 1
                except (ValueError, OSError):
                    preserved += 1
        return {"removed": removed, "preservedIncomplete": preserved}


def transcribe(model, store, data, cancelled):
    segments = []
    total_text_bytes = 0
    for track in data["tracks"]:
        if cancelled.is_set():
            raise ValueError("Transcription cancelled")
        if track.get("personId") not in data["people"] or not re.fullmatch(r"[0-9a-f]{64}\.wav", track.get("file", "")):
            raise ValueError("Invalid stored track")
        path = store.path(data["sessionId"]) / track["file"]
        if path.is_symlink() or path.stat().st_size > MAX_BYTES + 44:
            raise ValueError("Invalid audio file")
        # Remove bytes beyond the server's authoritative stop time before ASR.
        # These files are exclusively written by our fixed PCM wave writer.
        with path.open("r+b") as audio:
            header = audio.read(44)
            if len(header) != 44 or header[:4] != b"RIFF" or header[8:16] != b"WAVEfmt " or header[36:40] != b"data" or struct.unpack_from("<IHHIIHH", header, 16) != (16, 1, 1, 16000, 32000, 2, 16):
                raise ValueError("Unexpected audio format")
            available = struct.unpack_from("<I", header, 40)[0]
            allowed = max(0, data["durationMs"] - track["offsetMs"]) * 32
            length = min(available, allowed)
            if length < available:
                audio.truncate(44 + length)
                audio.seek(4)
                audio.write(struct.pack("<I", 36 + length))
                audio.seek(40)
                audio.write(struct.pack("<I", length))
        if length == 0:
            continue
        result, _ = model.transcribe(str(path), language="en", beam_size=3,
                                    vad_filter=True, condition_on_previous_text=False)
        for segment in result:
            if cancelled.is_set():
                raise ValueError("Transcription cancelled")
            text = segment.text.strip()
            start = track["offsetMs"] + round(segment.start * 1000)
            end = min(data["durationMs"], track["offsetMs"] + round(segment.end * 1000))
            if not text or start >= end:
                continue
            total_text_bytes += len(text.encode("utf-8"))
            if len(text) > 4000 or len(segments) >= 2000 or total_text_bytes > 300_000:
                raise ValueError("Transcript exceeds review limit")
            segments.append({"personId": track["personId"], "startMs": start, "endMs": end, "text": text})
    return sorted(segments, key=lambda s: (s["startMs"], s["personId"]))
