"""Run a cron command with the environment inherited by the container PID 1."""

from __future__ import annotations

import os
import sys
from pathlib import Path


PID1_ENVIRON = Path("/proc/1/environ")


def load_runtime_environment(path: Path = PID1_ENVIRON) -> int:
    loaded = 0
    for entry in path.read_bytes().split(b"\0"):
        if not entry or b"=" not in entry:
            continue
        raw_key, raw_value = entry.split(b"=", 1)
        key = raw_key.decode("utf-8", errors="strict")
        if not key or not key.replace("_", "a").isalnum() or key[0].isdigit():
            continue
        os.environ[key] = raw_value.decode("utf-8", errors="surrogateescape")
        loaded += 1
    return loaded


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("Usage: cron_with_runtime_env.py <command> [args...]")
    load_runtime_environment()
    os.chdir("/app")
    os.execvp(sys.executable, [sys.executable, *sys.argv[1:]])


if __name__ == "__main__":
    main()
