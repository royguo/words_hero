#!/usr/bin/env python3
"""Word Garden: loopback-only web app, SQLite persistence, no third-party runtime."""
import csv
import hashlib
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from word_study import validate_study

ROOT = Path(__file__).resolve().parent
LEVELS = ("KET", "PET", "CET-4", "CET-6")
BASIC = set("a an the lot lots many much some any all one two three I you he she it we they am is are be been was were do does did have has had of to in on at by for from and or but so as if this that these those my your his her its our their me him us them yes no not very can will would could should may must what who when where how why with without up down out into over under again good bad big small new old go come get make take see look day".lower().split())
KIND_LABEL = {"root": "词基", "prefix": "前缀", "suffix": "后缀", "compound": "合成成分"}

def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")

def dump(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

class UserError(Exception):
    def __init__(self, message, status=400):
        self.message, self.status = message, status

def integer(value, low, high, name):
    if isinstance(value, bool):
        raise UserError(name + "格式不正确")
    try:
        n = int(value)
    except (ValueError, TypeError):
        raise UserError(name + "格式不正确")
    if str(n) != str(value) or not low <= n <= high:
        raise UserError(name + "超出允许范围")
    return n

def normalize_answer(s):
    return re.sub(r"\s+", " ", s.strip().lower().replace("’", "'"))

def parse_csv(content, expected_level=None):
    if not isinstance(content, str) or len(content) > 10_000_000:
        raise UserError("CSV 文件过大或格式不正确")
    reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff")))
    required = {"word", "level", "meaning_zh", "pos", "topic", "difficulty", "example", "example_zh", "cloze", "cloze_answer", "cloze_zh"}
    if reader.fieldnames and len(reader.fieldnames) != len(set(reader.fieldnames)):
        raise UserError("CSV 列名重复")
    if not required.issubset(reader.fieldnames or []):
        raise UserError("CSV 缺少必需列：" + "、".join(sorted(required)))
    result, keys = [], set()
    for line, row in enumerate(reader, 2):
        if line > 10001:
            raise UserError("每次最多导入 10000 个词")
        if None in row or any(v is None for v in row.values()):
            raise UserError("CSV 第 %d 行列数不正确" % line)
        row = {k: v.strip() for k, v in row.items()}
        word, level = row["word"].lower(), row["level"].upper()
        if level not in LEVELS or (expected_level and level != expected_level):
            raise UserError("CSV 第 %d 行的词汇范围不匹配" % line)
        if not re.fullmatch(r"[a-z][a-z '\-]{0,79}", word):
            raise UserError("CSV 第 %d 行的英文词条不正确" % line)
        if any(not row[k] or len(row[k]) > 1000 for k in required):
            raise UserError("CSV 第 %d 行有空白或过长的必填内容" % line)
        if (level, word) in keys:
            raise UserError("CSV 中有重复词条：" + word)
        keys.add((level, word))
        try:
            parts = json.loads(row.get("parts_json") or "[]")
        except (TypeError, json.JSONDecodeError):
            raise UserError("CSV 第 %d 行的 parts_json 不是合法 JSON" % line)
        if not isinstance(parts, list) or len(parts) > 8:
            raise UserError("CSV 第 %d 行构词成分格式不正确" % line)
        for p in parts:
            if not isinstance(p, dict) or not {"text", "kind", "meaning"}.issubset(p) or bool(set(p)-{"text", "kind", "meaning", "story", "source"}) or not isinstance(p["kind"], str) or p["kind"] not in KIND_LABEL:
                raise UserError("CSV 第 %d 行构词成分需包含 text、kind、meaning" % line)
            if any(not isinstance(v, str) or not v or len(v) > 1000 for v in p.values()):
                raise UserError("CSV 第 %d 行构词成分内容不正确" % line)
        raw_basic = row.get("is_basic", "0") or "0"
        if raw_basic not in ("0", "1"):
            raise UserError("CSV 第 %d 行的 is_basic 必须为 0 或 1" % line)
        cloze_type = row.get("cloze_type") or "context"
        if cloze_type not in ("context", "headword"):
            raise UserError("CSV 第 %d 行的 cloze_type 不正确" % line)
        if cloze_type == "context":
            if row["cloze"].count("__________") != 1 or row["cloze"].replace("__________", row["cloze_answer"]) != row["example"]:
                raise UserError("CSV 第 %d 行的填空题与例句或答案不对应" % line)
        accepted = [word] + [s.strip().lower() for s in row.get("accepted", "").split("|") if s.strip()]
        if normalize_answer(row["cloze_answer"]) not in [normalize_answer(a) for a in accepted]:
            raise UserError("CSV 第 %d 行的填空答案不属于目标词或可接受变体" % line)
        try:
            extra_examples=json.loads(row.get("examples_json") or "[]")
        except (TypeError,json.JSONDecodeError):
            raise UserError("CSV 第 %d 行的 examples_json 不是合法 JSON" % line)
        if not isinstance(extra_examples,list) or len(extra_examples)>4:
            raise UserError("CSV 第 %d 行最多添加 4 个补充例句" % line)
        for example in extra_examples:
            if not isinstance(example,dict) or set(example)!={"en","zh"} or any(not isinstance(v,str) or not v.strip() or len(v)>240 for v in example.values()):
                raise UserError("CSV 第 %d 行的补充例句需包含 en、zh，且各不超过 240 字" % line)
        if len(row.get("student_prompt",""))>240:
            raise UserError("CSV 第 %d 行的互动提示过长" % line)
        material = {key: row.get(key, "") for key in
            ("story_title", "story_zh", "teacher_prompt", "student_prompt", "cloze", "cloze_answer", "cloze_zh", "example_kind", "example_source", "materials_version")}
        material["cloze_type"] = cloze_type
        material["extra_examples"] = extra_examples
        if row.get("study_json"):
            try:
                material["word_study"] = validate_study(json.loads(row["study_json"]))
            except (ValueError, TypeError) as exc:
                raise UserError("CSV 第 %d 行 study_json 不正确：%s" % (line, exc))
        result.append({
            **material, "word": word, "level": level, "difficulty": integer(row.get("difficulty", "2"), 1, 3, "difficulty"), "meaning_zh": row["meaning_zh"], "pos": row["pos"],
            "topic": row["topic"], "example": row.get("example",""), "example_zh": row.get("example_zh",""),
            "parts": parts, "note": row.get("note") or "结合例句和生活场景整体记忆，不按相同字母强行拆词。",
            "is_basic": raw_basic == "1" or word in BASIC,
            "accepted": accepted,
            "source": row.get("source") or "教师导入词库", "phonetic": row.get("phonetic",""), "definition_source": row.get("definition_source",""), "content_status": row.get("content_status","teacher"), "display_word": row.get("display_word") or word,
        })
    if not result:
        raise UserError("CSV 中没有词条")
    return result

def root_groups(words):
    groups = {}
    for w in words:
        for p in w["parts"]:
            key = p["kind"] + ":" + p["text"] + ":" + p["meaning"]
            if key not in groups:
                groups[key] = dict(p, id=hashlib.sha256(key.encode()).hexdigest()[:12], words=[])
            if w["word"] not in [v["word"] for v in groups[key]["words"]]:
                groups[key]["words"].append({"word": w["word"], "display_word": w.get("display_word") or w["word"], "meaning_zh": w["meaning_zh"]})
    return sorted(groups.values(), key=lambda x: (-len(x["words"]), x["kind"], x["text"]))


def worksheet(lesson, kind="classroom", embedded=False):
    from worksheets import render_worksheet
    return render_worksheet(lesson, kind, embedded)
