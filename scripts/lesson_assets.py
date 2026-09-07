#!/usr/bin/env python3
"""Validate reusable assets, export a fixed lesson brief, or bind a versioned pack."""
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assets import bundle_words, read_manifest, validate_library
from content import ROOT, UserError
from storage import Store


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", type=Path, default=ROOT / "data/classroom.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("validate")
    brief = commands.add_parser("brief")
    brief.add_argument("course_code")
    brief.add_argument("--output", type=Path)
    apply = commands.add_parser("apply")
    apply.add_argument("course_code")
    apply.add_argument("bundle_id")
    demo = commands.add_parser("create-demo")
    demo.add_argument("bundle_id")
    demo.add_argument("--class-name", default="KET 图文体验班")
    args = parser.parse_args()
    try:
        if args.command == "validate":
            result = validate_library()
        else:
            store = Store(args.db)
            if args.command == "brief":
                result = store.material_brief(args.course_code)
            elif args.command == "apply":
                lesson = store.attach_materials(args.course_code, args.bundle_id)
                result = {k: lesson[k] for k in ("id", "course_code", "version_id", "version_number")}
            else:
                # Validate before writing any classroom record. Semantic keys are portable between databases.
                validate_library()
                data = read_manifest("lessons/" + args.bundle_id + "/manifest.json")
                words = bundle_words(data)
                with store.connect() as db:
                    ids = []
                    for word in words:
                        row = db.execute("SELECT id FROM vocabulary WHERE level=? AND word=?", (word["level"], word["word"])).fetchone()
                        if not row: raise UserError("当前词库缺少：" + word["word"])
                        ids.append(row["id"])
                cid = store.create_class({"name": args.class_name})["id"]
                draft = store.preview(cid, {"level": words[0]["level"], "count": max(5,len(ids)), "title": data["title"]})
                draft = store.patch_draft(draft["id"], {"revision": draft["revision"], "word_ids": ids})
                lesson = store.confirm_draft(draft["id"], {"revision": draft["revision"]})
                lesson = store.attach_materials(lesson["course_code"], data["id"])
                result = {k: lesson[k] for k in ("id", "course_code", "version_id", "version_number")}
        text = json.dumps(result, ensure_ascii=False, indent=2)
        if getattr(args, "output", None):
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(text + "\n", encoding="utf-8")
            print(args.output)
        else:
            print(text)
    except (UserError, OSError, KeyError, ValueError) as error:
        parser.exit(1, "素材操作失败：" + str(error) + "\n")


if __name__ == "__main__":
    main()
