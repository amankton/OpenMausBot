"""Run the exported, patched Hermes agent against owned synthetic HTTP only.

Call with a Python environment containing the pinned Hermes dependencies and
PYTHONPATH pointing at the exported payload. All profile/cache state is temporary.
"""
import json
import os
import sys
import socket
import subprocess
from pathlib import Path
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

if "--worker" not in sys.argv:
    # The parent removes the fixture only after Windows logging handles close.
    with tempfile.TemporaryDirectory(prefix="chief-hermes-runtime-fixture-") as folder:
        result = subprocess.run([sys.executable, __file__, "--worker", folder], check=False)
    raise SystemExit(result.returncode)

home = Path(sys.argv[sys.argv.index("--worker") + 1])
allowed = {"PATH", "PYTHONPATH", "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT", "TEMP", "TMP", "LANG"}
for key in list(os.environ):
    if key.upper() not in allowed:
        del os.environ[key]
sys.dont_write_bytecode = True
source = Path(os.environ["PYTHONPATH"]).resolve()
sys.path.insert(0, str(source))
os.environ["HERMES_HOME"] = str(home)
os.environ["CHIEF_MANAGED_REQUESTS_ONLY"] = "1"
for name in ["HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CACHE_HOME", "XDG_CONFIG_HOME"]:
    os.environ[name] = str(home)
reservations, generations = [], []
original_lookup = socket.getaddrinfo


def loopback_only(host, *args, **kwargs):
    if host not in {"127.0.0.1", "localhost", "::1", b"127.0.0.1", b"localhost"}:
        raise OSError("External network access is forbidden in this fixture")
    return original_lookup(host, *args, **kwargs)


socket.getaddrinfo = loopback_only


class Synthetic(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.startswith("/runs/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            assert body == {"action": "budget"}
            reservations.append(1)
            self.wfile.write(json.dumps({"budgeted": True, "remainingActiveMs": 60000, "remainingRequests": 20 - len(reservations)}).encode())
        else:
            if not any(key in body for key in ("messages", "input", "prompt")):
                self.send_response(404)
                self.end_headers()
                return
            generations.append(1)
            assert len(reservations) >= len(generations), "Unreserved provider dispatch"
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream" if body.get("stream") else "application/json")
            self.end_headers()
            if body.get("stream"):
                for delta, reason in [({"role": "assistant", "content": "CHIEF_BUDGET_FIXTURE_OK"}, None), ({}, "stop")]:
                    self.wfile.write(("data: " + json.dumps({"id": "synthetic", "object": "chat.completion.chunk", "created": 1, "model": "synthetic-fixture", "choices": [{"index": 0, "delta": delta, "finish_reason": reason}]}) + "\n\n").encode())
                self.wfile.write(b"data: [DONE]\n\n")
            else:
                self.wfile.write(json.dumps({"id": "synthetic", "object": "chat.completion", "created": 1, "model": "synthetic-fixture", "choices": [{"index": 0, "message": {"role": "assistant", "content": "CHIEF_BUDGET_FIXTURE_OK"}, "finish_reason": "stop"}], "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}}).encode())


server = ThreadingHTTPServer(("127.0.0.1", 0), Synthetic)
worker = threading.Thread(target=server.serve_forever, daemon=True)
worker.start()
try:
    bridge = home / "chief-http-bridge"
    bridge.mkdir()
    (bridge / "run_fixture.json").write_text(json.dumps({"url": f"http://127.0.0.1:{server.server_port}/runs/run_fixture", "token": "synthetic-capability", "budgeted": True, "expires": time.time() * 1000 + 120000}))
    from gateway.session_context import set_session_vars, clear_session_vars
    from run_agent import AIAgent
    import run_agent
    assert Path(run_agent.__file__).resolve().is_relative_to(source), "The exported Hermes source must be loaded"
    tokens = set_session_vars(platform="api_server", chat_id="chief-fixture", session_key="run_fixture", session_id="chief-fixture", cwd=str(home))
    agent = AIAgent(base_url=f"http://127.0.0.1:{server.server_port}/v1", api_key="synthetic-fixture", provider="custom", api_mode="chat_completions", model="synthetic-fixture", enabled_toolsets=[], disabled_toolsets=["all"], max_iterations=2, quiet_mode=True, skip_context_files=True, skip_memory=True, skip_background_review=True, cwd=str(home), session_id="chief-fixture", platform="api_server")
    try:
        result = agent.run_conversation("Return the synthetic fixture string.")
        assert "CHIEF_BUDGET_FIXTURE_OK" in str(result), "Actual Hermes did not complete the synthetic turn"
        assert generations and len(reservations) >= len(generations)
        print(json.dumps({"passed": True, "actualPatchedHermesAgent": True, "ownedSyntheticHttpOnly": True, "providerGenerations": len(generations), "durableBrokerReservations": len(reservations)}))
    finally:
        agent.close()
        clear_session_vars(tokens)
finally:
    server.shutdown()
    server.server_close()
    worker.join()
