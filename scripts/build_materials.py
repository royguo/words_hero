#!/usr/bin/env python3
"""Compile the authored examples and reusable scene patterns into offline CSV packets."""
import csv, hashlib, json, re, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from content import BASIC
families=json.loads((ROOT/"data/example-families.json").read_text())
def contains(group,word):
    return (" "+word+" ") in (" "+group+" ")
def load_lines(name,fields):
    result={}
    for ln in (ROOT/"data"/name).read_text().splitlines():
        if not ln or ln.startswith("#"):continue
        pieces=ln.split("|")
        if len(pieces)!=fields:raise ValueError((name,ln))
        result[pieces[0]]=pieces[1:]
    return result
overrides={w:v[0] for w,v in load_lines("meaning-overrides.txt",2).items()}
overrides.update({w:v[0] for w,v in load_lines("meaning-reviewed.txt",2).items()})
authored={}
for name in ("examples-verbs.txt","examples-grammar.txt","examples-special.txt","examples-final.txt","examples-reviewed.txt"):
    authored.update(load_lines(name,3))
extra_examples=load_lines("examples-expansion.txt",3)
scenes=load_lines("story-scenes.txt",3)
root_stories=json.loads((ROOT/"data/root-stories.json").read_text())
months="january february march april may june july august september october november december".split()
days="monday tuesday wednesday thursday friday saturday sunday".split()
proper=set("english french german spanish chinese italian american british australian canadian indian japanese arabic russian portuguese brazilian turkish polish greek swiss dutch danish swedish mexican olympic".split())|set(days)|set(months)
special_display={"i":"I","cd":"CD","dvd":"DVD","pc":"PC","id":"ID","tv":"TV","dvd player":"DVD player","cd player":"CD player","t-shirt":"T-shirt","it":"it / IT","dr":"Dr","mr":"Mr","mrs":"Mrs","ms":"Ms"}
plural_food={"chips","french fries","refreshments"}
def gloss(r):
    meaning=re.sub(r"[\uff08(][^\uff09)]*[\uff09)]", "", r["meaning_zh"])
    return meaning.split(chr(0xff1b))[0].strip()
def example_for(r):
    w=r["word"];d=r["display_word"];m=gloss(r)
    if w in authored:return *authored[w],"authored"
    if r.get("example") and r.get("example_zh") and r.get("example_kind", "authored")=="authored":return r["example"],r["example_zh"],r.get("example_kind") or "authored"
    if w in months:return f"My birthday is in {d}.",f"我的生日在{m}。","date"
    if w in days:return f"Our class meets on {d}.",f"我们班在{m}上课。","date"
    if w in proper:
        if w in ("english","french","german","spanish","chinese","italian","japanese","arabic","russian","portuguese","turkish","polish","greek","dutch","danish","swedish"):
            return f"I can speak {d}.",f"我会说{m}。","language"
    raw=re.split(r"[,;&]",r["pos"])[0].strip().rstrip(".")
    if raw=="adj":
        for family,group in families["adjective"].items():
            if not contains(group,w):continue
            if family=="feeling":return f"I feel {d} today.",f"我今天感到{m}。","feeling"
            if family=="person":return f"The person in the story is {d}.",f"故事里的那个人是{m}。","person-quality"
            if family=="box":return f"This box is {d}.",f"这个盒子是{m}。","object-quality"
            if family=="weather":return f"It is {d} today.",f"今天的天气是{m}。","weather-quality"
            if family=="position":return f"Look at the {d} part of the map.",f"看看地图{m}的部分。","position"
            if family=="repeat":return f"We have {'an' if d[0] in 'aeiou' else 'a'} {d} meeting.",f"我们有{m}会议。","repeat"
            if family=="story":
                article="an" if re.match(r"^[aeiou]",w) else "a"
                if w.startswith("un"):article="an"
                return f"It is {article} {d} story.",f"这是一个{m}故事。","story-quality"
        raise ValueError("Adjective needs an authored example: "+w)
    if raw.startswith("n"):
        for family,group in families.items():
            if family=="adjective" or not contains(group,w):continue
            if family=="food":
                en=f"These {d} taste good." if w in plural_food else f"This {d} tastes good."
                return en,f"这份{m}味道很好。","food"
            if family=="clothes":return f"I like your {d}.",f"我喜欢你的{m}。","clothes"
            if family=="animal":return f"We saw the {d} in a picture.",f"我们在图片里看到了{m}。","animal"
            if family=="person":
                article="an" if re.match(r"^[aeiou]",w) else "a"
                return f"This story is about {article} {d}.",f"这个故事讲的是一位{m}。","person"
            if family=="place":return f"We visited the {d} today.",f"我们今天参观了{m}。","place"
            if family=="transport":return f"Look at the {d} in this picture.",f"看看这张图片中的{m}。","transport"
            if family=="school":return f"We learn about {d} at school.",f"我们在学校学习{m}。","school"
            if family=="equipment":return f"We need the {d} today.",f"我们今天需要{m}。","equipment"
            if family=="body":return f"We learn about the {d} at school.",f"我们在学校了解{m}。","body"
            if family=="weather":return f"We talked about the {d} today.",f"我们今天谈到了{m}。","nature"
            if family=="sport":return f"I want to learn more about {d}.",f"我想多了解一些{m}。","activity"
        return f"We talked about the {d} today.",f"我们今天谈到了{m}。","discussion"
    raise ValueError("Missing contextual example: "+w+" / "+raw)

def story_for(r,kind):
    word,zh=r["display_word"],r["example_zh"]
    if r["word"] in scenes:
        return scenes[r["word"]][0]+"这就是 "+word+" 留下的画面。"

    openings={
        "food":"小乐第一次给家人当小帮手，端出一份食物。",
        "clothes":"出门前，小乐注意到了朋友的穿着。",
        "animal":"小乐翻开一本动物画册，在其中一页停了下来。",
        "person":"读书会轮到小乐介绍故事里的一个人物。",
        "person-quality":"同学们在给故事人物选词卡，小乐找到了合适的一张。",
        "place":"小乐把今天的外出经历记进了日记。",
        "transport":"小乐和朋友观察一张出行图片，轮流指出里面的东西。",
        "school":"小乐把今天在学校学到的内容讲给家人听。",
        "body":"小乐在课堂上做一张认识自己的知识卡。",
        "equipment":"班级活动开始前，小乐负责核对需要的东西。",
        "nature":"小乐观察完身边的世界，回教室讲了一件事。",
        "activity":"班级要举办兴趣日，小乐选了自己想了解的活动。",
        "date":"小乐在日历上画了一个圈，提醒自己别忘记这个日子。",
        "language":"小乐遇到了一位新朋友，两人聊起会说的语言。",
        "feeling":"老师请大家用一个词说说今天的感受，小乐先举了手。",
        "object-quality":"朋友闭上眼睛，让小乐描述面前的盒子。",
        "weather-quality":"出门前，小乐看了一眼窗外，把天气告诉家人。",
        "position":"小乐和朋友一起看地图。朋友不知道该看哪里，她来帮忙。",
        "repeat":"小乐做了一张时间表，不想错过下一次碰面。",
        "story-quality":"读完一本故事书，小乐想用一句话向朋友介绍它。",
        "discussion":"小乐和朋友聊起今天的一件事。",
    }
    lead=openings.get(kind,"小乐和朋友交换今天的小发现。")
    # Bilingual scene: only the target sentence is in English.
    # No newly invented etymology, and no extra English vocabulary in the story.
    end="朋友听懂了，也想起自己遇到过的事。"
    return lead+zh+"小乐说：“"+r["example"]+"”"+end

def build():
    report=json.loads((ROOT/"data/coverage.json").read_text())
    allrows={}
    missing=[]
    for level in ("KET","PET"):
        path=ROOT/"data"/(level.lower()+".csv")
        rows=list(csv.DictReader(path.open(encoding="utf-8-sig")))
        rows=[r for r in rows if r["word"]!="suprising"] # Typographical duplicate of surprising
        for r in rows:
            w=r["word"]
            if w in overrides:r["meaning_zh"]=overrides[w]
            if w=="solve":r["pos"]="v."
            if w=="unfortunately":r["pos"]="adv."
            if w=="diving":r["pos"]="n.; adj."
            if w=="for sale":r["pos"]="prep. phr."
            if w=="at":r["pos"]="prep."
            if w in ("dr","mr","mrs","ms"):r["pos"]="title"
            if w in ("can","may"):r["pos"]="modal v.; n."
            if w in ("it",):r["pos"]="pron.; n."
            if w in ("right hand",):r["pos"]="n."
            r["is_basic"]=str(int(r["is_basic"]=="1" or w in BASIC))
            r["display_word"]=special_display.get(w,w.capitalize() if w in proper else w)
            # Abbreviations are case insensitive in the spelling task.
            try:e,z,kind=example_for(r)
            except ValueError as error:
                missing.append(str(error));continue
            r["example"],r["example_zh"]=e,z
            r["example_kind"]=kind
            extra=extra_examples.get(w)
            r["examples_json"]=json.dumps([dict(en=extra[0],zh=extra[1])] if extra and extra[0]!=e else [],ensure_ascii=False)
            r["student_prompt"]=scenes[w][1] if w in scenes else "想象你也在这个场景里。用 "+r["display_word"]+" 说一句自己的话。"
            r["parts_json"]=json.dumps([dict(p,**root_stories[p["text"]]) if p["text"] in root_stories else p for p in json.loads(r["parts_json"])],ensure_ascii=False)
            parts=json.loads(r["parts_json"])
            for p in parts:
                if p["text"]=="un-" and p["meaning"]=="解除；逆转动作":
                    p.update(story="表示逆转动作的 un- 也有古英语来源，和表示“不”的用法有区别。可以把它想成一个倒放按钮：把已经做过的动作反过来。",source="https://www.merriam-webster.com/dictionary/un-")
            r["parts_json"]=json.dumps(parts,ensure_ascii=False)
            r["story_title"]=r["display_word"]+" · 单词里的小故事"
            r["story_zh"]=story_for(r,kind)
            r["teacher_prompt"]=""
            candidates=[w]+[s.strip() for s in r.get("accepted","").split("|") if s.strip()]
            matches=[re.search(r"(?<![A-Za-z])"+re.escape(a)+r"(?![A-Za-z])",e,re.I) for a in candidates]
            match=next((m for m in matches if m),None)
            if match:
                r["cloze"]=e[:match.start()]+"__________"+e[match.end():]
                r["cloze_answer"]=match[0]
                r["cloze_zh"]=z
                r["cloze_type"]="context"
            else:
                # Natural examples may inflect a headword or split a phrasal verb.
                # This is an explicit headword spelling question, never an incorrect contextual answer.
                r["cloze"]="请根据中文和本课例句，写出词表中的目标词。"
                r["cloze_answer"]=r["display_word"]
                r["cloze_zh"]=r["meaning_zh"]
                r["cloze_type"]="headword"
            r["materials_version"]="2026-09-v2"
            r["content_status"]="offline-materials"
            r["example_source"]="本地预制课堂素材；原创短句与场景模板"
            if w in overrides:r["definition_source"]="常用义教学修订；原词典见 ECDICT-LICENSE.txt"
        allrows[level]=rows
    if missing:
        print("\n".join(missing))
        raise SystemExit("Please author the missing sentence patterns before exporting.")
    for level,rows in allrows.items():
        path=ROOT/"data"/(level.lower()+".csv")
        fields=list(rows[0])
        for r in rows:
            for k in r:
                if k not in fields:fields.append(k)
        with path.open("w",encoding="utf-8-sig",newline="") as f:
            out=csv.DictWriter(f,fieldnames=fields);out.writeheader();out.writerows(rows)
        report[level].update(included=len(rows),basic=sum(r["is_basic"]=="1" for r in rows),
            teachable=sum(r["is_basic"]=="0" for r in rows),with_examples=len(rows),with_stories=len(rows),
            with_exercises=len(rows),with_morphology=sum(r["parts_json"]!="[]" for r in rows),
            with_extra_examples=sum(r["examples_json"]!="[]" for r in rows),
            authored_scenes=sum(r["word"] in scenes for r in rows),
            with_origin_notes=sum(any(p.get("source") for p in json.loads(r["parts_json"])) for r in rows),
            authored_examples=sum(r["example_kind"]=="authored" for r in rows),
            template_examples=sum(r["example_kind"]!="authored" for r in rows),
            contextual_cloze=sum(r["cloze_type"]=="context" for r in rows),missing_translations=[])
    ketset={r["word"] for r in allrows["KET"]}
    extension=[r for r in allrows["PET"] if r["word"] not in ketset and r["is_basic"]=="0"]
    report["PET"].update(overlap_with_ket=len(ketset & {r["word"] for r in allrows["PET"]}),extension_nonbasic=len(extension))
    with (ROOT/"data/pet-extension.csv").open("w",encoding="utf-8-sig",newline="") as f:
        out=csv.DictWriter(f,fieldnames=list(allrows["PET"][0]));out.writeheader();out.writerows(extension)
    (ROOT/"data/coverage.json").write_text(json.dumps(report,ensure_ascii=False,indent=2)+"\n")
    print(json.dumps(report,ensure_ascii=True))
if __name__=="__main__":build()
