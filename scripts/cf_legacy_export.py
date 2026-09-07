#!/usr/bin/env python3
"""One-time SQLite -> D1 export; output stays private and is never part of normal deploy."""
import argparse,json,sys,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from storage import Store
from content import dump
quote=lambda s:'NULL' if s is None else "'"+str(s).replace("'","''")+"'"
p=argparse.ArgumentParser();p.add_argument('--db',type=Path,default=ROOT/'data/classroom.sqlite3');p.add_argument('--output',type=Path,default=ROOT/'.wrangler/private/legacy.sql');p.add_argument('--target',choices=('local','remote'),default='local');args=p.parse_args()
if not args.db.is_file():p.error('source database does not exist')
location=['--remote'] if args.target=='remote' else ['--local','--persist-to','.wrangler/state']
r=subprocess.run(['npx','wrangler','d1','execute','kite-words-db','--config','cloudflare/wrangler.jsonc',*location,'--command','SELECT id,level,word FROM vocabulary','--json'],capture_output=True,text=True,check=True)
rows=json.loads(r.stdout)[0]['results'];target_ids={(w['level'],w['word']):w['id'] for w in rows}
s=Store(args.db,seed=None);sql=[];count=0
with s.connect() as db:remap={w['id']:target_ids[(w['level'],w['word'])] for w in db.execute('SELECT id,level,word FROM vocabulary')}
def convert(value,key=''):
    if key=='presentation_slide':return None
    if key=='word_id' and isinstance(value,int):return remap[value]
    if key in ('english_to_chinese','chinese_to_english') and isinstance(value,list):return [remap[x] for x in value]
    if key=='draft' and isinstance(value,dict):return {str(remap[int(k)]):v for k,v in value.items()}
    if isinstance(value,list):return [convert(v) for v in value]
    if isinstance(value,dict):
        out={k:convert(v,k) for k,v in value.items() if k!='presentation_slide'}
        if isinstance(out.get('id'),int) and 'word' in out:out['id']=remap[out['id']]
        return out
    return value

with s.connect() as db:
    for c in db.execute('SELECT * FROM classrooms'):
        sql.append('INSERT INTO classrooms(id,name,created_at) VALUES(%s,%s,%s) ON CONFLICT(id) DO NOTHING;'%tuple(quote(c[k]) for k in ('id','name','created_at')))
    for l in db.execute('SELECT * FROM lessons'):
        sql.append('INSERT INTO lessons(id,class_id,number,title,created_at,active_version) VALUES(%s) ON CONFLICT(id) DO NOTHING;'%','.join(quote(l[k]) for k in ('id','class_id','number','title','created_at','active_version')))
    for v in db.execute('SELECT id,lesson_id,number FROM versions'):
        l=s.by_version(db,v['id']);l.pop('versions',None);l.pop('attempts',None)
        sql.append('INSERT INTO versions VALUES(%s,%s,%s,%s,%s) ON CONFLICT(id) DO NOTHING;'%(quote(v['id']),quote(v['lesson_id']),v['number'],quote(l['course_code']),quote(dump(convert(l)))))
        count+=1
    for d in db.execute('SELECT * FROM lesson_drafts'):
        value=s.read_draft(db,d['id'])
        sql.append('INSERT INTO drafts VALUES(%s) ON CONFLICT(id) DO NOTHING;'%','.join(quote(x) for x in (d['id'],d['class_id'],d['lesson_id'],dump(convert(value)),d['updated_at'])))
    for a in db.execute('SELECT * FROM attempts'):
        value=dict(a,data=json.loads(a['data']))
        sql.append('INSERT INTO attempts VALUES(%s) ON CONFLICT(id) DO NOTHING;'%','.join(quote(x) for x in (a['id'],a['version_id'],a['created_at'],dump(convert(value)))))
args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text('\n'.join(sql)+'\n');print(json.dumps({'versions':count,'output':str(args.output)}))
