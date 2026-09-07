"""Persistable questions and isolated A4 rendering, shared by preview and print."""
import html
import math
import random

from content import KIND_LABEL, UserError


def worksheet_plan(words, groups, order, seed):
    """Compile once when a version is created; printing never reshuffles questions."""
    by_id = {w["id"]: w for w in words}
    forward = [by_id[i] for i in (order or {}).get("english_to_chinese", []) if i in by_id]
    if len(forward) != len(words):
        forward = list(words)
        random.Random(seed + ":worksheet-v2").shuffle(forward)
    connections, sentences = [], []
    for i, w in enumerate(forward):
        study = w.get("word_study")
        if study:
            prompt = study["challenge"]["prompt_zh"]
            answer = study["challenge"]["answer_zh"]
        elif w.get("parts"):
            p = w["parts"][0]
            prompt = '%s 中的 %s 是什么意思？' % (w.get("display_word") or w["word"], p["text"])
            answer = p["meaning"]
        else:
            prompt = '看中文，写英文：%s（%s）。把这个词和学过的情境连起来。' % (w["meaning_zh"], w["pos"])
            answer = w.get("display_word") or w["word"]
        connections.append({"id": "connection-" + str(i + 1), "word_id": w["id"],
                            "prompt": prompt, "hint": "", "answer": answer})
        sentences.append({"id": "sentence-" + str(i + 1), "word_id": w["id"],
                          "prompt": w["cloze"], "hint": w["cloze_zh"], "answer": w["cloze_answer"]})
    copying = [{"word": w.get("display_word") or w["word"], "kind": "word", "meaning": ""} for w in words]
    components, used = [], set()
    for w in words:
        study = w.get("word_study")
        parts = study["components"] if study else [
            {"text": p["text"], "kind": p["kind"], "meaning_zh": p["meaning"]} for p in w.get("parts", [])]
        for p in parts:
            key = (p["text"], p["kind"], p["meaning_zh"])
            if key in used:
                continue
            used.add(key)
            components.append({"word": p["text"], "kind": p["kind"], "meaning": p["meaning_zh"], "example": w.get("display_word") or w["word"]})
    return {"schema_version": 2, "copying": copying, "components": components,
            "connections": connections, "sentences": sentences}


def question_pages(items):
    """Conservative line budgets reserve header, identity fields and writing space."""
    result, page, used = [], [], 0
    for item in items:
        # CJK takes roughly two Latin character widths at the same print size.
        width = lambda text: sum(2 if ord(c) > 255 else 1 for c in text)
        lines = math.ceil(width(item["prompt"]) / 86) + math.ceil(width(item["hint"]) / 92)
        answer_lines = max(1, math.ceil(width(item["answer"]) / 80))
        units = max(3, lines + answer_lines + 1)
        if page and (used + units > 30 or len(page) >= 6):
            result.append(page)
            page, used = [], 0
        page.append(item)
        used += units
    if page:
        result.append(page)
    if len(result) == 2 and len(items) <= 12:
        half = math.ceil(len(items) / 2)
        def weight(item):
            width = lambda text: sum(2 if ord(c) > 255 else 1 for c in text)
            return max(3, math.ceil(width(item["prompt"])/86) + math.ceil(width(item["hint"])/92) + max(1, math.ceil(width(item["answer"])/80)) + 1)
        balanced = [items[:half], items[half:]]
        if all(sum(weight(x) for x in p) <= 30 for p in balanced):
            result = balanced
    return result or [[]]


CSS = """
.wg-worksheet{color:#15222b;font:14px/1.5 "PingFang SC","Microsoft YaHei",Arial,sans-serif;text-align:left;letter-spacing:normal;line-height:1.5}
.wg-worksheet *{box-sizing:border-box}
.wg-worksheet .paper-page{width:210mm;min-height:297mm;padding:12mm;margin:20px auto;background:#fff;box-shadow:0 3px 18px #0001;display:flex;flex-direction:column;position:relative}
.wg-worksheet .paper-header{border-bottom:2px solid #253c43;padding-bottom:4mm;margin-bottom:5mm}
.wg-worksheet .paper-brand{font-size:10px;letter-spacing:2px;color:#506169}
.wg-worksheet h1{font-size:23px;font-weight:700;margin:2mm 0;color:#15222b;line-height:1.4}
.wg-worksheet h2{font-size:18px;font-weight:650;margin:0 0 2mm;color:#15222b;break-after:avoid}
.wg-worksheet p{margin:0}
.wg-worksheet .paper-meta{font-size:11px;color:#52626a;overflow-wrap:anywhere}
.wg-worksheet .paper-identity{display:flex;gap:6mm;margin-top:5mm;font-size:13px}
.wg-worksheet .paper-identity label{display:flex;align-items:center;gap:2mm;white-space:nowrap}
.wg-worksheet input{border:0;border-bottom:1px solid #75838a;border-radius:0;width:29mm;font:inherit;color:inherit;outline-offset:2px;padding:1mm;background:transparent;height:7mm}
.wg-worksheet input[data-field="age"]{width:12mm}
.wg-worksheet input[data-field="time"]{width:38mm}
.wg-worksheet .paper-note{font-size:12px;color:#52626a;margin-bottom:3mm}
.wg-worksheet table{width:100%;border-collapse:collapse;table-layout:fixed;margin:3mm 0}
.wg-worksheet th,.wg-worksheet td{border:1px solid #adb7bc;padding:2.5mm;text-align:left;overflow-wrap:anywhere}
.wg-worksheet th{font-size:12px;font-weight:600;background:#f4f7f7}
.wg-worksheet td{height:14mm;font-size:15px}
.wg-worksheet .copy-word{width:29%;font-size:16px;font-weight:600}
.wg-worksheet .copy-word small{font-size:11px;font-weight:400;display:block;color:#52626a}
.wg-worksheet .writing-line{height:8mm;border-bottom:1px solid #bac5c9}
.wg-worksheet .copy-meaning{width:27%;font-size:12px}
.wg-worksheet .paper-questions{list-style:none;padding:0;margin:2mm 0 4mm;counter-reset:none}
.wg-worksheet .paper-question{break-inside:avoid;padding:2mm 0 2.5mm;border-bottom:1px solid #d8dfe2}
.wg-worksheet .question-text{font-size:14px;line-height:1.6;overflow-wrap:anywhere}
.wg-worksheet .question-number{display:inline-block;min-width:7mm;font-size:11px;color:#52626a}
.wg-worksheet .question-hint{font-size:12px;color:#52626a;margin-left:7mm;line-height:1.5}
.wg-worksheet .question-answer{font-size:14px;min-height:7mm;line-height:1.5;margin:1mm 0 0 7mm;border-bottom:1px solid #97a7ac;overflow-wrap:anywhere}
.wg-worksheet .paper-footer{margin-top:auto;padding-top:5mm;display:flex;justify-content:space-between;font-size:10px;color:#52626a}
.wg-worksheet .paper-lines{height:35mm;background:repeating-linear-gradient(white 0,white 8mm,#bec8cd 8.2mm,white 8.4mm)}
.wg-worksheet tr{break-inside:avoid}.wg-worksheet thead{display:table-header-group}
@page{size:A4 portrait;margin:12mm}
@media print{.wg-worksheet .paper-page{width:auto;min-height:0;display:block;margin:0;padding:0;box-shadow:none;break-after:page}.wg-worksheet .paper-page:last-child{break-after:auto}.wg-worksheet .paper-footer{margin-top:8mm;padding-top:0;break-inside:avoid}.wg-worksheet th{background:none}.wg-worksheet input{outline:none}}
"""


def render_worksheet(lesson, kind="classroom", embedded=False):
    if kind not in ("classroom", "homework", "answers"):
        raise UserError("练习册类型不正确")
    esc = lambda value: html.escape(str(value), quote=True)
    plan = lesson.get("config", {}).get("worksheets") or worksheet_plan(
        lesson["words"], lesson["groups"], lesson.get("config", {}).get("worksheet_order"), lesson["version_id"])
    answers = kind == "answers"
    label = {"classroom": "随堂跟写练习", "homework": "课后巩固练习", "answers": "课后练习 · 教师答案"}[kind]
    pages = []
    if kind == "classroom":
        for start in range(0, len(plan["copying"]), 12):
            rows = []
            for i, item in enumerate(plan["copying"][start:start + 12], start + 1):
                repeats = 1 if len(item["word"]) > 18 else 2 if len(item["word"]) > 11 else 4
                blank = '<td colspan="%d"><div class="writing-line"></div></td>' % (4 // repeats)
                rows.append('<tr><td class="copy-word">%s. %s</td>%s</tr>' % (i, esc(item["word"]), blank * repeats))
            pages.append('<h2>01 / 单词跟写</h2><p class="paper-note">一起读一遍，再沿每一行连续书写。写完后交给老师。</p><table><colgroup><col style="width:29%"><col span="4"></colgroup><thead><tr><th>单词</th><th colspan="4">连续书写练习</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>')
        labels = dict(KIND_LABEL, base="词基", root="词根", word="单词成分")
        for start in range(0, max(1, len(plan["components"])), 8):
            rows = []
            for item in plan["components"][start:start + 8]:
                rows.append('<tr><td class="copy-word">%s<small>%s</small></td><td><div class="writing-line"></div></td><td><div class="writing-line"></div></td><td class="copy-meaning"></td></tr>' % (esc(item["word"]), esc(labels[item["kind"]] + (" · " + item["example"] if item.get("example") else ""))))
            content = '<table><thead><tr><th>成分</th><th>第 1 遍</th><th>第 2 遍</th><th>中文含义</th></tr></thead><tbody>' + ''.join(rows) + '</tbody></table>' if rows else '<p class="paper-note">本课以完整单词和生活情境记忆为主。在这里写下你发现的搭配。</p>'
            pages.append('<h2>02 / 构词与联系</h2><p class="paper-note">跟着每个单词的讲解，写下成分，再用中文补充含义。</p>' + content + '<h2>我还发现了……</h2><div class="paper-lines"></div>')
    else:
        for title, help_text, questions in (
            ("01 / 发现单词之间的联系", "用构词、词族或搭配线索完成题目。想一想这些词为什么能连在一起。", plan["connections"]),
            ("02 / 把单词放回句子", "根据句子和中文提示填空。每题使用本课单词，注意大小写和词形。", plan["sentences"]),
        ):
            for items in question_pages(questions):
                rows = []
                for item in items:
                    number = item["id"].rsplit("-", 1)[-1]
                    rows.append('<li class="paper-question" data-question="%s"><p class="question-text"><span class="question-number">%s.</span>%s</p>%s<div class="question-answer">%s</div></li>' % (
                        esc(item["id"]), esc(number), esc(item["prompt"]),
                        '<p class="question-hint">' + esc(item["hint"]) + '</p>' if item["hint"] else '',
                        esc(item["answer"]) if answers else '&nbsp;'))
                pages.append('<h2>' + title + '</h2><p class="paper-note">' + help_text + '</p><ol class="paper-questions">' + ''.join(rows) + '</ol>')
    rendered = []
    for i, page in enumerate(pages, 1):
        rendered.append('<section class="paper-page" data-page="%d"><header class="paper-header"><div class="paper-brand">KiteDance / 风筝单词</div><h1>%s</h1><div class="paper-meta">%s · %s · %s · %d 词 · 版本 %s</div><div class="paper-identity"><label>姓名 <input data-field="name" aria-label="姓名" autocomplete="off"></label><label>年龄 <input data-field="age" aria-label="年龄" autocomplete="off">岁</label><label>时间 <input data-field="time" aria-label="时间" autocomplete="off" placeholder="年 / 月 / 日"></label></div></header>%s<footer class="paper-footer"><span>%s</span><span>第 %d / %d 页 · A4</span></footer></section>' % (
            i, esc(label), esc(lesson["class_name"]), esc(lesson["title"]), esc(lesson["level"]), len(lesson["words"]), esc(lesson["version_number"]), page,
            esc(lesson.get("course_code", "")), i, len(pages)))
    fragment = '<style>' + CSS + '</style><div class="wg-worksheet" data-worksheet="' + kind + '">' + ''.join(rendered) + '</div>'
    if embedded:
        return fragment
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(lesson["title"] + ' · ' + label) + '</title><style>body{margin:0;background:#edf0f2}.paper-toolbar{position:sticky;top:0;z-index:1;padding:14px;display:flex;gap:20px;justify-content:center;align-items:center;background:white;font:14px sans-serif}.paper-toolbar button{padding:10px 20px;cursor:pointer}@media print{body{background:white}.paper-toolbar{display:none}}</style></head><body><div class="paper-toolbar"><button onclick="window.print()">打印 / 保存为 PDF</button><span>A4 纵向 · 关闭浏览器页眉和页脚</span></div>' + fragment + '<script>document.addEventListener("input",function(e){const f=e.target.dataset.field;if(f)document.querySelectorAll("input[data-field="+f+"]").forEach(function(input){input.value=e.target.value;});});</script></body></html>'
