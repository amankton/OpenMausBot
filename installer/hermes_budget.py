"""Chief-owned request admission for the pinned Hermes HTTP runtime.

This is enforcement, not an observer plugin. HTTPX retries each reserve before
transport dispatch. Unsupported native transports fail before an agent request.
No prompts, credentials or provider payloads cross the budget protocol.
"""
import json
import os
import re
import time
from pathlib import Path
from urllib.parse import urlsplit
from urllib.error import HTTPError
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


class BudgetDenied(RuntimeError):
    pass


def identity():
    if os.environ.get("CHIEF_BUDGET_RUN_ID"):
        return os.environ["CHIEF_BUDGET_RUN_ID"], "chief-auxiliary"
    try:
        from gateway.session_context import get_session_env
        return get_session_env("HERMES_SESSION_KEY", ""), get_session_env("HERMES_SESSION_CHAT_ID", "")
    except ImportError:
        return "", ""


def manifest():
    run_id, chat_id = identity()
    if not chat_id.startswith("chief-"):
        return None
    if not re.fullmatch(r"run_[A-Za-z0-9_-]{1,100}", run_id):
        raise BudgetDenied("Missing Chief run identity")
    file = Path(os.environ["HERMES_HOME"]) / "chief-http-bridge" / (run_id + ".json")
    deadline = time.monotonic() + 8
    while True:
        try:
            value = json.loads(file.read_text(encoding="utf-8"))
            break
        except FileNotFoundError:
            if time.monotonic() >= deadline:
                raise BudgetDenied("Chief admission is unavailable") from None
            time.sleep(.025)
    parsed = urlsplit(value["url"])
    if (parsed.scheme != "http" or parsed.hostname != "127.0.0.1" or parsed.username or parsed.password
            or parsed.path != "/runs/" + run_id or parsed.query or parsed.fragment
            or value.get("expires", 0) <= time.time() * 1000):
        raise BudgetDenied("Invalid Chief admission manifest")
    return value


def validate_transport(api_mode):
    value = manifest()
    if value is None and os.environ.get("CHIEF_MANAGED_REQUESTS_ONLY") == "1":
        raise BudgetDenied("Unattributed provider calls are disabled in this managed gateway")
    if value and value.get("budgeted") and api_mode not in {"chat_completions", "anthropic_messages", "codex_responses"}:
        raise BudgetDenied("This provider transport is not admitted for unattended work")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def reserve():
    value = manifest()
    if not value or not value.get("budgeted"):
        return None
    request = Request(value["url"], data=b'{"action":"budget"}', method="POST",
                      headers={"Authorization": "Bearer " + value["token"], "Content-Type": "application/json"})
    try:
        with build_opener(ProxyHandler({}), NoRedirect()).open(request, timeout=5) as response:
            result = json.loads(response.read(8193))
        if result.get("budgeted") is not True or result.get("remainingActiveMs", 0) <= 0:
            raise ValueError()
        return result
    except HTTPError as error:
        error.close()
        raise BudgetDenied("Chief background budget denied or unavailable; no provider request was sent") from None
    except Exception:
        raise BudgetDenied("Chief background budget denied or unavailable; no provider request was sent") from None


def install():
    import httpx
    if getattr(httpx.Client.send, "chief_budget_guard", False):
        return
    original, original_async = httpx.Client.send, httpx.AsyncClient.send

    def bound(request, grant):
        if grant:
            seconds = max(.001, grant["remainingActiveMs"] / 1000)
            existing = request.extensions.get("timeout") or {}
            request.extensions["timeout"] = {key: min(existing.get(key) or seconds, seconds) for key in ("connect", "read", "write", "pool")}

    def send(self, request, *args, **kwargs):
        if os.environ.get("CHIEF_MANAGED_REQUESTS_ONLY") == "1" and request.method == "POST" and not identity()[1].startswith("chief-"):
            raise BudgetDenied("Provider worker lost its Chief context; no request was sent")
        grant = reserve()
        bound(request, grant)
        if grant:
            kwargs["follow_redirects"] = False
        return original(self, request, *args, **kwargs)

    async def send_async(self, request, *args, **kwargs):
        if os.environ.get("CHIEF_MANAGED_REQUESTS_ONLY") == "1" and request.method == "POST" and not identity()[1].startswith("chief-"):
            raise BudgetDenied("Provider worker lost its Chief context; no request was sent")
        # The tiny loopback reservation remains in this thread's ContextVars.
        grant = reserve()
        bound(request, grant)
        if grant:
            kwargs["follow_redirects"] = False
        return await original_async(self, request, *args, **kwargs)

    send.chief_budget_guard = True
    send_async.chief_budget_guard = True
    httpx.Client.send, httpx.AsyncClient.send = send, send_async


install()
