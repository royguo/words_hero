#!/usr/bin/env python3
"""Install the optional speech worker in this installation's isolated venv."""
from pathlib import Path
import subprocess
import sys
import venv

ROOT = Path(__file__).resolve().parents[1]
environment = ROOT / ".venv-audio"
venv.EnvBuilder(with_pip=True).create(environment)
python = environment / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
subprocess.run([str(python), "-m", "pip", "install", "-r", str(ROOT / "requirements-audio.txt")], check=True)
subprocess.run([str(python), "-c", "import edge_tts; print('Online speech is ready. Cached audio also works offline.')"], check=True)
