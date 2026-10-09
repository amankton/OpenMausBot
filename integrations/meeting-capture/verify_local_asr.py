"""Transcribe generated fixture speech only; never opens a physical device."""
import argparse
import hashlib
import json
from pathlib import Path
import time
import wave

from worker_core import MODEL_FILES, MODEL_REVISION, verify_model

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--wav", required=True)
parser.add_argument("--receipt", required=True)
args = parser.parse_args()
model_path = verify_model(args.model)
with wave.open(args.wav, "rb") as audio:
    assert audio.getnchannels() == 1 and audio.getsampwidth() == 2 and audio.getframerate() == 16000
    duration = audio.getnframes() / audio.getframerate()
    assert 0 < duration < 30
from faster_whisper import WhisperModel
started = time.monotonic()
model = WhisperModel(str(model_path), device="cpu", compute_type="int8", cpu_threads=2,
                     num_workers=1, local_files_only=True)
segments, _ = model.transcribe(args.wav, language="en", beam_size=3, vad_filter=True,
                              condition_on_previous_text=False)
text = " ".join(segment.text.strip() for segment in segments)
assert all(word in text.lower() for word in ("report", "friday", "draft", "tomorrow")), text
receipt = {"verifiedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "result": "passed", "model": "Systran/faster-whisper-tiny.en", "revision": MODEL_REVISION,
           "modelHashes": MODEL_FILES, "engine": "faster-whisper==1.2.1", "cpuThreads": 2,
           "input": "Generated Windows SAPI fixture, no physical input", "durationSeconds": duration,
           "inputSha256": hashlib.sha256(Path(args.wav).read_bytes()).hexdigest(),
           "transcript": text, "elapsedSeconds": round(time.monotonic() - started, 3)}
Path(args.receipt).write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
print(json.dumps(receipt))
