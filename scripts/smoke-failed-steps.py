#!/usr/bin/env python3
"""Print the names of the steps that failed in a real-app check's result.json,
separated by "; ", or nothing when it can't be read."""
import json
import sys


def failed_steps(path):
    try:
        with open(path, encoding='utf-8') as handle:
            result = json.load(handle)
    except (OSError, ValueError):
        return []
    return [str(step.get('name', '?')) for step in result.get('steps', []) if not step.get('passed')]


if __name__ == '__main__':
    print('; '.join(failed_steps(sys.argv[1])) if len(sys.argv) > 1 else '')
