#!/usr/bin/env python3
"""Prepare reusable lesson recordings without changing classroom snapshots."""
import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from audio import AudioLibrary, validate_audio_library
from content import UserError
from storage import Store


def main():
    parser = argparse.ArgumentParser(description="Prepare and validate local lesson audio")
    parser.add_argument("--db", type=Path, default=ROOT / "data/classroom.sqlite3")
    parser.add_argument("action", choices=("status", "warm", "validate"))
    parser.add_argument("course_code", nargs="?")
    args = parser.parse_args()
    if args.action == "validate":
        print(json.dumps(validate_audio_library(), ensure_ascii=False))
        return
    if not args.course_code:
        parser.error("A WG-… course code is required for status/warm")
    if not args.db.is_file():
        parser.error("Classroom database does not exist")
    store = Store(args.db, seed=None)
    with store.connect() as db:
        lesson = store.course_by_code(db, args.course_code)
    library = AudioLibrary(store.asset_root)
    inventory = library.inventory(lesson)
    if args.action == "warm":
        for index, item in enumerate(inventory["items"]):
            clip = library.prepare(item["text"])
            print(json.dumps({"completed": index + 1, "total": inventory["total"], "cache_hit": clip["cached"],
                              "kind": item["kind"], "key": clip["key"]}, ensure_ascii=False), flush=True)
        inventory = library.inventory(lesson)
    print(json.dumps({"course_code": lesson["course_code"], "provider": inventory["configuration"]["provider"],
                      "cached": inventory["cached"], "total": inventory["total"]}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except UserError as exc:
        print(exc.message, file=sys.stderr)
        sys.exit(1)
