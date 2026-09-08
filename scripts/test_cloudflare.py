#!/usr/bin/env python3
"""Exercise the actual Worker + D1 + R2 in an isolated local Wrangler directory."""
import json,os,signal,subprocess,tempfile,time,urllib.request,urllib.error,hashlib,sys
from test_students_http import check_students
from test_classroom_updates_http import check_classroom_updates
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];os.chdir(ROOT)
config='cloudflare/wrangler.jsonc'
def run(args,env=None):
    r=subprocess.run(args,capture_output=True,text=True,env=env)
    if r.returncode:raise RuntimeError(r.stdout[-2500:]+r.stderr[-2500:])
with tempfile.TemporaryDirectory(prefix='kite-cf-test-') as temp:
    env=dict(os.environ,KITE_CF_STATE=temp)
    run(['python3','scripts/cf_prepare.py'])
    run(['npx','wrangler','d1','migrations','apply','kite-words-db','--config',config,'--local','--persist-to',temp])
    run(['npx','wrangler','d1','execute','kite-words-db','--config',config,'--local','--persist-to',temp,'--file','.wrangler/content/seed.sql'])
    run(['node','scripts/cf_objects.mjs'],env)
    log=open(Path(temp)/'worker.log','w+')
    server=subprocess.Popen(['npx','wrangler','dev','--config',config,'--persist-to',temp,'--port','8790','--var','AUDIO_ONLINE:false'],stdout=log,stderr=log,start_new_session=True)
    base='http://127.0.0.1:8790';cookie=''
    def request(path,data=None,method=None,status=200,headers=None,auth=True):
        h={'Content-Type':'application/json'}
        if auth and cookie:h['Cookie']=cookie
        h.update(headers or {})
        req=urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=h,method=method or ('POST' if data is not None else 'GET'))
        try:r=urllib.request.urlopen(req,timeout=35)
        except urllib.error.HTTPError as e:r=e
        body=r.read();assert r.status==status,(path,r.status,body[:500])
        return (json.loads(body) if 'application/json' in r.headers.get('Content-Type','') else body),r.headers
    try:
        for _ in range(120):
            try:request('/api/health');break
            except Exception:time.sleep(.25)
        else:raise RuntimeError('Local Worker did not start')
        request('/api/state',status=401,auth=False)
        request('/api/auth/login',{'username':'admin','password':'wrong'},status=401)
        password=dict(line.split('=',1) for line in Path('cloudflare/.dev.vars').read_text().splitlines() if '=' in line)['ADMIN_PASSWORD']
        _,h=request('/api/auth/login',{'username':'admin','password':password});cookie=h['Set-Cookie'].split(';')[0]
        assert all(x in h['Set-Cookie'] for x in ('HttpOnly','SameSite=Strict','Max-Age=2592000'))
        request('/api/classes',{'name':'bad-origin'},headers={'Origin':'https://unrelated.invalid'},status=403)
        state,_=request('/api/state');assert not state['classes'];assert sum(l['total'] for l in state['levels'])==4791
        c,_=request('/api/classes',{'name':'Test <class> & safe'},status=201);cid=c['id']
        d,_=request('/api/preview',{'class_id':cid,'title':'My lesson'},status=201);assert len(d['words'])==10
        restored,_=request('/api/drafts?class_id='+cid);assert restored['draft']['id']==d['id']
        hits,_=request('/api/vocabulary?level=PET&q=photographer');cross=next(w for w in hits if w['word']=='photographer')
        ids=[w['id'] for w in d['words'] if w['word']!='photographer'][:8]+[cross['id']]
        d,_=request('/api/drafts/'+d['id'],{'revision':d['revision'],'word_ids':ids},method='PATCH');assert any(w['level']=='PET' for w in d['words'])
        request('/api/drafts/'+d['id'],{'revision':1,'word_ids':ids},method='PATCH',status=409)
        l,_=request('/api/drafts/'+d['id']+'/confirm',{'revision':d['revision']},status=201)
        again,_=request('/api/drafts/'+d['id']+'/confirm',{'revision':d['revision']},status=201);assert l['version_id']==again['version_id']
        vid=l['version_id'];plan=l['config']['worksheets']
        updated,_=request('/api/versions/'+vid,{'notes':'keep me','word_id':l['words'][0]['id'],'result':'remembered','presentation_slide':'word:1'},method='PATCH');assert updated['config']['worksheets']==plan
        for kind in ('classroom','homework','answers'):
            paper,_=request('/api/versions/'+vid+'/worksheet?kind='+kind+'&view=embedded');s=paper.decode();assert 'data-worksheet="'+kind+'"' in s and s.count('class="paper-page"')>=2;assert 'Test &lt;class&gt; &amp; safe' in s and 'data-field="age"' in s
        cards,_=request('/api/versions/'+vid+'/worksheet?kind=cards&view=embedded');s=cards.decode()
        assert 'data-worksheet="cards"' in s and s.count('class="paper-page flashcard-page"')==4
        assert s.count('data-side="front"')==s.count('data-side="back"')==2
        assert s.count('data-card="blank"')==(12-len(l['words']))*2
        standalone,_=request('/api/versions/'+vid+'/worksheet?kind=cards');assert '长边翻转' in standalone.decode()
        regen,_=request('/api/preview',{'class_id':cid,'lesson_id':l['id'],'title':'My lesson','count':10},status=201)
        newer,_=request('/api/drafts/'+regen['id']+'/confirm',{'revision':regen['revision']},status=201);assert newer['version_number']==2
        old,_=request('/api/lessons/'+l['id']+'?version='+vid);assert old['read_only'] and old['config']['worksheets']==plan
        archived_cards,_=request('/api/versions/'+vid+'/worksheet?kind=cards&view=embedded');assert archived_cards==cards
        request('/api/versions/'+vid,{'notes':'overwrite'},method='PATCH',status=400)
        request('/api/versions/'+newer['version_id']+'/complete',{})
        state,_=request('/api/state?class_id='+cid);assert state['learned']==10
        request('/api/lessons/'+l['id'],method='DELETE');request('/api/lessons/'+l['id'],status=404)
        state,_=request('/api/state?class_id='+cid);assert state['learned']==0 and state['lessons']==[]
        # Fixed sample, structured study, idempotent material binding and independent assets.
        sample=json.loads(Path('assets/lessons/farm-friend-v2/manifest.json').read_text());ids=[]
        for word in sample['word_order']:
            found,_=request('/api/vocabulary?level=KET&q='+word);ids.append(next(w['id'] for w in found if w['word']==word))
        d,_=request('/api/preview',{'class_id':cid,'title':sample['title']},status=201)
        d,_=request('/api/drafts/'+d['id'],{'revision':d['revision'],'word_ids':ids},method='PATCH')
        l,_=request('/api/drafts/'+d['id']+'/confirm',{'revision':d['revision']},status=201)
        l,_=request('/api/courses/'+l['course_code']+'/materials',{'bundle_id':'farm-friend-v2'},status=201)
        same,_=request('/api/courses/'+l['course_code']+'/materials',{'bundle_id':'farm-friend-v2'},status=201);assert same['version_id']==l['version_id']
        assert all(w['word_study'] and len(w['word_study']['family'])==2 for w in l['words'])
        assert len(l['materials']['story']['scenes'])==4
        inv,_=request('/api/versions/'+l['version_id']+'/audio');assert inv['cached']==inv['total']==82
        clip,_=request('/api/audio',{'text':'farm'});assert clip['cached']
        audio,h=request(clip['url'],headers={'Range':'bytes=0-127'},status=206,auth=False);assert len(audio)==128 and h['Content-Range'].startswith('bytes 0-127/')
        request(clip['url'],headers={'Range':'bytes=999999999-'},status=416)
        image=l['words'][0]['images'][0];pixels,_=request(image['src'],auth=False);assert hashlib.sha256(pixels).hexdigest()==image['sha256']
        check_classroom_updates(request,l)
        check_students(request,cid,l,config,temp)
        request('/api/classes/'+cid,method='DELETE');request('/api/lessons/'+l['id'],status=404)
        after,_=request(image['src'],auth=False);assert after==pixels;request('/api/audio',{'text':'farm'})
        state,_=request('/api/state');assert state['classes']==[]
        request('/api/auth/logout',{});request('/api/auth/session',headers={'Cookie':'kite_session=tampered'})
        print('PASS: auth, CSRF, 4791-word library, mixed draft editing, idempotency, version history, worksheets, progress, deletion, 82 cached recordings, R2 checksums and range requests')
    except Exception:
        log.flush();log.seek(0);print(log.read()[-5000:],file=sys.stderr);raise
    finally:
        os.killpg(server.pid,signal.SIGTERM)
        try:server.wait(timeout=10)
        except subprocess.TimeoutExpired:os.killpg(server.pid,signal.SIGKILL)
        log.close()
