#!/usr/bin/env python3
"""Build a relocatable release with a static frontend and no classroom database."""
from pathlib import Path
import json, zipfile
ROOT=Path(__file__).resolve().parents[1]
if not (ROOT/"out/index.html").exists():raise SystemExit("Run npm run build first")
release=ROOT/"release"
release.mkdir(exist_ok=True)
output=release/"WordGarden-v1.zip"
files=[ROOT/name for name in ("README.md","THIRD_PARTY_NOTICES.txt","server.py","content.py","storage.py","start.command","start.sh","start.bat")]
files += [ROOT/"data"/name for name in ("ket.csv","pet.csv","pet-extension.csv","coverage.json","ECDICT-LICENSE.txt")]
files += [p for p in (ROOT/"out").rglob("*") if p.is_file()]
files += [ROOT/name for name in ("package.json","package-lock.json","tsconfig.json","next.config.ts","vite.config.ts","components.json",".oxlintrc.json",".gitignore") if (ROOT/name).is_file()]
for folder in ("app","lib","components","hooks","scripts","tests","public"):
    files += [p for p in (ROOT/folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"]
files += [p for p in (ROOT/"data").rglob("*") if p.is_file() and p.suffix in (".txt",".json",".md") and p not in files]
files += [ROOT/"data/ket-teaching.csv"]
files = sorted(set(files))
with zipfile.ZipFile(output,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
    for p in sorted(files):
        archive.write(p,"WordGarden-v1/"+p.relative_to(ROOT).as_posix())
print(str(output))
print("Release size: %.2f MB"%(output.stat().st_size/1_000_000))
