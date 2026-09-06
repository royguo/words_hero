#!/usr/bin/env python3
"""Rebuild the reviewed KET seed from original teaching copy and explicit morphology."""
import csv, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CAM="https://www.cambridgeenglish.org/images/506886-a2-key-2020-vocabulary-list.pdf"
GRAM="https://dictionary.cambridge.org/grammar/british-grammar/word-formation_2"
# Candidates absent from the August 2025 guide are omitted, including plausible A2 derivatives.
EXCLUDED=set("meaning swimmer careless unlucky cucumber palace rainy snowy sunshine rainbow snowball snowman leaf turtle collection earache shoulder knee illness colourful useless narrow promise reply disagree".split())
BASIC=set("a an lot many much the some very good big small go come get".split())
EASY=set("teacher student classroom homework notebook lesson answer question learn teach read write library family parent cousin grandmother grandfather friend friendly kind happy unhappy afraid angry tired hungry thirsty quiet kitchen bedroom bathroom mirror key tidy wash breakfast lunch dinner sandwich potato tomato carrot salad grape lemon biscuit chocolate cheese honey butter sugar salt knife fork spoon plate bowl ticket holiday hotel restaurant cinema supermarket bridge village arrive leave return sunny cloudy windy foggy raincoat forest mountain island lake river beach flower grass spring summer autumn winter animal elephant giraffe dolphin whale penguin rabbit parrot butterfly spider snake tiger lion monkey mouse sheep horse football basketball volleyball badminton tennis swimming fishing painting drawing reading sing dance guitar piano team match hobby finger neck healthy ill hospital rest sweater jacket trousers jeans shorts skirt scarf glove sock boot sunglasses handbag backpack pocket cheap beautiful useful different difficult important safe heavy light soft hard empty full enough borrow lend bring carry build finish enjoy need share thank welcome weekend afternoon evening yesterday tomorrow soon later usually sometimes never quickly slowly computer keyboard screen printer camera battery".split())
HARD=set("dictionary language explain photographer dentist engineer mechanic manager customer tourist beginner teenager invitation interested interesting surprised careful helpful polite comfortable furniture ceiling entrance vegetable strawberry delicious recipe passenger passport suitcase luggage journey platform railway traffic roundabout capital opposite countryside environment temperature thunderstorm skateboard surfboard violin concert festival competition appointment medicine ambulance accident fashion receipt expensive excellent possible impossible unusual dangerous especially suddenly probably prepare prefer describe discover improve receive repeat suggest information instruction instructions advertisement electric machine photograph".split())
stories={
 "-er":("表示做事者的 -er 有古英语 -ere 等历史来源。它常把动作变成做这个动作的人；比较级里的 -er 是另一种用法。","https://www.merriam-webster.com/dictionary/-er"),
 "-ful":("-ful 可以追溯到古英语中表示“满的”的 full。如今它常表示具有某种特征；作后缀时只写一个 l。","https://www.merriam-webster.com/dictionary/-ful"),
 "un-":("表示否定的 un- 在古英语中就已存在，意思是“不”。给形容词加上它，常能把意思转向相反的一边。","https://www.merriam-webster.com/dictionary/un-"),
}
def part(text,kind,meaning):
 p={"text":text,"kind":kind,"meaning":meaning}
 if text in stories: p["story"],p["source"]=stories[text]
 return p
parts={}; notes={}
def pair(word,base,meaning,suffix,smeaning,note=""):
 parts[word]=[part(base,"root",meaning),part(suffix,"suffix",smeaning)]
 if note:notes[word]=note
for w,b,m in [("teacher","teach","教"),("singer","sing","唱"),("dancer","dance","跳舞"),("driver","drive","驾驶"),("farmer","farm","耕作"),("worker","work","工作"),("writer","write","写"),("painter","paint","画；涂漆"),("player","play","玩；参加运动"),("runner","run","跑"),("beginner","begin","开始"),("winner","win","赢"),("cleaner","clean","清洁"),("printer","print","打印")]:
 note="动作词 + -er，表示做这件事的人；printer 在本课指执行打印动作的机器。"
 if w in ("dancer","driver","writer"):note="词基以不发音的 e 结尾，接 -er 时先去掉 e，再加 -er。"
 if w in ("runner","beginner","winner"):note="注意拼写：末尾辅音字母双写后再接 -er。"
 pair(w,b,m,"-er","做某事的人或物",note)
for w,b,m in [("careful","care","小心；关心"),("helpful","help","帮助"),("useful","use","用处"),("wonderful","wonder","惊奇"),("beautiful","beauty","美")]:
 pair(w,b,m,"-ful","有……特征的；充满……的","beauty 的 y 变 i 后接 -ful：beautiful。" if w=="beautiful" else "接上 -ful，常表示具有这个词基描述的特征。")
for w,b,m in [("unhappy","happy","快乐的"),("unusual","usual","通常的")]:
 parts[w]=[part("un-","prefix","不；非"),part(b,"root",m)]
 notes[w]="先说出词基的意思，再想一想加上否定前缀后发生了什么变化。"
for w,b,m in [("sunny","sun","太阳"),("cloudy","cloud","云"),("windy","wind","风"),("foggy","fog","雾"),("healthy","health","健康"),("lucky","luck","运气"),("noisy","noise","噪声")]:
 pair(w,b,m,"-y","有……特征的","sunny、foggy 双写末尾辅音；noisy 去掉 noise 的 e。只留意本词适用的变化。")
for w,b,m in [("quickly","quick","快的"),("slowly","slow","慢的"),("carefully","careful","仔细的"),("usually","usual","通常的"),("suddenly","sudden","突然的")]:
 pair(w,b,m,"-ly","以……的方式（构成副词）","这里的 -ly 把形容词变成副词，用来说明动作如何发生。")
pair("friendly","friend","朋友","-ly","具有……特点的（构成形容词）","friendly 中的 -ly 构成形容词，不能把所有 -ly 词都当作副词。")
for w,b,m in [("swimming","swim","游泳"),("cycling","cycle","骑车"),("fishing","fish","钓鱼"),("camping","camp","露营"),("climbing","climb","攀登"),("painting","paint","绘画"),("drawing","draw","画"),("reading","read","阅读")]:
 pair(w,b,m,"-ing","把动作当作活动或事物来表达","本课选用名词用法。swimming 双写 m；cycling 去掉 cycle 末尾的 e。")
pair("actor","act","表演","-or","做某事的人","act + -or 表示表演的人。这个词使用 -or，不是 -er。")
pair("artist","art","艺术","-ist","从事某种活动的人","art + -ist 表示从事艺术的人。")
pair("dangerous","danger","危险","-ous","有……性质的","danger + -ous，把危险这个名词变成描述事物的形容词。")
parts["impossible"]=[part("im-","prefix","不；非"),part("possible","root","可能的")]
notes["impossible"]="否定前缀 in- 在 possible 的 p 前写成 im-。不要把所有以 im 开头的词都按这个规则拆分。"
compounds={
"classroom":[("class","班级；课"),("room","房间")],"homework":[("home","家"),("work","工作；功课")],
"notebook":[("note","笔记"),("book","本子；书")],"bedroom":[("bed","床"),("room","房间")],
"bathroom":[("bath","洗澡"),("room","房间")],"living room":[("living","生活；起居"),("room","房间")],
"dining room":[("dining","用餐"),("room","房间")],"bookshelf":[("book","书"),("shelf","架子")],
"armchair":[("arm","手臂；扶手"),("chair","椅子")],"upstairs":[("up","向上"),("stairs","楼梯")],
"downstairs":[("down","向下"),("stairs","楼梯")],"airport":[("air","空中"),("port","港；运输枢纽")],
"railway":[("rail","铁轨"),("way","路")],"bookshop":[("book","书"),("shop","商店")],
"postcard":[("post","邮寄"),("card","卡片")],"post office":[("post","邮政"),("office","办公处")],
"raincoat":[("rain","雨"),("coat","外套")],"thunderstorm":[("thunder","雷"),("storm","暴风雨")],
"football":[("foot","脚"),("ball","球")],"basketball":[("basket","篮"),("ball","球")],
"volleyball":[("volley","空中击球"),("ball","球")],"skateboard":[("skate","滑行"),("board","板")],
"surfboard":[("surf","冲浪"),("board","板")],"headache":[("head","头"),("ache","疼痛")],
"toothache":[("tooth","牙"),("ache","疼痛")],"sunglasses":[("sun","太阳"),("glasses","眼镜")],
"handbag":[("hand","手"),("bag","包")],"backpack":[("back","背"),("pack","包")],
"weekend":[("week","周"),("end","末尾")],"weekday":[("week","周"),("day","天")],
"keyboard":[("key","按键"),("board","板")],"website":[("web","网络"),("site","站点")],
"newspaper":[("news","新闻"),("paper","纸；报纸")],
}
for word,items in compounds.items():
 parts[word]=[part(t,"compound",m) for t,m in items]
 notes[word]="这是现代英语中可以辨认的合成成分。把两个意思连起来理解，再用例句确认完整词义。"
for word in ("teacher","singer","writer","player"):
 for p in parts[word]:
  if p["kind"]=="root":
   parts.setdefault(p["text"],[p])
for word in ("butterfly","butter","finger","summer","flower","engineer","strawberry","breakfast"):
 notes[word]="本课整体记忆。相同字母不等于相同词根；请结合例句回忆实际含义。"
variants={"practise":"practice","neighbour":"neighbor","theatre":"theater","yogurt":"yoghurt","biscuit":"cookie","bookshop":"bookstore","autumn":"fall","football":"soccer","mobile phone":"cell phone"}
rows=[];seen=set();topic=""
for line in (ROOT/"data/ket-authoring.txt").read_text().splitlines():
 if line.startswith("#"):topic=line[1:];continue
 if not line:continue
 word,pos,meaning,example,example_zh=line.split("|")
 if word in seen or word in EXCLUDED:continue
 seen.add(word)
 if word=="instruction":
  word,pos,example,example_zh="instructions","n. pl.","Read the instructions before you start.","开始前阅读说明。"
 rows.append(dict(word=word,level="KET",difficulty=1 if word in EASY or word in BASIC else 3 if word in HARD else 2,
  meaning_zh=meaning,pos=pos,topic=topic,example=example,example_zh=example_zh,
  parts_json=json.dumps(parts.get(word,[]),ensure_ascii=False),note=notes.get(word,"结合例句与生活场景整体记忆，不按相同字母强行拆词。"),
  is_basic=int(word in BASIC),accepted=variants.get(word,""),source=CAM))
with (ROOT/"data/ket-teaching.csv").open("w",encoding="utf-8-sig",newline="") as f:
 writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
report={"version":"2026-09-06","count":len(rows),"basic":sum(r["is_basic"] for r in rows),"morphology_words":sum(r["parts_json"]!="[]" for r in rows),"scope":"KET A2 Key curated subset; original Chinese teaching copy and examples","reference":CAM,"reference_version":"August 2025","excluded_candidates":sorted(EXCLUDED),"difficulty_note":"Editorial classroom difficulty 1-3; not an official Cambridge grading."}
(ROOT/"data/teaching-subset-validation.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=True))
