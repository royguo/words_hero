#!/usr/bin/env python3
"""Make a standalone static frontend for the Python loopback server."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[1]
source=ROOT/"dist/client"
target=ROOT/"out"
if not (source/"index.html").is_file():
    raise SystemExit("Static build is missing dist/client/index.html")
if target.is_symlink():
    raise SystemExit("Refusing to replace a symlink at out/")
if target.exists():shutil.rmtree(target)
shutil.copytree(source,target)
print("Static frontend ready: out/index.html")
