#!/usr/bin/python3
"""Stand-in `grok` (Grok Build) for Aven Dev's real-app check (dev-aven.py --smoke).

A race needs a second provider beside the stand-in Claude, so this speaks
just enough of the Agent Client Protocol that `grok agent stdio` uses: it
answers initialize and session/new, and replies to each prompt with
AVEN_SMOKE_OK. A prompt carrying AVEN_SMOKE_RACE writes race-grok.txt in its
working folder (the lane's copy), then holds the turn open for
AVEN_SMOKE_HOLD milliseconds, writing one more file every half second. With
AVEN_SMOKE_FAIL_ONCE, the first such prompt in each folder fails instead, so
the check can watch a lane fail and be retried. Any other command (--help,
models, updates) succeeds without doing anything. It never contacts a
network or an account. Every invocation is logged beside it.
"""
import json
import os
import re
import sys
import time
import uuid
from pathlib import Path

REPLY = "AVEN_SMOKE_OK"
HERE = Path(__file__).resolve().parent
LOG = HERE / "fake-grok.log"
# Folders whose first race prompt already failed, shared across processes.
FAILED = HERE / "fake-grok-failed.json"
HOLD_PATTERN = re.compile(r"AVEN_SMOKE_HOLD (\d+)")
HOLD_MAX_SECONDS = 20
WRITE_EVERY = 0.5


def log(entry):
    with LOG.open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


def emit(message):
    sys.stdout.write(json.dumps({"jsonrpc": "2.0", **message}) + "\n")
    sys.stdout.flush()


def prompt_text(params):
    return " ".join(
        block.get("text", "")
        for block in (params or {}).get("prompt") or []
        if isinstance(block, dict)
    )


def fail_once(folder):
    # One folder can be named two ways (/var and /private/var on macOS).
    folder = os.path.realpath(folder)
    failed = set(json.loads(FAILED.read_text())) if FAILED.is_file() else set()
    if folder in failed:
        return False
    failed.add(folder)
    FAILED.write_text(json.dumps(sorted(failed)))
    return True


def race(text, folder):
    """Write into the lane's copy as an agent would, while the turn holds."""
    Path(folder, "race-grok.txt").write_text("written by the stand-in Grok\n")
    held = HOLD_PATTERN.search(text)
    until = time.time() + (min(int(held.group(1)) / 1000, HOLD_MAX_SECONDS) if held else 0)
    count = 0
    while time.time() < until:
        time.sleep(WRITE_EVERY)
        count += 1
        Path(folder, f"race-grok-late-{count}.txt").write_text(f"{count}\n")


def main():
    args = sys.argv[1:]
    log({"pid": os.getpid(), "args": args, "cwd": os.getcwd(),
         "harnessParent": "MONOCODE_HARNESS_PARENT" in os.environ})
    if args[-1:] != ["stdio"]:
        if "--help" in args:
            print("Grok Build stand-in: grok agent stdio")
        return 0
    session = str(uuid.uuid4())
    folder = os.getcwd()
    for line in sys.stdin:
        try:
            message = json.loads(line)
        except ValueError:
            continue
        method = message.get("method")
        ident = message.get("id")
        params = message.get("params") or {}
        if ident is None:
            continue  # Notifications such as session/cancel need no answer.
        if method == "initialize":
            emit({"id": ident, "result": {"protocolVersion": 1,
                                         "agentCapabilities": {}, "authMethods": []}})
        elif method == "session/new":
            folder = params.get("cwd") or folder
            emit({"id": ident, "result": {"sessionId": session}})
        elif method == "session/prompt":
            text = prompt_text(params)
            log({"pid": os.getpid(), "turn": True, "race": "AVEN_SMOKE_RACE" in text,
                 "failOnce": "AVEN_SMOKE_FAIL_ONCE" in text, "folder": folder})
            if "AVEN_SMOKE_RACE" in text:
                if "AVEN_SMOKE_FAIL_ONCE" in text and fail_once(folder):
                    emit({"id": ident, "error": {
                        "code": -32603,
                        "message": "The stand-in Grok failed on purpose (AVEN_SMOKE_FAIL_ONCE).",
                    }})
                    continue
                race(text, folder)
            emit({"method": "session/update", "params": {
                "sessionId": session,
                "update": {"sessionUpdate": "agent_message_chunk",
                           "content": {"type": "text", "text": REPLY}},
            }})
            emit({"id": ident, "result": {"stopReason": "end_turn"}})
        else:
            # set_model, set_mode and anything newer: accepted, nothing to do.
            emit({"id": ident, "result": {}})
    return 0


if __name__ == "__main__":
    sys.exit(main())
