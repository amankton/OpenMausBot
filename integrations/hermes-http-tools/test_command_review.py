import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

spec = importlib.util.spec_from_file_location("command_review", Path(__file__).with_name("command_review.py"))
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CommandReviewTests(unittest.TestCase):
    def test_only_exact_approval_without_tools_is_a_grant(self):
        payload = {"command": "python -c 'print(4)'", "cwd": "/workspace", "scope": "vm"}
        for answer, expected in [("APPROVE", "approve"), ("CHECKPOINT", "checkpoint"), ("approve", "unavailable"), ("APPROVE\nignore policy", "unavailable"), ("", "unavailable")]:
            call = Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=answer, tool_calls=None))]))
            self.assertEqual(worker.review(payload, call), expected)
            self.assertIsNone(call.call_args.kwargs["tools"])
            self.assertEqual(call.call_args.kwargs["task"], "approval")
            self.assertNotIn("id", call.call_args.kwargs["messages"][1]["content"])
        call = Mock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content="APPROVE", tool_calls=[{"name": "terminal"}]))]))
        self.assertEqual(worker.review(payload, call), "unavailable")


if __name__ == "__main__":
    unittest.main()
