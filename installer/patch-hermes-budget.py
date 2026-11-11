"""Apply reviewed admission hooks to a private exported Hermes source only."""
import ast
import hashlib
import json
from pathlib import Path
import shutil
import sys


def inject(file, targets):
    text = file.read_text(encoding="utf-8")
    if "# chief-budget-enforcement-v1" in text:
        return
    tree = ast.parse(text)
    changes = []
    found = set()
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) or node.name not in targets:
            continue
        expression = targets[node.name]
        first = node.body[0]
        line = first.end_lineno if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant) and isinstance(first.value.value, str) else first.lineno - 1
        indent = " " * (node.col_offset + 4)
        changes.append((line, indent + "# chief-budget-enforcement-v1\n" + indent + "from chief_budget import validate_transport\n" + indent + "validate_transport(" + expression + ")\n"))
        found.add(node.name)
    if found != set(targets):
        raise ValueError("Pinned Hermes admission anchors changed: " + file.name)
    lines = text.splitlines(keepends=True)
    for line, code in sorted(changes, reverse=True):
        lines.insert(line, code)
    result = "".join(lines)
    ast.parse(result)
    file.write_text(result, encoding="utf-8", newline="\n")


def patch(source):
    source = Path(source).resolve()
    if not (source / "run_agent.py").is_file() or not (source / "uv.lock").is_file():
        raise ValueError("Expected the exported Hermes source")
    inject(source / "agent/conversation_loop.py", {"run_conversation": "getattr(agent, 'api_mode', '')"})
    inject(source / "agent/chat_completion_helpers.py", {name: "getattr(agent, 'api_mode', '')" for name in ["direct_api_call", "interruptible_api_call", "interruptible_streaming_api_call"]})
    inject(source / "agent/auxiliary_hooks.py", {"run_with_aux_hooks": "api_mode", "arun_with_aux_hooks": "api_mode"})
    shutil.copyfile(Path(__file__).with_name("hermes_budget.py"), source / "chief_budget.py")
    files = ["chief_budget.py", "agent/conversation_loop.py", "agent/chat_completion_helpers.py", "agent/auxiliary_hooks.py"]
    receipt = {"version": 1, "kind": "chief-budget-enforcement", "files": {name: hashlib.sha256((source / name).read_bytes()).hexdigest() for name in files}}
    (source / "chief-budget-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
    return receipt


if __name__ == "__main__":
    patch(sys.argv[1])
