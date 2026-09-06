#!/bin/bash
set -eu
cd -- "$(dirname -- "$0")"
if ! command -v python3 >/dev/null 2>&1; then
  echo "Please install Python 3.9 or later, then open start.command again."
  read -r -p "Press Enter to close."
  exit 1
fi
python3 server.py
