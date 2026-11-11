import asyncio
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import httpx
import hermes_budget as guard


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="chief-budget-python-")
        self.home = Path(self.temp.name)
        self.used = 0
        self.dispatched = 0
        self.accept = True
        owner = self

        class Broker(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                valid = self.headers.get("Authorization") == "Bearer synthetic-capability" and body == {"action": "budget"}
                allowed = valid and owner.accept and owner.used < 20
                owner.used += int(allowed)
                self.send_response(200 if allowed else 403)
                self.end_headers()
                self.wfile.write(json.dumps({"budgeted": allowed, "remainingActiveMs": 1000, "remainingRequests": 20 - owner.used}).encode())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Broker)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        folder = self.home / "chief-http-bridge"
        folder.mkdir()
        (folder / "run_fixture.json").write_text(json.dumps({"url": f"http://127.0.0.1:{self.server.server_port}/runs/run_fixture", "token": "synthetic-capability", "budgeted": True, "expires": time.time() * 1000 + 60000}))
        self.environment = patch.dict(os.environ, {"HERMES_HOME": str(self.home), "CHIEF_MANAGED_REQUESTS_ONLY": "1"})
        self.identity = patch.object(guard, "identity", return_value=("run_fixture", "chief-fixture"))
        self.environment.start()
        self.identity.start()

    def tearDown(self):
        self.identity.stop()
        self.environment.stop()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.temp.cleanup()

    def transport(self, request):
        self.dispatched += 1
        self.assertLessEqual(request.extensions["timeout"]["read"], 1)
        return httpx.Response(200, json={"ok": True})

    def test_sync_and_async_physical_requests_share_the_broker(self):
        with httpx.Client(transport=httpx.MockTransport(self.transport)) as client:
            client.post("http://fixture.invalid/v1/chat/completions", json={"model": "fixture"})

        async def call():
            async with httpx.AsyncClient(transport=httpx.MockTransport(self.transport)) as client:
                await client.post("http://fixture.invalid/v1/messages", json={"model": "fixture"})
        asyncio.run(call())
        self.assertEqual((self.used, self.dispatched), (2, 2))

    def test_denied_reservation_sends_no_provider_request(self):
        self.accept = False
        with httpx.Client(transport=httpx.MockTransport(self.transport)) as client:
            with self.assertRaises(guard.BudgetDenied):
                client.post("http://fixture.invalid/v1/responses", json={})
        self.assertEqual(self.dispatched, 0)

    def test_unknown_network_outcome_is_still_charged(self):
        def uncertain(request):
            raise httpx.ConnectError("Synthetic unknown response")
        with httpx.Client(transport=httpx.MockTransport(uncertain)) as client:
            with self.assertRaises(httpx.ConnectError):
                client.post("http://fixture.invalid/v1/chat/completions", json={})
        self.assertEqual(self.used, 1)

    def test_unsupported_and_unattributed_calls_fail_closed(self):
        with self.assertRaises(guard.BudgetDenied):
            guard.validate_transport("bedrock_converse")
        with patch.object(guard, "identity", return_value=("", "")):
            with self.assertRaises(guard.BudgetDenied):
                guard.validate_transport("chat_completions")
            with httpx.Client(transport=httpx.MockTransport(self.transport)) as client:
                with self.assertRaises(guard.BudgetDenied):
                    client.post("http://fixture.invalid/v1/messages", json={})
        self.assertEqual(self.dispatched, 0)

    def test_twenty_first_physical_call_is_refused(self):
        with httpx.Client(transport=httpx.MockTransport(self.transport)) as client:
            for _ in range(20):
                client.post("http://fixture.invalid/v1/messages", json={})
            with self.assertRaises(guard.BudgetDenied):
                client.post("http://fixture.invalid/v1/messages", json={})
        self.assertEqual((self.used, self.dispatched), (20, 20))

    def test_official_sdk_retries_reserve_each_physical_attempt(self):
        from openai import OpenAI
        def retry(request):
            self.dispatched += 1
            if self.dispatched == 1:
                return httpx.Response(500, json={"error": {"message": "Synthetic temporary error"}})
            return httpx.Response(200, json={"id": "fixture", "object": "chat.completion", "created": 1, "model": "fixture", "choices": [{"index": 0, "message": {"role": "assistant", "content": "synthetic"}, "finish_reason": "stop"}]})
        with OpenAI(api_key="synthetic", base_url="http://fixture.invalid/v1", max_retries=1, http_client=httpx.Client(transport=httpx.MockTransport(retry))) as client:
            response = client.chat.completions.create(model="fixture", messages=[{"role": "user", "content": "synthetic"}])
            self.assertEqual(response.choices[0].message.content, "synthetic")
        self.assertEqual((self.used, self.dispatched), (2, 2))


if __name__ == "__main__":
    unittest.main()
