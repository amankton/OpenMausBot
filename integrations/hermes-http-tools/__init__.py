"""Hermes plugin API only: no core patches or ACP transport.

The run identity comes from Hermes contextvars, never model-provided arguments.
Chief retains the VM lease, MCP credentials, approval cards and tool execution.
"""
import json
import re
import time
import uuid
from pathlib import Path
from urllib.error import URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler, ProxyHandler


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _identity():
    from gateway.session_context import get_session_env
    return get_session_env("HERMES_SESSION_KEY", ""), get_session_env("HERMES_SESSION_CHAT_ID", "")


def _directory(ctx):
    from hermes_constants import get_hermes_home
    return Path(ctx.get_config("bridge_dir", str(get_hermes_home() / "chief-http-bridge")))


def _request(directory, run_id, body, timeout=900):
    if not re.fullmatch(r"run_[A-Za-z0-9_-]{1,100}", run_id):
        raise ValueError("No active Hermes run context")
    manifest = json.loads((directory / (run_id + ".json")).read_text(encoding="utf-8"))
    url = urlsplit(manifest["url"])
    if (url.scheme != "http" or url.hostname != "127.0.0.1" or url.username or url.password
            or url.path != "/runs/" + run_id or url.query or url.fragment
            or manifest.get("expires", 0) <= time.time() * 1000):
        raise ValueError("Invalid or expired Chief bridge")
    req = Request(manifest["url"], data=json.dumps(body).encode(), method="POST",
                  headers={"Authorization": "Bearer " + manifest["token"], "Content-Type": "application/json"})
    # Never forward the broker credential through environment proxies/redirects.
    opener = build_opener(ProxyHandler({}), _NoRedirect())
    with opener.open(req, timeout=timeout) as response:
        data = response.read(40 * 1024 * 1024 + 1)
        if len(data) > 40 * 1024 * 1024:
            raise ValueError("Chief tool result exceeds limit")
        return json.loads(data)


def _result(payload):
    images = payload.get("images") or []
    if images:
        return {"_multimodal": True, "text_summary": payload.get("text", "Tool image result"),
                "content": [{"type": "text", "text": payload.get("text", "Tool image result")}, *images]}
    return json.dumps(payload, ensure_ascii=False)


def register(ctx):
    def handle(args, session_id="", tool_call_id="", **kwargs):
        run_id, chat_id = _identity()
        if not chat_id.startswith("chief-"):
            return json.dumps({"error": "Chief tools are available only in an active Chief chat"})
        action = args.get("action")
        if action not in {"list", "describe", "call", "attachments"}:
            return json.dumps({"error": "Use list, describe, call or attachments"})
        try:
            return _result(_request(_directory(ctx), run_id, {
                "action": action, "name": args.get("name"), "arguments": args.get("arguments", {}),
                # Current Hermes registry forwards session/task identity but
                # not tool_call_id to standalone handlers. This invocation's
                # UUID stays fixed for its one HTTP operation; we never retry
                # an uncertain operation automatically.
                "call_id": tool_call_id or uuid.uuid4().hex}))
        except (OSError, URLError, ValueError, KeyError, TypeError):
            return json.dumps({"error": "Chief tool bridge unavailable or turn ended. Do not substitute host tools for the assigned VM."})

    def authorize(tool_name="", args=None, **kwargs):
        run_id, chat_id = _identity()
        if not chat_id.startswith("chief-") or tool_name == "chief_tools":
            return None
        try:
            result = _request(_directory(ctx), run_id, {"action": "authorize", "name": tool_name}, timeout=2)
            if not result.get("allowed"):
                return {"action": "block", "message": "This Chief chat's tool selection does not permit this tool. Use chief_tools for its assigned tools."}
            if result.get("approval"):
                return {"action": "approve", "message": "Chief requires approval for this native Hermes tool", "rule_key": tool_name}
            return None
        except (OSError, URLError, ValueError, KeyError, TypeError):
            return {"action": "block", "message": "Chief turn authorization is unavailable; no tool may execute."}

    ctx.register_tool(name="chief_tools", toolset="chief_http_tools", schema={
        "name": "chief_tools",
        "description": "Access the tools assigned to this Chief chat. First list for compact tool names, then describe one exact name for its full argument schema, then call it. Computer/browser tools act on the assigned VM or surface, not the Hermes host. attachments returns this turn's user images. All calls retain Chief approvals and cancellation.",
        "parameters": {"type": "object", "properties": {
            "action": {"type": "string", "enum": ["list", "describe", "call", "attachments"]},
            "name": {"type": "string"}, "arguments": {"type": "object"}},
            "required": ["action"], "additionalProperties": False}}, handler=handle, emoji="🖥️")
    ctx.register_hook("pre_tool_call", authorize)
