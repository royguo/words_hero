#!/usr/bin/env python3
"""Word Garden: loopback-only web app, SQLite persistence, no third-party runtime."""
import csv
import hashlib
import html
import io
import json
import random
import re
from datetime import datetime, timezone
from pathlib import Path

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
    required = {"word", "level", "meaning_zh", "pos", "topic", "difficulty", "example", "example_zh", "story_zh", "cloze", "cloze_answer", "cloze_zh"}
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


def worksheet(lesson, kind="classroom"):
    if kind not in ("classroom","homework","answers"):
        raise UserError("练习册类型不正确")
    esc=lambda s:html.escape(str(s),quote=True)
    answers=kind=="answers"
    label={"classroom":"随堂跟写练习","homework":"课后巩固练习","answers":"课后练习 · 教师答案"}[kind]
    words=list(lesson["words"])
    groups=lesson["groups"]
    def group_label(g):
        if sum(x["text"]==g["text"] and x["kind"]==g["kind"] for x in groups)>1:
            usage="副词" if "副词" in g["meaning"] else "形容词" if "形容词" in g["meaning"] else "例词："+g["words"][0]["word"]
            return g["text"]+"（"+usage+"）"
        return g["text"]
    title=lesson["class_name"]+" · "+lesson["title"]+" · "+label
    def table(headers,rows,cls=""):
        return '<table class="'+cls+'"><thead><tr>'+''.join("<th>"+esc(x)+"</th>" for x in headers)+"</tr></thead><tbody>"+''.join("<tr>"+''.join("<td>"+esc(x)+"</td>" for x in row)+"</tr>" for row in rows)+"</tbody></table>"
    def heading(title,help=""):
        return "<h2>"+esc(title)+"</h2>"+('<p class="note">'+esc(help)+"</p>" if help else "")
    sections=[]
    if kind=="classroom":
        sections.append(heading("01 / 单词跟写","先一起读一遍，再沿每一行连续书写。长词组留出更宽的书写格。写完后交给老师。"))
        copy_rows=[]
        for i,w in enumerate(words):
            copy_word=w.get("display_word") or w["word"]
            repeats=1 if len(copy_word)>18 else 2 if len(copy_word)>11 else 4
            cells='<td colspan="%d"><div class="writing-line"></div></td>'%(4//repeats)
            copy_rows.append("<tr><td>"+esc(str(i+1)+". "+copy_word)+"</td>"+cells*repeats+"</tr>")
        sections.append('<table class="copy"><colgroup><col style="width:27%"><col span="4"></colgroup><thead><tr><th>单词</th><th colspan="4">连续书写练习</th></tr></thead><tbody>'+''.join(copy_rows)+"</tbody></table>")
        sections.append(heading("02 / 构词成分跟写","写出构词成分，并用中文补充老师讲解的意思。"))
        if groups:
            sections.append(table(["成分 / 类型","第 1 遍","第 2 遍","中文意思"],
                [(group_label(g)+" · "+KIND_LABEL[g["kind"]],"","","") for g in groups],"copy roots-copy"))
        else:sections.append('<p>本课以整体记忆为主，没有可靠的构词拆分。本项留作课堂笔记。</p><div class="note-lines"></div>')
    else:
        order=lesson.get("config",{}).get("worksheet_order")
        if order:
            by_id={w["id"]:w for w in words}
            words=[by_id[i] for i in order["english_to_chinese"]]
            reverse=[by_id[i] for i in order["chinese_to_english"]]
        else:
            rng=random.Random(lesson["version_id"]+":homework-v1")
            rng.shuffle(words);reverse=list(words);rng.shuffle(reverse)
        sections.append(heading("01 / 理解构词成分","写出下列词基、词缀或合成成分的中文含义。"))
        if groups:sections.append(table(["成分","类型","中文含义"],[(group_label(g),KIND_LABEL[g["kind"]],g["meaning"] if answers else "") for g in groups],"root-test"))
        else:sections.append("<p>本课没有已确认的构词拆分，第 01、02 项不出题。</p>")
        sections.append(heading("02 / 用本课单词举例","每项写出一个本课单词，注意这里的构词用法。"))
        if groups:sections.append(table(["构词成分","本课单词"],[(group_label(g)," / ".join((w.get("display_word") or w["word"]) for w in g["words"]) if answers else "") for g in groups]))
        sections.append('<section class="new-page">'+heading("03 / 看英文，写中文","写出本课学习的含义，意思相近的表达也可以。"))
        sections.append(table(["序号","英文 / 词性","中文含义"],[(i+1,(w.get("display_word") or w["word"])+" · "+w["pos"],w["meaning_zh"] if answers else "") for i,w in enumerate(words)],"translation")+"</section>")
        sections.append('<section class="new-page">'+heading("04 / 看中文，写英文","根据中文和词性，写出本课的目标单词。"))
        sections.append(table(["序号","中文 / 词性","英文拼写"],[(i+1,w["meaning_zh"]+" · "+w["pos"],(w.get("display_word") or w["word"]) if answers else "") for i,w in enumerate(reverse)],"translation")+"</section>")
    return """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>"""+esc(title)+"""</title><style>
*{box-sizing:border-box}body{font:14px/1.5 "PingFang SC","Microsoft YaHei",sans-serif;color:#111;background:#eceff4;margin:0}.sheet{max-width:210mm;min-height:297mm;margin:22px auto;background:white;padding:16mm;box-shadow:0 3px 20px #0001}.toolbar{position:sticky;top:0;display:flex;justify-content:center;align-items:center;gap:20px;padding:14px;background:#fff;border-bottom:1px solid #ddd}.toolbar button{padding:10px 26px;border:0;background:#3155d9;color:white;border-radius:8px;cursor:pointer;font-size:15px}.toolbar span{font-size:13px;color:#555}header{border-bottom:2px solid #111;padding-bottom:15px;margin-bottom:20px}.brand{font-size:11px;letter-spacing:2px;color:#555}h1{font-size:23px;margin:8px 0}h2{font-size:17px;margin:22px 0 10px;break-after:avoid}table{border-collapse:collapse;width:100%;table-layout:fixed;margin:12px 0 24px}th,td{border:1px solid #a5a5a5;padding:9px;text-align:left;overflow-wrap:anywhere}th{background:#f5f5f5;font-size:12px;font-weight:600}td{height:12mm;font-size:14px}thead{display:table-header-group}tr{break-inside:avoid}.copy td{height:14mm}.writing-line{height:8mm;border-bottom:1px solid #d1d1d1}.copy th:first-child{width:27%}.copy td:not(:first-child){background:linear-gradient(transparent 74%,#e4e4e4 75%,transparent 76%)}.translation th:first-child{width:10%}.root-test th:first-child{width:22%}.root-test th:nth-child(2){width:24%}.note{font-size:12px;color:#555;margin:6px 0}.identity{display:flex;gap:18px;flex-wrap:wrap;margin-top:16px}.identity label{display:flex;align-items:center;gap:4px;white-space:nowrap}.identity input{border:0;border-bottom:1px solid #555;width:100px;font:inherit;padding:3px;border-radius:0;background:none}.identity .age{width:42px}.identity .time{width:150px}.note-lines{height:160px;background:repeating-linear-gradient(white 0,white 30px,#bbb 31px,white 32px)}.meta{font-size:12px;color:#444}
@page{size:A4 portrait;margin:15mm}
@media print{body{background:white}.sheet{max-width:none;min-height:0;margin:0;padding:0;box-shadow:none}.toolbar{display:none}.new-page{break-before:page}th{background:none}.copy td:not(:first-child){background:none}td{font-size:11pt}h1{font-size:20pt}.identity input{outline:none}a{color:inherit;text-decoration:none}}
</style></head><body><div class="toolbar"><button onclick="window.print()">打印 / 保存为 PDF</button><span>A4 纵向 · 建议关闭浏览器页眉和页脚</span></div><main class="sheet"><header><div class="brand">WORD GARDEN / 词芽课堂</div><h1>"""+esc(label)+"""</h1><div class="meta">"""+esc(lesson["class_name"])+" · "+esc(lesson["title"])+" · "+esc(lesson["level"])+" · "+str(len(words))+" 词 · 版本 "+str(lesson["version_number"])+"""</div><div class="identity"><label>姓名 <input aria-label="姓名" autocomplete="off"></label><label>年龄 <input class="age" aria-label="年龄" autocomplete="off"> 岁</label><label>时间 <input class="time" aria-label="时间" placeholder="年 / 月 / 日" autocomplete="off"></label></div></header>"""+''.join(sections)+"</main></body></html>"
