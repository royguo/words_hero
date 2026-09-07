#!/usr/bin/env python3
"""Read a fixed production lesson brief or apply a published immutable material pack."""
import argparse,json,os,urllib.request,urllib.error
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--url',default=os.environ.get('KITE_BASE_URL','https://kitedance.com'));sub=p.add_subparsers(dest='action',required=True)
a=sub.add_parser('brief');a.add_argument('course_code');a.add_argument('--output',type=Path)
a=sub.add_parser('apply');a.add_argument('course_code');a.add_argument('bundle_id')
args=p.parse_args();base=args.url.rstrip('/');cookie=''
def request(path,data=None):
    headers={'Content-Type':'application/json','User-Agent':'KiteDance-Materials/2.0'}
    if cookie:headers['Cookie']=cookie
    r=urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(data).encode() if data is not None else None,headers=headers),timeout=45)
    return json.load(r),r.headers
try:
    _,h=request('/api/auth/login',{'username':'admin','password':os.environ.get('KITE_ADMIN_PASSWORD','95279527')});cookie=h['Set-Cookie'].split(';')[0]
    if args.action=='brief':result,_=request('/api/courses/'+args.course_code+'/brief')
    else:
        result,_=request('/api/courses/'+args.course_code+'/materials',{'bundle_id':args.bundle_id})
        result={k:result[k] for k in ('id','course_code','version_id','version_number')}
    text=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
    if getattr(args,'output',None):args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(text);print(args.output)
    else:print(text)
except urllib.error.HTTPError as e:p.exit(1,e.read().decode()+'\n')
except (OSError,ValueError,KeyError) as e:p.exit(1,'课程操作失败：'+str(e)+'\n')
