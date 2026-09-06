#!/usr/bin/env python3
"""Reproducible expansion using local official scope extraction + MIT ECDICT."""
import csv,json,re,unicodedata,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
TMP=ROOT/"data/reference"
CAM={"KET":"https://www.cambridgeenglish.org/images/506886-a2-key-2020-vocabulary-list.pdf","PET":"https://www.cambridgeenglish.org/images/506887-b1-preliminary-vocabulary-list.pdf"}
LEXURL="https://github.com/skywind3000/ECDICT"
lex={r["word"].lower():r for r in csv.DictReader((TMP/"word-garden-ecdict.csv").open())}
curated={r["word"]:r for r in csv.DictReader((ROOT/"data/ket-teaching.csv").open(encoding="utf-8-sig"))}
pet={}
for ln in (ROOT/"data/pet-teaching.txt").read_text().splitlines():
 if not ln or ln.startswith("#"):continue
 w,p,m,e,z=ln.split("|");pet[w]=(p,m,e,z)
basic=set("a an the lot lots many much some any all each every few little more most other another am is are be been being was were do does did have has had of to in on at by for from and or but so as if with without about above across after again against ago along also always around away back because before behind below beside best better between both can cannot could would should will may must might my your his her its our their mine yours hers ours theirs me him us them myself yourself himself herself ourselves themselves this that these those here there who whose which what when where how why yes no not now then just only own once twice one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety hundred thousand first second third last next same such very really too than through until upon while since somebody someone something anybody anyone anything everybody everyone everything nobody nothing anywhere everywhere somewhere okay ok hello hi hey goodbye bye thanks thank welcome please sorry pardon sir madam mr mrs miss ms dr dad mum mom mummy daddy mother father brother sister son daughter man woman boy girl child children baby people person good bad big small new old young go come get make take put see look say tell ask give use want like love live eat drink sleep sit stand walk run play help work read write open close hot cold warm cool long short tall high low red blue green yellow black white brown pink purple grey gray orange monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december today yesterday tomorrow day week month year morning afternoon evening night time hour minute home house room door window wall floor table chair bed book pen pencil bag box cup glass bottle plate milk water bread rice egg apple banana cat dog bird fish tree car bus train bike foot hand arm leg head eye ear nose mouth hair face name age school class teacher student friend family happy sad fine great nice easy true false right wrong up down out off over under inside outside near far".split())
OVERRIDES={"bank":"银行","bat":"球棒；球拍","present":"礼物；现在","capital":"首都","spring":"春天","mean":"意思是；意指","miss":"未赶上；错过；想念","fit":"适合；健康的","fine":"好的；晴朗的","free":"免费的；自由的","club":"俱乐部","court":"球场","date":"日期","match":"比赛","post":"邮寄；邮件","second":"秒；第二","light":"光；灯；轻的","round":"圆的；围绕","change":"改变；零钱","bill":"账单","lie":"躺；说谎","receipt":"收据","accommodation":"住宿；膳宿","IT":"信息技术","PC":"个人电脑","ID":"身份证明"}
EXTRA={"social media":("n.","社交媒体"),"tourist information centre":("n.","游客信息中心"),"dvd player":("n.","DVD 播放器"),"get fit":("v.","锻炼以保持健康"),"extreme sport":("n.","极限运动"),"ice skates":("n. pl.","溜冰鞋"),"in ink":("prep. phr.","用墨水"),"in pencil":("prep. phr.","用铅笔"),"motor-racing":("n.","赛车运动"),"stay behind":("phr. v.","留下来")}
def definition(entry,pos):
 lines=entry["translation"].replace("\\n","\n").splitlines()
 lines=[x for x in lines if not x.startswith("[")]
 first=pos.split()[0]
 tags={"adj":("a.","adj."),"adv":("adv.",),"v":("v.","vt.","vi."),"n":("n.",)}
 candidates=[s for s in lines if s.startswith(tags.get(first,("~",)))]
 text=(candidates or lines or [""])[0]
 text=re.sub(r"^[a-z./ ]+\.\s*","",text)
 text=re.sub(r"\[[^]]*\]|\\[^ ]+","",text).strip()
 pieces=[p.strip() for p in re.split("[,，;；]",text) if p.strip()]
 return "；".join(pieces[:3])[:180]
def topic(meaning):
 for title,keys in [("学校与学习","学习教师课程考试教育书写阅读"),("旅行与城市","旅行车船飞机游客酒店道路车站街"),("自然与环境","天气植物动物森林河海环境"),("食物与生活","食物饭菜肉水果蔬糖烹饪厨房"),("人物与社会","人员职业社会家庭朋友"),("感受与表达","情绪感情感觉高兴悲伤思考意见")]:
  if any(k in meaning for k in [keys[i:i+2] for i in range(0,len(keys)-1,2)]):return title
 return "日常沟通"
report={}
for level in ("KET","PET"):
 matched=json.loads((TMP/("word-garden-"+level.lower()+"-matched.json")).read_text())
 heads=json.loads((TMP/("word-garden-"+level.lower()+"-heads.json")).read_text())
 allowed=set(matched)
 rows={}; missing=[]
 for word,(head,pos) in matched.items():
  ent=lex[word]
  meaning=OVERRIDES.get(word) or definition(ent,pos)
  if not meaning or not re.search("[\u4e00-\u9fff]",meaning):
   missing.append(word);continue
  rank=int(ent["bnc"]) if ent["bnc"].isdigit() and int(ent["bnc"])>0 else 99999
  diff=1 if word in basic or rank<=2000 else 2 if rank<=7000 else 3
  data=dict(word=word,level=level,difficulty=diff,meaning_zh=meaning,pos=pos.replace(" & ","; ")+".",topic=topic(meaning),
   example="",example_zh="",parts_json="[]",note="结合常用释义整体记忆。先听老师读，再用自己的生活场景解释。",
   is_basic=int(word in basic or pos in ("pron","det","conj","av","mv")),accepted="",source=CAM[level],
   phonetic=ent.get("phonetic",""),definition_source=LEXURL,content_status="dictionary")
  if word in curated:
   data.update(curated[word]);data.update(level=level,is_basic=int(word in basic or word in ("a","an","lot","many")),content_status="teaching",definition_source="原创课堂释义与例句")
  if level=="PET" and word in pet:
   p,m,e,z=pet[word];data.update(pos=p,meaning_zh=m,example=e,example_zh=z,content_status="teaching",definition_source="原创课堂释义与例句")
  rows[word]=data
 for word,(pos,meaning) in EXTRA.items():
  if any(word==h[0].lower() for h in heads):
   rows[word]=dict(word=word,level=level,difficulty=2,meaning_zh=meaning,pos=pos,topic="日常沟通",example="",example_zh="",parts_json="[]",
    note="作为一个常用表达整体理解，先跟读再结合场景练习。",is_basic=0,accepted="",source=CAM[level],phonetic="",definition_source="原创课堂释义",content_status="teaching")
 # Preserve checked canonical variants and the original contextual teaching subset.
 for word,r in curated.items():
  if level=="KET" or word in allowed:
   rows[word]=dict(rows.get(word,{}),**r,phonetic=lex.get(word,{}).get("phonetic",""),definition_source="原创课堂释义与例句",content_status="teaching")
   rows[word].update(level=level,is_basic=int(word in basic or word in ("a","an","lot","many")))
 ordered=sorted(rows.values(),key=lambda r:(r["topic"],r["word"]))
 fields=["word","level","difficulty","meaning_zh","pos","topic","example","example_zh","parts_json","note","is_basic","accepted","source","phonetic","definition_source","content_status"]
 with (ROOT/"data"/(level.lower()+".csv")).open("w",encoding="utf-8-sig",newline="") as f:
  writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(ordered)
 report[level]={"scope_rows":len(heads),"scope_unique_rows":len(set(h[0].lower() for h in heads)),"included":len(rows),"basic":sum(int(r["is_basic"]) for r in ordered),"teachable":sum(not int(r["is_basic"]) for r in ordered),"with_examples":sum(bool(r["example"]) for r in ordered),"with_morphology":sum(r["parts_json"]!="[]" for r in ordered),"missing_translations":missing}
(ROOT/"data/coverage.json").write_text(json.dumps(report,ensure_ascii=False,indent=2))
print(json.dumps(report,ensure_ascii=True))
