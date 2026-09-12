"""Transactional classroom-scoped persistence. All teaching content is versioned."""
import hashlib
import json
import random
import re
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from content import ROOT, LEVELS, UserError, dump, integer, now, parse_csv, root_groups, normalize_answer
from assets import ASSET_ROOT, enrich_words, load_bundle
from worksheets import worksheet_plan

class Store:
    def __init__(self, path, seed=ROOT/"data"/"ket.csv", asset_root=ASSET_ROOT):
        self.path=Path(path)
        self.asset_root=Path(asset_root)
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript("""
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS vocabulary(id INTEGER PRIMARY KEY,level TEXT NOT NULL,word TEXT NOT NULL,
 difficulty INTEGER NOT NULL,is_basic INTEGER NOT NULL,data TEXT NOT NULL,UNIQUE(level,word));
CREATE TABLE IF NOT EXISTS classrooms(id TEXT PRIMARY KEY,name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classrooms(id),
 number INTEGER NOT NULL,title TEXT NOT NULL,created_at TEXT NOT NULL,active_version TEXT,
 UNIQUE(class_id,number));
CREATE TABLE IF NOT EXISTS versions(id TEXT PRIMARY KEY,lesson_id TEXT NOT NULL REFERENCES lessons(id),
 number INTEGER NOT NULL,level TEXT NOT NULL,mode TEXT NOT NULL,created_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'active',completed_at TEXT,stage TEXT NOT NULL DEFAULT 'preview',
 cursor INTEGER NOT NULL DEFAULT 0,notes TEXT NOT NULL DEFAULT '',config TEXT NOT NULL,
 draft TEXT NOT NULL DEFAULT '{}',UNIQUE(lesson_id,number));
CREATE TABLE IF NOT EXISTS version_words(version_id TEXT NOT NULL REFERENCES versions(id),
 word_id INTEGER NOT NULL REFERENCES vocabulary(id),position INTEGER NOT NULL,snapshot TEXT NOT NULL,result TEXT,
 PRIMARY KEY(version_id,word_id),UNIQUE(version_id,position));
CREATE TABLE IF NOT EXISTS progress(class_id TEXT NOT NULL REFERENCES classrooms(id),
 word_id INTEGER NOT NULL REFERENCES vocabulary(id),seen_at TEXT NOT NULL,due_at TEXT NOT NULL,
 interval_days INTEGER NOT NULL,reviews INTEGER NOT NULL,result TEXT NOT NULL,PRIMARY KEY(class_id,word_id));
CREATE TABLE IF NOT EXISTS attempts(id TEXT PRIMARY KEY,version_id TEXT NOT NULL REFERENCES versions(id),
 created_at TEXT NOT NULL,correct INTEGER NOT NULL,total INTEGER NOT NULL,data TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_vocab_scope ON vocabulary(level,difficulty,is_basic);
CREATE INDEX IF NOT EXISTS idx_vocab_word ON vocabulary(word);
CREATE INDEX IF NOT EXISTS idx_versions_lesson ON versions(lesson_id);
CREATE INDEX IF NOT EXISTS idx_version_words_word ON version_words(word_id);
CREATE INDEX IF NOT EXISTS idx_progress_class_due ON progress(class_id,due_at);
CREATE INDEX IF NOT EXISTS idx_attempts_version ON attempts(version_id,created_at);
CREATE TABLE IF NOT EXISTS lesson_drafts(id TEXT PRIMARY KEY,class_id TEXT NOT NULL REFERENCES classrooms(id),
 lesson_id TEXT REFERENCES lessons(id),base_version_id TEXT,title TEXT NOT NULL,config TEXT NOT NULL,
 words TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 committed_version TEXT REFERENCES versions(id));
CREATE INDEX IF NOT EXISTS idx_draft_context ON lesson_drafts(class_id,lesson_id,created_at);
CREATE TABLE IF NOT EXISTS course_codes(code TEXT PRIMARY KEY,version_id TEXT NOT NULL UNIQUE REFERENCES versions(id));
""")
            db.execute("INSERT OR IGNORE INTO meta VALUES('schema_version','2')")
            for row in db.execute("SELECT id FROM versions WHERE id NOT IN (SELECT version_id FROM course_codes)").fetchall():
                self.assign_course_code(db,row["id"])
            seeds=[seed] if seed else []
            if seed and seed.name=="ket.csv": seeds.append(seed.with_name("pet.csv"))
            for source in seeds:
                if not source.exists(): continue
                text=source.read_text(encoding="utf-8-sig")
                digest=hashlib.sha256(text.encode()).hexdigest()
                key="seed_digest:"+source.name
                old=db.execute("SELECT value FROM meta WHERE key=?",(key,)).fetchone()
                if not old or old[0]!=digest:
                    self.import_words(db,parse_csv(text,"PET" if source.name=="pet.csv" else "KET"))
                    db.execute("INSERT OR REPLACE INTO meta VALUES(?,?)",(key,digest))

    @contextmanager
    def connect(self):
        db=sqlite3.connect(str(self.path),timeout=10)
        db.row_factory=sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            with db:yield db
        finally:db.close()

    def import_words(self,db,words):
        for w in words:
            db.execute("""INSERT INTO vocabulary(level,word,difficulty,is_basic,data) VALUES(?,?,?,?,?)
ON CONFLICT(level,word) DO UPDATE SET difficulty=excluded.difficulty,is_basic=excluded.is_basic,data=excluded.data""",
                (w["level"],w["word"],w["difficulty"],int(w["is_basic"]),dump(w)))

    def assign_course_code(self,db,vid):
        while True:
            code="WG-"+uuid.uuid4().hex[:10].upper()
            if not db.execute("SELECT 1 FROM course_codes WHERE code=?",(code,)).fetchone():
                db.execute("INSERT INTO course_codes VALUES(?,?)",(code,vid))
                return code

    def course_by_code(self,db,code):
        row=db.execute("SELECT version_id FROM course_codes WHERE code=?",(str(code).strip().upper(),)).fetchone()
        if not row:raise UserError("课程编号不存在，请从课程页面复制完整编号",404)
        return self.by_version(db,row["version_id"])

    def material_brief(self,code):
        with self.connect() as db:
            lesson=self.course_by_code(db,code)
        return {"schema_version":1,"course_code":lesson["course_code"],"level":lesson["level"],
            "word_order":[w["word"] for w in lesson["words"]],
            "instructions":"阅读 AGENTS.md，保持词单和顺序不变。复用适合词义的素材，为每个词准备写实图片；故事每页一个情节，放在构词之后。制作后 validate，再 apply 到此编号。",
            "words":[{k:w.get(k) for k in ("word","level","meaning_zh","pos","difficulty","example","example_zh","extra_examples","parts","word_study","asset_id")} for w in lesson["words"]],
            "materials":lesson["materials"]}

    def attach_materials(self,code,bundle_id):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous=self.course_by_code(db,code)
            if previous["read_only"]:raise UserError("只能给当前未结课版本绑定素材，历史版本保持原样",409)
            words,materials=load_bundle(bundle_id,previous["words"],self.asset_root)
            if previous["materials"]==materials and previous["words"]==words:return previous
            vid=uuid.uuid4().hex
            number=db.execute("SELECT MAX(number)+1 FROM versions WHERE lesson_id=?",(previous["id"],)).fetchone()[0]
            config=dict(previous["config"],materials=materials,root_groups=root_groups(words))
            config["worksheets"]=worksheet_plan(words,config["root_groups"],config.get("worksheet_order"),vid)
            config.pop("presentation_slide",None)
            db.execute("INSERT INTO versions(id,lesson_id,number,level,mode,created_at,config,notes) VALUES(?,?,?,?,?,?,?,?)",
                (vid,previous["id"],number,previous["level"],previous["mode"],now(),dump(config),previous["notes"]))
            self.assign_course_code(db,vid)
            for i,w in enumerate(words):
                snapshot={k:v for k,v in w.items() if k not in ("id","result")}
                db.execute("INSERT INTO version_words(version_id,word_id,position,snapshot,result) VALUES(?,?,?,?,?)",(vid,w["id"],i,dump(snapshot),w["result"]))
            db.execute("UPDATE lessons SET active_version=? WHERE id=?",(vid,previous["id"]))
            return self.lesson(previous["id"],db=db)

    def create_class(self,data):
        name=data.get("name","")
        if not isinstance(name,str) or not name.strip() or len(name)>50:
            raise UserError("请填写 1–50 个字符的班级名称")
        with self.connect() as db:
            cid=uuid.uuid4().hex
            db.execute("INSERT INTO classrooms VALUES(?,?,?)",(cid,name.strip(),now()))
        return {"id":cid,"name":name.strip()}

    def class_exists(self,db,cid):
        if not db.execute("SELECT 1 FROM classrooms WHERE id=?",(cid,)).fetchone():
            raise UserError("班级不存在",404)

    def state(self,cid=None):
        with self.connect() as db:
            classes=[dict(r) for r in db.execute("""SELECT c.*,
(SELECT COUNT(*) FROM lessons l WHERE l.class_id=c.id) AS lesson_count,
(SELECT COUNT(*) FROM progress p WHERE p.class_id=c.id) AS learned
FROM classrooms c ORDER BY created_at,rowid""")]
            levels=[{"id":level,"total":db.execute("SELECT COUNT(*) FROM vocabulary WHERE level=?",(level,)).fetchone()[0]} for level in LEVELS]
            lessons=[];learned=due=0
            if cid:
                self.class_exists(db,cid)
                lessons=[dict(r) for r in db.execute("""SELECT l.*,v.status,v.level,v.stage,v.completed_at,
(SELECT COUNT(*) FROM version_words w WHERE w.version_id=v.id) AS word_count,
(SELECT COUNT(*) FROM version_words w WHERE w.version_id=v.id AND w.result='remembered') AS remembered,
(SELECT COUNT(*) FROM versions v2 WHERE v2.lesson_id=l.id) AS version_count
FROM lessons l JOIN versions v ON v.id=l.active_version WHERE l.class_id=? ORDER BY l.number DESC""",(cid,))]
                learned=db.execute("SELECT COUNT(*) FROM progress WHERE class_id=?",(cid,)).fetchone()[0]
                due=db.execute("SELECT COUNT(*) FROM progress WHERE class_id=? AND due_at<=?",(cid,now())).fetchone()[0]
            return {"classes":classes,"levels":levels,"lessons":lessons,"learned":learned,"due":due,"database":self.path.name}

    def lesson(self,lid,version_id=None,db=None):
        if db is None:
            with self.connect() as conn:return self.lesson(lid,version_id,conn)
        row=db.execute("SELECT l.*,c.name AS class_name FROM lessons l JOIN classrooms c ON c.id=l.class_id WHERE l.id=?",(lid,)).fetchone()
        if not row:raise UserError("课程不存在",404)
        version_id=version_id or row["active_version"]
        v=db.execute("SELECT * FROM versions WHERE id=? AND lesson_id=?",(version_id,lid)).fetchone()
        if not v:raise UserError("课程版本不存在",404)
        lesson=dict(row)
        lesson.update(dict(v))
        lesson["id"]=lid
        lesson["version_id"]=v["id"]
        lesson["version_number"]=v["number"]
        lesson["number"]=row["number"]
        lesson["is_current"]=version_id==row["active_version"]
        lesson["read_only"]=not lesson["is_current"] or v["status"]=="completed"
        lesson["config"]=json.loads(v["config"])
        lesson["course_code"]=db.execute("SELECT code FROM course_codes WHERE version_id=?",(version_id,)).fetchone()[0]
        lesson["materials"]=lesson["config"].get("materials",{})
        lesson["draft"]=json.loads(v["draft"])
        lesson["words"]=[dict(json.loads(w["snapshot"]),id=w["word_id"],result=w["result"]) for w in
            db.execute("SELECT * FROM version_words WHERE version_id=? ORDER BY position",(version_id,))]
        lesson["groups"]=lesson["config"]["root_groups"] if "root_groups" in lesson["config"] else root_groups(lesson["words"])
        lesson["versions"]=[dict(x) for x in db.execute("SELECT id,number,created_at,status FROM versions WHERE lesson_id=? ORDER BY number DESC",(lid,))]
        lesson["attempts"]=[dict(x,data=json.loads(x["data"])) for x in db.execute("SELECT * FROM attempts WHERE version_id=? ORDER BY created_at DESC,rowid DESC",(version_id,))]
        return lesson

    def candidates(self,db,cid,config,exclude_lesson=None):
        self.class_exists(db,cid)
        level=config.get("level","KET")
        selected=config.get("levels") or [level]
        low=integer(config.get("difficulty_min",1),1,3,"最低难度")
        high=integer(config.get("difficulty_max",3),1,3,"最高难度")
        if (low>high or not isinstance(selected,list) or not selected or len(selected)>len(LEVELS)
                or len(set(selected))!=len(selected) or any(scope not in LEVELS for scope in selected)):
            raise UserError("请选择有效的词表和难度范围")
        if config.get("mode","new") not in ("new","mixed","review"):raise UserError("课程模式不正确")
        for key in ("exclude_basic","exclude_seen"):
            if not isinstance(config.get(key,True),bool):raise UserError("过滤条件格式不正确")
        rows=db.execute("""SELECT v.*,p.due_at FROM vocabulary v
LEFT JOIN progress p ON p.class_id=? AND p.word_id=(
 SELECT p2.word_id FROM progress p2 JOIN vocabulary pv ON pv.id=p2.word_id
 WHERE p2.class_id=? AND pv.word=v.word ORDER BY p2.seen_at DESC LIMIT 1)
WHERE v.level IN (%s) AND v.difficulty BETWEEN ? AND ?""" % ",".join("?" for _ in selected),
            (cid,cid,*selected,low,high)).fetchall()
        priority={scope:i for i,scope in enumerate(selected)}
        unique={}
        for row in sorted(rows,key=lambda item:priority[item["level"]]):
            unique.setdefault(normalize_answer(row["word"]),row)
        return [r for r in unique.values() if not config.get("exclude_basic",True) or not r["is_basic"]]

    def pool(self,cid,data,lid=None):
        with self.connect() as db:
            rows=self.candidates(db,cid,data,lid)
            fresh=[r for r in rows if not r["due_at"]]
            due=[r for r in rows if r["due_at"] and r["due_at"]<=now()]
            mode=data.get("mode","new")
            available=len(due) if mode=="review" else len(fresh)+len(due) if mode=="mixed" else len(fresh) if data.get("exclude_seen",True) else len(rows)
            return {"available":available,"new":len(fresh),"due":len(due)}

    def generate(self,cid,data,lid=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous=self.selection_target(db,cid,lid)
            chosen=self.select_words(db,cid,data,lid,previous)
            return self.create_version(db,cid,data,lid,chosen)

    def selection_target(self,db,cid,lid):
        self.class_exists(db,cid)
        if not lid:return None
        previous=self.lesson(lid,db=db)
        if previous["class_id"]!=cid:raise UserError("课程不属于当前班级",403)
        if previous["status"]=="completed":raise UserError("已结课的内容已归档，请新建一课")
        return previous

    def select_words(self,db,cid,data,lid=None,previous=None):
        count=integer(data.get("count",10),5,100,"每课词数")
        title=data.get("title","")
        if not isinstance(title,str) or len(title)>80:raise UserError("课程名称最多 80 个字符")
        rows=self.candidates(db,cid,data,lid)
        old={w["id"] for w in previous["words"]} if previous else set()
        rng=random.SystemRandom()
        def order(pool):
            pool=list(pool);rng.shuffle(pool)
            return [r for r in pool if r["id"] not in old]+[r for r in pool if r["id"] in old]
        fresh=order(r for r in rows if not r["due_at"])
        due=order(r for r in rows if r["due_at"] and r["due_at"]<=now())
        mode=data.get("mode","new")
        if mode=="review":chosen=due[:count]
        elif mode=="mixed":
            review_count=min(len(due),max(1,count//5))
            chosen=due[:review_count]
            chosen+=fresh[:count-len(chosen)]
            chosen+=due[review_count:review_count+max(0,count-len(chosen))]
        else:chosen=(fresh if data.get("exclude_seen",True) else order(rows))[:count]
        rng.shuffle(chosen)
        return chosen

    def create_version(self,db,cid,data,lid,chosen,confirmed=False):
        if not chosen:raise UserError("请至少选择一个单词，再确认创建课程。")
        rng=random.SystemRandom()
        if not lid:
            lid=uuid.uuid4().hex
            number=db.execute("SELECT COALESCE(MAX(number),0)+1 FROM lessons WHERE class_id=?",(cid,)).fetchone()[0]
            db.execute("INSERT INTO lessons(id,class_id,number,title,created_at) VALUES(?,?,?,?,?)",
                (lid,cid,number,data.get("title","").strip() or "第 %02d 课"%number,now()))
        vid=uuid.uuid4().hex
        vn=db.execute("SELECT COALESCE(MAX(number),0)+1 FROM versions WHERE lesson_id=?",(lid,)).fetchone()[0]
        config={k:data.get(k,v) for k,v in {"level":"KET","count":10,"difficulty_min":1,"difficulty_max":3,"exclude_basic":True,"exclude_seen":True,"mode":"new"}.items()}
        config["levels"]=list(data.get("levels") or [config["level"]])
        config["level"]=config["levels"][0]
        forward=[r["id"] for r in chosen];reverse=list(forward)
        rng.shuffle(forward);rng.shuffle(reverse)
        config["worksheet_order"]={"english_to_chinese":forward,"chinese_to_english":reverse}
        content=[json.loads(r["data"]) for r in chosen]
        if not confirmed:content=enrich_words(content,self.asset_root)
        config["root_groups"]=root_groups(content)
        config["worksheets"]=worksheet_plan([dict(w,id=r["id"]) for w,r in zip(content,chosen)],config["root_groups"],config["worksheet_order"],vid)
        config["materials_version"]="2026-09-v3"
        levels=[level for level in LEVELS if any(w["level"]==level for w in content)]
        config.update(new_count=sum(not r["due_at"] for r in chosen),review_count=sum(bool(r["due_at"]) for r in chosen),requested_count=data.get("count",10),source_levels=levels,selection_confirmed=confirmed)
        if confirmed:config["count"]=len(chosen)
        db.execute("INSERT INTO versions(id,lesson_id,number,level,mode,created_at,config) VALUES(?,?,?,?,?,?,?)",
            (vid,lid,vn," + ".join(levels),config["mode"],now(),dump(config)))
        self.assign_course_code(db,vid)
        for i,r in enumerate(chosen):
            db.execute("INSERT INTO version_words(version_id,word_id,position,snapshot) VALUES(?,?,?,?)",(vid,r["id"],i,dump(content[i])))
        db.execute("UPDATE lessons SET active_version=? WHERE id=?",(vid,lid))
        return self.lesson(lid,db=db)

    def preview(self,cid,data,lid=None):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            previous=self.selection_target(db,cid,lid)
            chosen=self.select_words(db,cid,data,lid,previous)
            words=enrich_words([dict(json.loads(r["data"]),id=r["id"]) for r in chosen],self.asset_root)
            did=uuid.uuid4().hex
            config={k:data.get(k,v) for k,v in {"level":"KET","count":10,"difficulty_min":1,"difficulty_max":3,"exclude_basic":True,"exclude_seen":True,"mode":"new"}.items()}
            config["levels"]=list(data.get("levels") or [config["level"]])
            config["level"]=config["levels"][0]
            db.execute("INSERT INTO lesson_drafts(id,class_id,lesson_id,base_version_id,title,config,words,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (did,cid,lid,previous["version_id"] if previous else None,data.get("title","").strip(),dump(config),dump(words),now(),now()))
            return self.read_draft(db,did)

    def read_draft(self,db,did):
        row=db.execute("SELECT * FROM lesson_drafts WHERE id=?",(did,)).fetchone()
        if not row:raise UserError("选词草稿不存在",404)
        return dict(row,config=json.loads(row["config"]),words=json.loads(row["words"]))

    def latest_draft(self,cid,lid=None):
        with self.connect() as db:
            self.class_exists(db,cid)
            if lid:
                lesson=self.lesson(lid,db=db)
                if lesson["class_id"]!=cid:raise UserError("课程不属于当前班级",403)
            row=db.execute("SELECT id FROM lesson_drafts WHERE class_id=? AND lesson_id IS ? ORDER BY created_at DESC,rowid DESC LIMIT 1",(cid,lid)).fetchone()
            if not row:return {"draft":None}
            draft=self.read_draft(db,row[0])
            if draft["committed_version"] or (lid and (lesson["read_only"] or lesson["version_id"]!=draft["base_version_id"])):
                return {"draft":None}
            return {"draft":draft}

    def editable_draft(self,db,did,data):
        draft=self.read_draft(db,did)
        if draft["committed_version"]:raise UserError("这份词表已创建课程，请在课程内重新选词。",409)
        if integer(data.get("revision"),1,10**10,"草稿版本")!=draft["revision"]:
            raise UserError("这份草稿已在其他页面更新，请刷新后继续。",409)
        previous=self.selection_target(db,draft["class_id"],draft["lesson_id"])
        if previous and previous["version_id"]!=draft["base_version_id"]:
            raise UserError("课程已有新版本，请返回课程重新选词。",409)
        return draft

    def patch_draft(self,did,data):
        ids=data.get("word_ids")
        if not isinstance(ids,list) or len(ids)>100 or any(type(w) is not int or w<1 or w>10**10 for w in ids):
            raise UserError("请从词库选择最多 100 个单词。")
        if len(set(ids))!=len(ids):raise UserError("同一个单词不能重复添加。")
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            draft=self.editable_draft(db,did,data)
            old={w["id"]:w for w in draft["words"]}
            words=[];seen=set()
            for wid in ids:
                word=old.get(wid)
                if word is None:
                    row=db.execute("SELECT data FROM vocabulary WHERE id=?",(wid,)).fetchone()
                    if not row:raise UserError("所选单词已不在词库中，请重新搜索。")
                    word=enrich_words([dict(json.loads(row[0]),id=wid)],self.asset_root)[0]
                key=normalize_answer(word["word"])
                if key in seen:raise UserError("同一英文单词在不同词库中也只需选择一次。")
                seen.add(key);words.append(word)
            db.execute("UPDATE lesson_drafts SET words=?,revision=revision+1,updated_at=? WHERE id=?",(dump(words),now(),did))
            return self.read_draft(db,did)

    def confirm_draft(self,did,data):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            draft=self.read_draft(db,did)
            # A retry after a lost response must not create a second lesson/version.
            if draft["committed_version"]:return self.by_version(db,draft["committed_version"])
            draft=self.editable_draft(db,did,data)
            chosen=[]
            for word in draft["words"]:
                snapshot=dict(word);wid=snapshot.pop("id")
                due=db.execute("SELECT p.due_at FROM progress p JOIN vocabulary v ON v.id=p.word_id WHERE p.class_id=? AND v.word=? ORDER BY p.seen_at DESC LIMIT 1",(draft["class_id"],word["word"])).fetchone()
                chosen.append({"id":wid,"data":dump(snapshot),"due_at":due[0] if due else None})
            lesson=self.create_version(db,draft["class_id"],dict(draft["config"],title=draft["title"]),draft["lesson_id"],chosen,confirmed=True)
            db.execute("UPDATE lesson_drafts SET committed_version=?,updated_at=? WHERE id=?",(lesson["version_id"],now(),did))
            return lesson

    def vocabulary(self,level="KET",query="",offset=0,cid=None):
        if level not in (*LEVELS,"ALL"):raise UserError("词表范围不正确")
        with self.connect() as db:
            if cid:self.class_exists(db,cid)
            search="%"+query.replace("\\","\\\\").replace("%","\\%").replace("_","\\_")+"%"
            rows=db.execute("""SELECT v.id,v.data,
EXISTS(SELECT 1 FROM progress p JOIN vocabulary pv ON pv.id=p.word_id WHERE p.class_id=? AND pv.word=v.word) AS seen,
EXISTS(SELECT 1 FROM version_words w JOIN versions r ON r.id=w.version_id JOIN lessons l ON l.active_version=r.id JOIN vocabulary rv ON rv.id=w.word_id WHERE l.class_id=? AND r.status='active' AND rv.word=v.word) AS reserved
FROM vocabulary v WHERE (?='ALL' OR v.level=?) AND (v.word LIKE ? ESCAPE '\\' OR json_extract(v.data,'$.meaning_zh') LIKE ? ESCAPE '\\')
ORDER BY CASE WHEN v.word=? COLLATE NOCASE THEN 0 ELSE 1 END,v.word,v.level LIMIT 40 OFFSET ?""",(cid,cid,level,level,search,search,query,offset)).fetchall()
            return [dict(json.loads(r["data"]),id=r["id"],seen=bool(r["seen"]),reserved=bool(r["reserved"])) for r in rows]

    def by_version(self,db,vid):
        row=db.execute("SELECT lesson_id FROM versions WHERE id=?",(vid,)).fetchone()
        if not row:raise UserError("课程版本不存在",404)
        return self.lesson(row[0],vid,db)

    def patch(self,vid,data):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            lesson=self.by_version(db,vid)
            if lesson["read_only"]:raise UserError("此版本已归档，保留原来的课堂记录")
            if "stage" in data:
                if data["stage"] not in ("preview","roots","scenes","practice","workbook"):raise UserError("课堂步骤不正确")
                db.execute("UPDATE versions SET stage=? WHERE id=?",(data["stage"],vid))
            if "presentation_slide" in data:
                sid=data["presentation_slide"]
                if not isinstance(sid,str) or not re.fullmatch(r"[a-z0-9:_-]{1,100}",sid):
                    raise UserError("讲课页码格式不正确")
                config=dict(lesson["config"],presentation_slide=sid)
                db.execute("UPDATE versions SET config=? WHERE id=?",(dump(config),vid))
            if "cursor" in data:
                c=integer(data["cursor"],0,len(lesson["words"])-1,"卡片序号")
                db.execute("UPDATE versions SET cursor=? WHERE id=?",(c,vid))
            if "notes" in data:
                if not isinstance(data["notes"],str) or len(data["notes"])>5000:raise UserError("课堂记录最多 5000 字")
                db.execute("UPDATE versions SET notes=? WHERE id=?",(data["notes"],vid))
            if "draft" in data:
                self.validate_answers(lesson,data["draft"],partial=True)
                db.execute("UPDATE versions SET draft=? WHERE id=?",(dump(data["draft"]),vid))
            if "word_id" in data:
                wid=integer(data["word_id"],1,10**10,"单词编号")
                if wid not in [w["id"] for w in lesson["words"]] or data.get("result") not in ("remembered","again",None):raise UserError("单词或掌握情况不正确")
                db.execute("UPDATE version_words SET result=? WHERE version_id=? AND word_id=?",(data.get("result"),vid,wid))
            return self.by_version(db,vid)

    def complete(self,vid):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            lesson=self.by_version(db,vid)
            if not lesson["is_current"]:raise UserError("旧版本不能结课")
            if lesson["status"]=="completed":return lesson
            stamp=now()
            for w in lesson["words"]:
                result=w["result"] or "again"
                old=db.execute("SELECT p.* FROM progress p JOIN vocabulary v ON v.id=p.word_id WHERE p.class_id=? AND v.word=? ORDER BY p.seen_at DESC LIMIT 1",(lesson["class_id"],w["word"])).fetchone()
                interval=min(30,max(3,old["interval_days"]*2)) if old and result=="remembered" else (3 if result=="remembered" else 1)
                due=(datetime.fromisoformat(stamp)+timedelta(days=interval)).isoformat(timespec="seconds")
                db.execute("""INSERT INTO progress VALUES(?,?,?,?,?,?,?) ON CONFLICT(class_id,word_id) DO UPDATE SET
seen_at=excluded.seen_at,due_at=excluded.due_at,interval_days=excluded.interval_days,reviews=excluded.reviews,result=excluded.result""",
                    (lesson["class_id"],old["word_id"] if old else w["id"],stamp,due,interval,old["reviews"]+1 if old else 1,result))
                db.execute("UPDATE version_words SET result=? WHERE version_id=? AND word_id=?",(result,vid,w["id"]))
            db.execute("UPDATE versions SET status='completed',completed_at=? WHERE id=?",(stamp,vid))
            return self.by_version(db,vid)

    def validate_answers(self,lesson,answers,partial=False):
        if not isinstance(answers,dict) or any(not isinstance(v,str) or len(v)>200 for v in answers.values()):raise UserError("答案格式不正确")
        expected={str(w["id"]) for w in lesson["words"]}
        if (set(answers)-expected) or (not partial and set(answers)!=expected):raise UserError("请提交本课完整的练习答案")

    def attempt(self,vid,data):
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            lesson=self.by_version(db,vid)
            answers=data.get("answers")
            self.validate_answers(lesson,answers)
            checks=[{"id":w["id"],"word":w["word"],"answer":answers[str(w["id"])],
                "correct":normalize_answer(answers[str(w["id"])]) in [normalize_answer(a) for a in w.get("accepted",[w["word"]])]}
                for w in lesson["words"]]
            db.execute("INSERT INTO attempts VALUES(?,?,?,?,?,?)",(uuid.uuid4().hex,vid,now(),sum(x["correct"] for x in checks),len(checks),dump(checks)))
            if not lesson["read_only"]:
                for x in checks:
                    db.execute("UPDATE version_words SET result=? WHERE version_id=? AND word_id=?",("remembered" if x["correct"] else "again",vid,x["id"]))
                db.execute("UPDATE versions SET draft=? WHERE id=?",(dump(answers),vid))
            return self.by_version(db,vid)
