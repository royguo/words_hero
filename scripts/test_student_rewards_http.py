"""Private D1/R2 acceptance only; no production student records are modified."""
import concurrent.futures,json,subprocess,uuid,os

def check_student_rewards(request,source,config,persist):
    assert persist != '.wrangler/state'
    def sql(query):
        result=subprocess.run(['npx','wrangler','d1','execute','kite-words-db','--config',config,'--local','--persist-to',persist,'--command',query,'--json'],capture_output=True,text=True,check=True)
        return json.loads(result.stdout)[0]['results']
    classroom,_=request('/api/classes/'+source+'/copy',{'name':'Rewards acceptance','request_id':uuid.uuid4().hex},status=201)
    cid=classroom['id'];state,_=request('/api/state?class_id='+cid)
    for lesson in state['lessons']:request('/api/versions/'+lesson['active_version']+'/complete',{})
    students=[]
    for name in ('Reward A','Reward B'):
        student,_=request('/api/classes/'+cid+'/students',{'name':name},status=201)
        _,headers=request('/api/auth/login',{'role':'student','username':student['username'],'password':student['generated_password']})
        students.append((student,headers['Set-Cookie'].split(';')[0]))
    (alice,ac),(bob,bc)=students
    def read(path,cookie=ac,**kwargs):return request(path,headers={'Cookie':cookie},**kwargs)[0]
    def study(student=alice,cookie=ac,miss=False):
        result=subprocess.run(['node','tests/student-adaptive-http.mjs'],input=json.dumps({'base':'http://127.0.0.1:8790','studentId':student['id'],'cookie':cookie,'miss':miss}),capture_output=True,text=True)
        assert result.returncode==0,result.stderr[-5000:]
        return json.loads(result.stdout)
    initial=read('/api/student/state');assert initial['points']['balance']==initial['mastered']==0
    listing,_=request('/api/classes/'+cid+'/students');assert listing['reward_settings']=={'points_per_word':10,'revision':0}
    request('/api/classes/'+cid+'/reward-settings',{'points_per_word':15,'revision':0},method='PATCH')
    request('/api/classes/'+cid+'/reward-settings',{'points_per_word':99,'revision':0},method='PATCH',status=409)
    request('/api/classes/'+cid+'/reward-settings',{'points_per_word':-1,'revision':1},method='PATCH',status=400)
    first=study(miss=True);assert first['state']['practiced']==10 and first['state']['points']['balance']==0
    sid=first['session_id'];key=first['keys'][0]
    assert sql("SELECT COUNT(*) AS n FROM student_events WHERE session_id='"+sid+"'")[0]['n']==2
    h=read('/api/student/memory?word='+key);assert len(h['reviews'])==1 and h['reviews'][0]['errors']>=1
    assert read('/api/student/memory?word='+key,cookie=bc)['reviews']==[]
    assert read('/api/student/state',cookie=bc)['practiced']==0
    # Simulate elapsed intervals only in the disposable database. Both students share words, never memory.
    sql("UPDATE student_memory SET data=json_set(data,'$.step',3,'$.relearning',json('false'),'$.last_reviewed','2000-01-01T00:00:00.000Z','$.due_at','2000-01-08T00:00:00.000Z') WHERE student_id='"+alice['id']+"'")
    second=study();assert second['state']['mastered']==10
    assert second['state']['points']['balance']==150 and second['state']['points']['earned_words']==10
    points=read('/api/student/points');assert len(points['entries'])==10
    study();points=read('/api/student/points');assert points['points']['balance']==150 and len(points['entries'])==10
    assert read('/api/student/state',cookie=bc)['points']['balance']==0
    # A weak student's first exposure is still step 0, regardless of the classmate's mastery.
    bob_group=study(bob,bc);assert bob_group['state']['mastered']==0 and bob_group['state']['points']['balance']==0
    for path in ('/api/students/'+alice['id']+'/points','/api/students/'+bob['id']+'/points','/api/backup'):
        read(path,status=403)
    request('/api/student/points',{'amount':1000},headers={'Cookie':ac},status=403)
    request('/api/classes/'+cid+'/reward-settings',{'points_per_word':99,'revision':1},method='PATCH',headers={'Cookie':ac},status=403)
    def change(kind,amount,revision=None,request_id=None,reason='Test reward',status=200):
        info,_=request('/api/students/'+alice['id']+'/points')
        data={'kind':kind,'amount':amount,'revision':info['points']['revision'] if revision is None else revision,'request_id':request_id or uuid.uuid4().hex,'reason':reason}
        response,_=request('/api/students/'+alice['id']+'/points',data,status=status)
        return response,data
    info,payload=change('redeem',30,reason='Picture book');assert info['points']['balance']==120
    replay,_=request('/api/students/'+alice['id']+'/points',payload);assert replay['points']['balance']==120
    request('/api/students/'+alice['id']+'/points',{**payload,'amount':31},status=409)
    change('redeem',121,status=400);change('redeem',-1,status=400);change('bonus',1.5,status=400);change('bonus',10,reason='',status=400)
    info,_=change('bonus',20);assert info['points']['balance']==140
    info,_=change('adjustment',100);assert info['points']['balance']==100
    rev=info['points']['revision']
    def redeem(status):
        return request('/api/students/'+alice['id']+'/points',{'kind':'redeem','amount':70,'revision':rev,'request_id':uuid.uuid4().hex,'reason':'Concurrent reward'},status=status)
    # Race through real HTTP, collecting status/body without bypassing API validation.
    # request() asserts status; concurrent failures must contain the expected HTTP 409.
    def race(_):
        try:
            result,_=redeem(200);return result['points']['balance']
        except AssertionError as e:
            assert '409' in str(e),str(e)
            return 'conflict'
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool: results=list(pool.map(race,range(2)))
    assert sorted(map(str,results))==['30','conflict'],results
    final=read('/api/student/points');assert final['points']['balance']==30
    history=read('/api/student/history');assert len(history['recent'])==3 and all(w['memory']['reviews']==3 for w in history['words'])
    assert len(read('/api/student/memory?word='+key)['reviews'])==3
    backup,_=request('/api/backup')
    assert all(table in backup for table in ('student_points','student_wallets','student_review_history','reward_settings'))
    if os.environ.get('KITE_STUDENT_BROWSER') == '1':
        browser_student,_=request('/api/classes/'+cid+'/students',{'name':'Browser acceptance'},status=201)
        _,headers=request('/api/auth/login',{'role':'student','username':browser_student['username'],'password':browser_student['generated_password']})
        browser_cookie=headers['Set-Cookie'].split(';')[0]
        result=subprocess.run(['node','tests/student-browser.mjs'],input=json.dumps({'base':'http://127.0.0.1:8790','cookie':browser_cookie,'studentId':browser_student['id']}),capture_output=True,text=True)
        assert result.returncode==0,result.stderr[-6000:]+result.stdout[-2000:]
        print(result.stdout)
    # Removing class/student does not delete independent histories or their earned points.
    request('/api/classes/'+cid,method='DELETE');read('/api/student/state',status=401)
    assert sql("SELECT balance FROM student_wallets WHERE student_id='"+alice['id']+"'")[0]['balance']==30
    assert sql("SELECT COUNT(*) AS n FROM student_review_history WHERE student_id='"+alice['id']+"'")[0]['n']==30
    print('PASS: targeted correction and two-checkpoint replay, separate personal histories, spaced mastery rewards, no farming, teacher settings/ledger, idempotent and concurrent redemption, student permissions and retained records')
