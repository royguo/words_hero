#!/usr/bin/env python3
import csv,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
GRAM="https://dictionary.cambridge.org/grammar/british-grammar/word-formation_2"
stories={
"-er":("表示做事者的 -er 有古英语 -ere 等历史来源。它常把动作变成做这个动作的人；比较级里的 -er 是另一种用法。","https://www.merriam-webster.com/dictionary/-er"),
"-ful":("-ful 可追溯到古英语中表示“满的”的 full。今天它常表示具有某种特征，作后缀时只写一个 l。","https://www.merriam-webster.com/dictionary/-ful"),
"-less":("-less 的历史形式来自古英语 -lēas，表示缺少。它与表示“更少”的独立单词 less 不能简单当成同一种来历。","https://www.merriam-webster.com/dictionary/-less"),
"-ness":("-ness 在古英语中已经用来构成表示性质或状态的名词。它让我们可以谈论某种抽象的品质。","https://www.merriam-webster.com/dictionary/-ness"),
"un-":("表示否定的 un- 在古英语中就已存在，意思是“不”。加在形容词前，常能把词义转向相反的一边。","https://www.merriam-webster.com/dictionary/un-"),
"re-":("re- 经由法语进入英语，更早可追溯到拉丁语，带有“回来、再次”的意思。这里选用重新做某事的用法。","https://www.merriam-webster.com/dictionary/re-")
}
def part(t,k,m):
 p={"text":t,"kind":k,"meaning":m}
 if t in stories and not (t=="un-" and m=="解除；逆转动作"):p["story"],p["source"]=stories[t]
 return p
mappings={};notes={};bases={}
for ln in (ROOT/"data/morphology-authoring.txt").read_text().splitlines():
 if ln.startswith("#"):affix,kind,meaning=ln[1:].split("|");continue
 if not ln:continue
 word,base,base_meaning=ln.split("|")
 if word in ("passenger","hardly","information","celebration","explanation"):continue
 p=part(base,"root",base_meaning)
 a=part(affix,kind,meaning)
 mappings[word]=[a,p] if kind=="prefix" else [p,a]
 bases.setdefault(base,p)
 raw=(affix.rstrip("-")+base) if kind=="prefix" else base+affix.lstrip("-")
 notes[word]="先理解词基，再看词缀如何改变含义或词性。"
 if word!=raw:notes[word]="这是词基与派生词的关系。拼写发生了变化，请把本课目标单词完整写对；构词成分不是原词的逐字切片。"
mappings["information"]=[part("inform","root","告知"),part("-ation","suffix","动作或结果（构成名词）")]
mappings["celebration"]=[part("celebrate","root","庆祝"),part("-ion","suffix","动作或结果（构成名词）")]
notes["celebration"]="celebrate 去掉词尾不发音的 e，再接 -ion。"
for ln in (ROOT/"data/compound-authoring.txt").read_text().splitlines():
 if not ln:continue
 items=ln.split("|");word=items[0]
 if len(items)<3:continue
 mappings[word]=[part(*[item.split(":")[0],"compound",item.split(":")[1]]) for item in items[1:]]
 notes[word]="两个已有成分组合成一个词。结合它们的意思理解整体词义，但不要把这种现代拆分当作完整的历史词源。"
extras={
 "app":("n.","应用程序","Open the school app.","打开学校应用程序。"),
 "credit card":("n.","信用卡","You can pay by credit card.","你可以用信用卡付款。"),
 "grocery store":("n.","食品杂货店","We buy fruit at the grocery store.","我们在食品杂货店买水果。"),
 "internet":("n.","互联网","We find the timetable on the internet.","我们在互联网上找到时刻表。"),
 "laptop":("n.","笔记本电脑","I put my laptop on the desk.","我把笔记本电脑放在桌上。"),
 "online":("adj.; adv.","在线的；在线地","The museum sells tickets online.","这家博物馆在网上售票。"),
 "police car":("n.","警车","A police car stops near the school.","一辆警车停在学校附近。"),
 "rainforest":("n.","热带雨林","Many animals live in the rainforest.","许多动物生活在热带雨林中。"),
 "video game":("n.","电子游戏","This video game is about a journey.","这个电子游戏讲的是一次旅程。"),
 "working hours":("n. pl.","工作时间","Her working hours are from nine to five.","她的工作时间是九点到五点。"),
 "cashpoint":("n.","自动取款机","There is a cashpoint beside the bank.","银行旁边有一台自动取款机。"),
 "cross out":("phr. v.","划掉","Cross out the wrong answer.","划掉错误答案。"),
 "full stop":("n.","句号","Put a full stop at the end.","在末尾加一个句号。"),
 "recycling":("n.","回收利用","Recycling can reduce waste.","回收利用可以减少浪费。"),
 "remote control":("n.","遥控器","The remote control is on the sofa.","遥控器在沙发上。"),
 "security guard":("n.","保安","The security guard opens the gate.","保安打开大门。"),
 "step over":("phr. v.","跨过","Please step over the small branch.","请跨过这根小树枝。"),
}
report=json.loads((ROOT/"data/coverage.json").read_text())
# Words below appeared in source examples as grammatical abbreviations, not headwords.
artifacts={"v","sb"}
for level in ("KET","PET"):
 path=ROOT/"data"/(level.lower()+".csv")
 rows={r["word"]:r for r in csv.DictReader(path.open(encoding="utf-8-sig")) if r["word"] not in artifacts}
 matched=json.loads((ROOT/"data/reference"/("word-garden-"+level.lower()+"-matched.json")).read_text())
 for w,(p,m,e,z) in extras.items():
  if w in matched and w not in rows:
   rows[w]=dict(word=w,level=level,difficulty=2,meaning_zh=m,pos=p,topic="日常沟通",example=e,example_zh=z,parts_json="[]",
    note="结合例句和场景整体记忆。",is_basic=0,accepted="",source="https://www.cambridgeenglish.org/images/"+("506886-a2-key-2020-vocabulary-list.pdf" if level=="KET" else "506887-b1-preliminary-vocabulary-list.pdf"),phonetic="",definition_source="原创课堂释义与例句",content_status="teaching")
 for w,r in rows.items():
  if w in mappings and r["parts_json"]=="[]":
   r["parts_json"]=json.dumps(mappings[w],ensure_ascii=False);r["note"]=notes.get(w,"先理解词基，再理解完整的词义。")
  elif w in bases and r["parts_json"]=="[]":
   r["parts_json"]=json.dumps([bases[w]],ensure_ascii=False);r["note"]="这个词本身可以作为词基，与相关派生词联系起来理解。"
 # Fix common sense mismatches and inconsistent glosses for school use.
 corrections={"bat":"球棒；球拍","accommodation":"住宿；膳宿","present":"礼物；现在","second":"秒；第二","it":"它；信息技术（缩写 IT）"}
 for w,m in corrections.items():
  if w in rows:rows[w]["meaning_zh"]=m
 proper={"english","french","german","spanish","chinese","italian","american","british","australian","canadian","indian","japanese"}
 for r in rows.values():
  if r["word"] in proper:r["display_word"]=r["word"].capitalize()
  else:r["display_word"]=r["word"]
 fields=list(next(iter(rows.values())))
 if "display_word" not in fields:fields.append("display_word")
 with path.open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(sorted(rows.values(),key=lambda r:(r["topic"],r["word"])))
 report[level].update(included=len(rows),basic=sum(int(r["is_basic"]) for r in rows.values()),teachable=sum(not int(r["is_basic"]) for r in rows.values()),with_examples=sum(bool(r["example"]) for r in rows.values()),with_morphology=sum(r["parts_json"]!="[]" for r in rows.values()),missing_translations=[w for w in report[level]["missing_translations"] if w not in rows and w not in artifacts])
(ROOT/"data/coverage.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=True))
