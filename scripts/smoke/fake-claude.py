#!/usr/bin/python3
"""Stand-in `claude` for Aven Dev's real-app check (dev-aven.py --smoke).

It speaks just enough of Claude Code's stream-json protocol for Aven to send
one turn: it answers initialize and model-list requests, echoes each user
message, and replies with AVEN_SMOKE_OK. It never contacts a network or an
account. Every invocation is logged beside it as evidence that
Aven's native spawn path ran.
"""
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

REPLY = "AVEN_SMOKE_OK"
# Beside the stand-in, where the runner reads it.
LOG = Path(__file__).resolve().parent / "fake-claude.log"


def log(entry):
    with LOG.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


def emit(message):
    sys.stdout.write(json.dumps(message) + "\n")
    sys.stdout.flush()


# "AVEN_PERF_STREAM <chunks>" in a message asks for a long streamed reply, as
# the speed test (scripts/perf-aven.py) does to measure Aven while an agent
# writes. Each chunk is a few words; code blocks and lists are mixed in so the
# transcript renders realistic markdown.
STREAM_PATTERN = re.compile(r"AVEN_PERF_STREAM (\d+)")
STREAM_INTERVAL = 0.012
STREAM_LINES = [
    "Here is how the change fits together. ",
    "The workspace keeps one list of tasks per project, ",
    "and the sidebar reads it while it is on screen.\n\n",
    "- Load the project's history once.\n",
    "- Merge live tasks into it.\n",
    "- Freeze the list while the sidebar is hidden.\n\n",
    "```ts\nexport function visible(rows: Row[], limit: number) {\n",
    "  return rows.filter((row) => !row.archived).slice(0, limit);\n}\n```\n\n",
    "That keeps typing smooth while agents stream. ",
    "**Next**, measure frames during the switch and compare. ",
]


def stream_text(chunks):
    return [STREAM_LINES[index % len(STREAM_LINES)] for index in range(chunks)]


def message_text(message):
    content = (message.get("message") or {}).get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(
            block.get("text", "") for block in content if isinstance(block, dict)
        )
    return ""


def option(args, name):
    for index, value in enumerate(args):
        if value == name and index + 1 < len(args):
            return args[index + 1]
        if value.startswith(name + "="):
            return value.split("=", 1)[1]
    return None


def main():
    args = sys.argv[1:]
    log({
        "pid": os.getpid(),
        "args": args,
        # Present only when Aven's own harness spawned this process.
        "harnessParent": "MONOCODE_HARNESS_PARENT" in os.environ,
        "browserSocket": "AVEN_BROWSER_SOCKET" in os.environ,
    })
    if "--version" in args:
        print("2.1.0 (Claude Code)")
        return 0
    if args[:2] == ["auth", "status"]:
        print(json.dumps({"loggedIn": True, "authMethod": "smoke"}))
        return 0
    if option(args, "--input-format") != "stream-json":
        # Updates, doctor and anything else: succeed without doing anything.
        return 0

    session = option(args, "--session-id") or str(uuid.uuid4())
    emit({"type": "system", "subtype": "init", "session_id": session})
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except ValueError:
            continue
        kind = message.get("type")
        if kind == "control_request":
            request = message.get("request") or {}
            response = {}
            if request.get("subtype") == "list_models":
                response = {"models": []}
            emit({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": message.get("request_id"),
                    "response": response,
                },
            })
        elif kind == "user":
            turn = message.get("uuid") or str(uuid.uuid4())
            log({"pid": os.getpid(), "turn": turn})
            emit({"type": "user", "isReplay": True, "uuid": turn, "session_id": session})
            requested = STREAM_PATTERN.search(message_text(message))
            chunks = stream_text(int(requested.group(1))) if requested else []
            message_id = "msg_smoke_" + turn[:8]
            emit({
                "type": "stream_event",
                "session_id": session,
                "event": {"type": "message_start", "message": {"id": message_id}},
            })
            for chunk in chunks + [REPLY]:
                emit({
                    "type": "stream_event",
                    "session_id": session,
                    "event": {
                        "type": "content_block_delta",
                        "delta": {"type": "text_delta", "text": chunk},
                    },
                })
                if chunks:
                    time.sleep(STREAM_INTERVAL)
            emit({
                "type": "assistant",
                "session_id": session,
                "message": {
                    "id": message_id,
                    "role": "assistant",
                    "content": [{"type": "text", "text": "".join(chunks) + REPLY}],
                },
            })
            emit({
                "type": "result",
                "subtype": "success",
                "is_error": False,
                "session_id": session,
                "result": REPLY,
            })
    return 0


if __name__ == "__main__":
    sys.exit(main())
