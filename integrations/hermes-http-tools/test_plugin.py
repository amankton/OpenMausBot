import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("chief_bridge", Path(__file__).with_name("__init__.py"))
plugin = importlib.util.module_from_spec(spec)
spec.loader.exec_module(plugin)


class Context:
    def register_tool(self, **kwargs):
        self.tool = kwargs

    def register_hook(self, name, callback):
        self.hook = callback


class PluginTests(unittest.TestCase):
    def setUp(self):
        self.ctx = Context()
        plugin.register(self.ctx)

    def test_non_chief_sessions_cannot_call_bridge(self):
        with patch.object(plugin, "_identity", return_value=("run_x", "ordinary")):
            self.assertIn("only in an active Chief", self.ctx.tool["handler"]({"action": "list"}))
            self.assertIsNone(self.ctx.hook(tool_name="terminal"))

    def test_identity_comes_from_runtime_not_model(self):
        with patch.object(plugin, "_identity", return_value=("run_owned", "chief-owned")), patch.object(plugin, "_directory", return_value=Path(".")), patch.object(plugin, "_request", return_value={"tools": []}) as request:
            self.ctx.tool["handler"]({"action": "list", "run_id": "run_foreign"})
            self.assertEqual(request.call_args.args[1], "run_owned")

    def test_native_tool_policy_and_failure_are_enforced(self):
        with patch.object(plugin, "_identity", return_value=("run_owned", "chief-owned")), patch.object(plugin, "_directory", return_value=Path(".")):
            with patch.object(plugin, "_request", return_value={"allowed": False}):
                self.assertEqual(self.ctx.hook(tool_name="terminal")["action"], "block")
            with patch.object(plugin, "_request", return_value={"allowed": True, "approval": True}):
                self.assertEqual(self.ctx.hook(tool_name="terminal")["action"], "approve")
            with patch.object(plugin, "_request", side_effect=OSError()):
                self.assertEqual(self.ctx.hook(tool_name="terminal")["action"], "block")

    def test_image_results_use_hermes_multimodal_contract(self):
        result = plugin._result({"text": "screenshot", "images": [{"type": "image_url", "image_url": {"url": "data:image/png;base64,AAAA"}}]})
        self.assertTrue(result["_multimodal"])
        self.assertEqual(result["content"][1]["type"], "image_url")

    def test_authorization_includes_actual_arguments_and_honors_routine_result(self):
        with patch.object(plugin, "_identity", return_value=("run_owned", "chief-owned")), patch.object(plugin, "_directory", return_value=Path(".")), patch.object(plugin, "_request", return_value={"allowed": True, "approval": False}) as request:
            args = {"path": "/workspace/draft.md", "content": "draft"}
            self.assertIsNone(self.ctx.hook(tool_name="write_file", args=args))
            self.assertEqual(request.call_args.args[2], {"action": "authorize", "name": "write_file", "arguments": args})

    def test_checkpoint_grants_belong_to_one_exact_operation(self):
        with patch.object(plugin, "_identity", return_value=("run_owned", "chief-owned")), patch.object(plugin, "_directory", return_value=Path(".")), patch.object(plugin, "_request", return_value={"allowed": True, "approval": True, "summary": "Command checkpoint"}):
            first = self.ctx.hook(tool_name="terminal", args={"command": "git push origin one"})
            same = self.ctx.hook(tool_name="terminal", args={"command": "git push origin one"})
            other = self.ctx.hook(tool_name="terminal", args={"command": "git push origin two"})
            self.assertEqual(first["message"], "Command checkpoint")
            self.assertEqual(first["rule_key"], same["rule_key"])
            self.assertNotEqual(first["rule_key"], other["rule_key"])

    def test_manifest_traversal_and_remote_redirect_targets_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                plugin._request(Path(root), "../../secret", {})
            Path(root, "run_owned.json").write_text(json.dumps({"url": "http://attacker.invalid/runs/run_owned", "token": "secret", "expires": 9999999999999}))
            with self.assertRaises(ValueError):
                plugin._request(Path(root), "run_owned", {})


if __name__ == "__main__":
    unittest.main()
