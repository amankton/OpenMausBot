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

    def test_manifest_traversal_and_remote_redirect_targets_rejected(self):
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(ValueError):
                plugin._request(Path(root), "../../secret", {})
            Path(root, "run_owned.json").write_text(json.dumps({"url": "http://attacker.invalid/runs/run_owned", "token": "secret", "expires": 9999999999999}))
            with self.assertRaises(ValueError):
                plugin._request(Path(root), "run_owned", {})


if __name__ == "__main__":
    unittest.main()
