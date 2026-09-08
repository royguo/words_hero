"""Student acceptance scenarios; called only by the isolated Wrangler test runner."""
import concurrent.futures,datetime,json,subprocess,uuid
from zoneinfo import ZoneInfo

def check_students(request,cid,lesson,config,persist):
    def login(name,password):
        _,h=request('/api/auth/login',{'role':'student','username':name,'password':password})
        cookie=h['Set-Cookie'].split(';')[0]
        assert 'HttpOnly' in h['Set-Cookie']
        def send(path,*args,**kwargs):
            headers=kwargs.pop('headers',{});headers['Cookie']=cookie
            return request(path,*args,headers=headers,**kwargs)
        send.cookie=cookie
        return send
    alice,_=request('/api/classes/'+cid+'/students',{'name':'Alice'},status=201)
    assert alice['generated_password']==alice['username'][-6:]
    day=datetime.datetime.now(ZoneInfo('Asia/Shanghai')).strftime('%Y%m%d')
    assert alice['username']==day+'001'
    bob,_=request('/api/classes/'+cid+'/students',{'name':'Bob','username':'student-bob','password':'123456','phone':''},status=201)
    request('/api/classes/'+cid+'/students',{'name':'Duplicate','username':'STUDENT-BOB'},status=409)
    listing,_=request('/api/classes/'+cid+'/students');assert len(listing['students'])==2
    assert listing['next_username']==day+'002'
    assert all('password_hash' not in s and 'password' not in s and 'generated_password' not in s for s in listing['students'])
    alice_updated,_=request('/api/students/'+alice['id'],{'revision':alice['revision'],'name':'Alice A','username':alice['username'],'password':'','phone':'13800000000'},method='PATCH')
    assert alice_updated['phone']=='13800000000'
    request('/api/students/'+alice['id'],{'revision':1,'name':'Stale','username':alice['username']},method='PATCH',status=409)
    request('/api/auth/login',{'role':'student','username':alice['username'],'password':'wrong'},status=401)
    request('/api/auth/login',{'role':'teacher','username':alice['username'],'password':alice['generated_password']},status=401)
    a=login(alice['username'].upper(),alice['generated_password']);b=login(bob['username'],'123456')
    info,_=a('/api/auth/session');assert info['authenticated'] and info['role']=='student' and info['name']=='Alice A'
    for path in ('/api/state','/api/backup','/api/classes/'+cid+'/students','/api/vocabulary'):
        a(path,status=403)
    a('/api/classes',{'name':'forbidden'},status=403)
    a('/api/classes/'+cid+'/copy',{'name':'forbidden','request_id':uuid.uuid4().hex},status=403)
    a('/api/versions/'+lesson['version_id']+'/root-check',{'group_id':'any','answers':['farm']},status=403)
    a('/api/versions/'+lesson['version_id'],{'notes':'forbidden'},method='PATCH',status=403)
    a('/api/audio',{'text':'farm'},status=403)
    state,_=a('/api/student/state');assert state['total']==0
    empty,_=a('/api/student/sessions',{});assert empty['session'] is None
    request('/api/versions/'+lesson['version_id']+'/complete',{})
    state,_=a('/api/student/state');assert state['total']==state['fresh']==10
    copied,_=request('/api/classes/'+cid+'/copy',{'name':'Fresh students class','request_id':uuid.uuid4().hex},status=201)
    students,_=request('/api/classes/'+copied['id']+'/students');assert students['students']==[]
    request('/api/classes/'+copied['id'],method='DELETE')
    request('/api/versions/'+lesson['version_id'],{'notes':'After-class notes'},method='PATCH')
    after_notes,_=a('/api/student/state');assert after_notes==state
    a('/api/audio',{'text':'farm'})
    a('/api/audio',{'text':'This sentence is not in this class.'},status=403)
    start,_=a('/api/student/sessions',{});s=start['session'];sid=s['id'];assert len(s['game']['words'])==10
    again,_=a('/api/student/sessions',{});assert again['session']['id']==sid
    keys=[w['key'] for w in s['game']['words']]
    def act(action,who=None,status=200,revision=None,request_id=None):
        nonlocal s
        payload={'revision':s['revision'] if revision is None else revision,'request_id':request_id or uuid.uuid4().hex,'action':action}
        result,_=(who or a)('/api/student/sessions/'+sid+'/actions',payload,status=status)
        if status==200:s=result
        return result,payload
    act({'kind':'judge','correct':True},status=400)
    _,wrong_payload=act({'kind':'match','en':keys[0],'zh':keys[1]})
    assert set(s['game']['removed'])==set(keys[:2]) and all(s['game']['errors'][key]==1 for key in keys[:2])
    replay,_=a('/api/student/sessions/'+sid+'/actions',wrong_payload);assert replay['game']['answers']==1
    act({'kind':'match','en':keys[2],'zh':keys[2]},revision=1,status=409)
    act({'kind':'match','en':keys[2],'zh':keys[2]},who=b,status=404)
    a=login(alice['username'],alice['generated_password'])
    restored,_=a('/api/student/state');assert restored['session']['game']==s['game']
    bob_state,_=b('/api/student/state');assert bob_state['practiced']==0 and bob_state['session'] is None
    for key in keys[2:]:act({'kind':'match','en':key,'zh':key})
    assert s['game']['stage']==1 and s['game']['needs_retry']
    act({'kind':'retry'});assert s['game']['round']==2 and len(s['game']['removed'])==0
    for key in keys:act({'kind':'match','en':key,'zh':key})
    assert s['game']['stage']==2 and len(s['game']['questions'])==20
    for direction in ('en','zh'):
        qs=[q for q in s['game']['questions'] if q['direction']==direction]
        assert len(qs)==10 and any(q['word']==q['candidate'] for q in qs) and any(q['word']!=q['candidate'] for q in qs)
    deliberately_wrong=False
    while not s['game']['needs_retry']:
        q=s['game']['questions'][s['game']['cursor']];correct=q['word']==q['candidate']
        if not deliberately_wrong and not correct:
            correct=True;deliberately_wrong=True
            before=s['game']['errors'].copy();pair=(q['word'],q['candidate'])
            act({'kind':'judge','correct':correct})
            assert all(s['game']['errors'][key]==before.get(key,0)+1 for key in pair)
        else:act({'kind':'judge','correct':correct})
    assert s['game']['stage']==2 and s['game']['cursor']==20
    state,_=a('/api/student/state');assert state['practiced']==0
    act({'kind':'retry'});assert s['game']['round']==2 and s['game']['cursor']==0
    while s['game']['stage']==2:
        q=s['game']['questions'][s['game']['cursor']]
        _,last_payload=act({'kind':'judge','correct':q['word']==q['candidate']})
    assert s['game']['stage']=='done' and s['completed_at']
    a('/api/student/sessions/'+sid+'/actions',last_payload)
    state,_=a('/api/student/state');assert state['practiced']==10 and state['completed_groups']==1 and state['fresh']==state['due']==0
    assert state['recent'][0]['errors']==4
    due=datetime.datetime.fromisoformat(state['next_due'].replace('Z','+00:00'))
    assert 240<(due-datetime.datetime.now(datetime.timezone.utc)).total_seconds()<=301
    batch=subprocess.run(['node','tests/student-batch-http.mjs'],input=json.dumps({'base':'http://127.0.0.1:8790','cookie':b.cookie,'studentId':bob['id']}),capture_output=True,text=True)
    assert batch.returncode==0,batch.stderr[-4000:]
    batch_sid=json.loads(batch.stdout)['session_id']
    result=subprocess.run(['npx','wrangler','d1','execute','kite-words-db','--config',config,'--local','--persist-to',persist,'--command',"SELECT COUNT(*) AS n FROM student_events WHERE session_id='"+batch_sid+"'",'--json'],capture_output=True,text=True,check=True)
    assert json.loads(result.stdout)[0]['results'][0]['n']==2
    empty,_=a('/api/student/sessions',{});assert empty['session'] is None
    extra,_=a('/api/student/sessions',{'extra':True});assert len(extra['session']['game']['words'])==10
    # The latest version is the only source: new uncompleted version withdraws the old vocabulary.
    draft,_=request('/api/preview',{'class_id':cid,'lesson_id':lesson['id'],'title':lesson['title']},status=201)
    garden,_=request('/api/vocabulary?level=KET&q=garden');garden=next(w for w in garden if w['word']=='garden')
    ids=[w['id'] for w in lesson['words'] if w['word']!='stamp']+[garden['id']]
    draft,_=request('/api/drafts/'+draft['id'],{'revision':draft['revision'],'word_ids':ids},method='PATCH')
    new,_=request('/api/drafts/'+draft['id']+'/confirm',{'revision':draft['revision']},status=201)
    state,_=a('/api/student/state');assert state['total']==0 and state['session'] is None
    a('/api/student/sessions/'+extra['session']['id']+'/actions',{'revision':1,'request_id':uuid.uuid4().hex,'action':{'kind':'match','en':'farm','zh':'farm'}},status=409)
    a('/api/audio',{'text':'stamp'},status=403)
    request('/api/versions/'+new['version_id']+'/complete',{})
    state,_=a('/api/student/state');assert state['total']==10 and state['fresh']==1 and state['practiced']==9
    newest,_=a('/api/student/sessions',{});assert [w['key'] for w in newest['session']['game']['words']]==['garden']
    # Personal history stays stored when a word leaves the eligible set.
    sql="SELECT word_key,data FROM student_memory WHERE student_id='"+alice['id']+"'"
    result=subprocess.run(['npx','wrangler','d1','execute','kite-words-db','--config',config,'--local','--persist-to',persist,'--command',sql,'--json'],capture_output=True,text=True,check=True)
    memories=json.loads(result.stdout)[0]['results'];assert len(memories)==10 and any(m['word_key']=='stamp' for m in memories)
    assert all(json.loads(m['data'])['reviews']==1 for m in memories)
    # Password changes invalidate existing student cookies and do not expose teacher APIs.
    request('/api/students/'+bob['id'],{'revision':bob['revision'],'name':'Bob','username':bob['username'],'password':'newpass9','phone':''},method='PATCH')
    stale,_=b('/api/auth/session');assert not stale['authenticated']
    b('/api/student/state',status=401);b=login(bob['username'],'newpass9')
    request('/api/students/'+bob['id'],method='DELETE');b('/api/student/state',status=401)
    other,_=request('/api/classes',{'name':'Other student class'},status=201)
    # Date sequences are global, include removed accounts, and handle concurrent teachers.
    request('/api/classes/'+other['id']+'/students',{'name':'Manual high sequence','username':day+'050'},status=201)
    def auto_create(target):
        return request('/api/classes/'+target+'/students',{'name':'Concurrent','auto_username':True,'username':day+'002'},status=201)[0]
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        created=list(pool.map(auto_create,[cid,other['id']]))
    assert {r['username'] for r in created}=={day+'051',day+'052'}
    assert all(r['generated_password']==r['username'][-6:] for r in created)
    highest=next(r for r in created if r['username']==day+'052')
    request('/api/students/'+highest['id'],method='DELETE')
    charlie,_=request('/api/classes/'+other['id']+'/students',{'name':'Charlie'},status=201)
    assert charlie['username']==day+'053'
    ch=login(charlie['username'],charlie['generated_password']);state,_=ch('/api/student/state');assert state['total']==0
    ch('/api/student/sessions/'+sid+'/actions',last_payload,status=404)
    request('/api/classes/'+other['id'],method='DELETE');ch('/api/student/state',status=401)
    print('PASS: date/sequence accounts and concurrent allocation; two phase-sized saves with local retries, authoritative replay, invalid-batch rollback and lost acknowledgements; student roles, memory, version eligibility and legacy single-action compatibility')
