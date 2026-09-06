#!/usr/bin/env python3
"""Start an offline classroom in a browser. Python 3.9+; standard library only."""
import argparse
import hashlib
import json
import sqlite3
import tempfile
import threading
import webbrowser
from functools import partial
from http.client import HTTPConnection
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,unquote,urlparse
from content import ROOT,UserError,dump,integer,parse_csv,worksheet
from storage import Store

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,store,static_dir,**kwargs):
        self.store=store
        super().__init__(*args,directory=str(static_dir),**kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","same-origin")
        self.send_header("X-Frame-Options","SAMEORIGIN")
        super().end_headers()

    def respond(self,body,status=200,kind="application/json; charset=utf-8",filename=None):
        if isinstance(body,(dict,list)):body=dump(body)
        if isinstance(body,str):body=body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type",kind)
        self.send_header("Content-Length",str(len(body)))
        self.send_header("Cache-Control","no-store")
        if filename:self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
        self.end_headers()
        self.wfile.write(body)

    def validate_host(self):
        valid={"127.0.0.1:%d"%self.server.server_port,"localhost:%d"%self.server.server_port}
        if self.server.dev:valid|={"127.0.0.1:3000","localhost:3000"}
        if self.headers.get("Host","") not in valid:raise UserError("只允许从本机地址访问",403)

    def read_json(self):
        allowed={"http://127.0.0.1:%d"%self.server.server_port,"http://localhost:%d"%self.server.server_port}
        if self.server.dev:allowed|={"http://127.0.0.1:3000","http://localhost:3000"}
        if self.headers.get("Origin") and self.headers["Origin"] not in allowed:raise UserError("不允许跨站写入",403)
        if self.headers.get_content_type()!="application/json":raise UserError("写入请求必须使用 JSON",415)
        length=integer(self.headers.get("Content-Length","0"),1,20_000_000,"请求大小")
        try:data=json.loads(self.rfile.read(length))
        except (UnicodeError,json.JSONDecodeError):raise UserError("JSON 格式不正确")
        if not isinstance(data,dict):raise UserError("请求内容必须是对象")
        return data

    def dispatch(self,write=False):
        try:
            self.validate_host()
            url=urlparse(self.path)
            p=url.path.strip("/").split("/")
            q={k:v[0] for k,v in parse_qs(url.query).items()}
            if write:
                data=self.read_json()
                if p==["api","classes"]:return self.respond(self.store.create_class(data),201)
                if p==["api","pool"]:return self.respond(self.store.pool(data.get("class_id"),data,data.get("lesson_id")))
                if p==["api","preview"]:return self.respond(self.store.preview(data.get("class_id"),data,data.get("lesson_id")),201)
                if len(p)>=3 and p[:2]==["api","drafts"]:
                    if p[3:]==["confirm"]:return self.respond(self.store.confirm_draft(p[2],data),201)
                    if len(p)==3:return self.respond(self.store.patch_draft(p[2],data))
                if p==["api","generate"]:return self.respond(self.store.generate(data.get("class_id"),data,data.get("lesson_id")),201)
                if p==["api","import"]:
                    words=parse_csv(data.get("csv"),data.get("level"))
                    with self.store.connect() as db:self.store.import_words(db,words)
                    return self.respond({"imported":len(words)})
                if len(p)>=3 and p[:2]==["api","versions"]:
                    if len(p)==3:return self.respond(self.store.patch(p[2],data))
                    if p[3:]==["complete"]:return self.respond(self.store.complete(p[2]))
                    if p[3:]==["attempts"]:return self.respond(self.store.attempt(p[2],data),201)
                raise UserError("接口不存在",404)
            if p==["api","health"]:return self.respond({"app":"word-garden","version":2,"database_id":hashlib.sha256(str(self.store.path.resolve()).encode()).hexdigest()[:16]})
            if p==["api","state"]:return self.respond(self.store.state(q.get("class_id")))
            if p==["api","drafts"]:return self.respond(self.store.latest_draft(q.get("class_id"),q.get("lesson_id")))
            if p==["api","vocabulary"]:
                offset=integer(q.get("offset","0"),0,100000,"页码")
                search=q.get("q","")[:80]
                return self.respond(self.store.vocabulary(q.get("level","KET"),search,offset,q.get("class_id")))
            if p==["api","seed.csv"]:
                level=q.get("level","KET")
                if level not in ("KET","PET","CET-4","CET-6"):raise UserError("词表范围不正确")
                path=ROOT/"data"/(level.lower()+".csv")
                body=path.read_bytes() if path.exists() else (ROOT/"data"/"ket.csv").read_bytes().splitlines()[0]+b"\r\n"
                return self.respond(body,kind="text/csv; charset=utf-8",filename=level.lower()+".csv")
            if p==["api","backup"]:
                with tempfile.TemporaryDirectory() as tmp:
                    dest=Path(tmp)/"backup.sqlite3"
                    with self.store.connect() as db:
                        target=sqlite3.connect(str(dest))
                        try:db.backup(target)
                        finally:target.close()
                    return self.respond(dest.read_bytes(),kind="application/vnd.sqlite3",filename="word-garden-backup.sqlite3")
            if len(p)==3 and p[:2]==["api","lessons"]:
                return self.respond(self.store.lesson(p[2],q.get("version")))
            if len(p)==4 and p[:2]==["api","versions"] and p[3]=="worksheet":
                with self.store.connect() as db:lesson=self.store.by_version(db,p[2])
                return self.respond(worksheet(lesson,q.get("kind","classroom")),kind="text/html; charset=utf-8")
            if p and p[0]=="api":raise UserError("接口不存在",404)
            clean=Path(unquote(url.path).lstrip("/"))
            if any(x.startswith(".") for x in clean.parts) or ".." in clean.parts:raise UserError("文件不存在",404)
            target=(Path(self.directory)/clean).resolve()
            if not target.is_relative_to(Path(self.directory).resolve()):raise UserError("文件不存在",404)
            if target.is_dir() and not (target/"index.html").exists():raise UserError("文件不存在",404)
            return super().do_GET()
        except UserError as e:return self.respond({"error":e.message},e.status)
        except sqlite3.Error:return self.respond({"error":"数据库暂时无法访问，请重试。"},503)
        except (ValueError,TypeError,AttributeError):return self.respond({"error":"请求字段格式不正确"},400)

    def do_GET(self):self.dispatch()
    def do_POST(self):self.dispatch(True)
    def do_PATCH(self):self.dispatch(True)
    def log_message(self,fmt,*args):
        if args and str(args[0]).startswith("GET /api/health"):return
        super().log_message(fmt,*args)

def make_server(store,port,static_dir,dev=False):
    server=ThreadingHTTPServer(("127.0.0.1",port),partial(Handler,store=store,static_dir=static_dir))
    server.dev=dev
    return server

def main():
    parser=argparse.ArgumentParser(description="Word Garden local classroom")
    parser.add_argument("--port",type=int,default=8765)
    parser.add_argument("--db",type=Path,default=ROOT/"data"/"classroom.sqlite3")
    parser.add_argument("--no-browser",action="store_true")
    parser.add_argument("--dev",action="store_true")
    args=parser.parse_args()
    static_dir=ROOT/"out"
    if not args.dev and not (static_dir/"index.html").exists():parser.error("Missing out/index.html. Run npm run build first, or use the packaged release.")
    store=Store(args.db)
    try:server=make_server(store,args.port,static_dir,args.dev)
    except OSError as exc:
        # Reopening this installation should reuse its running classroom.
        connection=HTTPConnection("127.0.0.1",args.port,timeout=1)
        try:
            connection.request("GET","/api/health")
            response=connection.getresponse()
            health=json.loads(response.read())
            expected=hashlib.sha256(str(args.db.resolve()).encode()).hexdigest()[:16]
            if response.status==200 and health.get("app")=="word-garden" and health.get("database_id")==expected:
                url="http://127.0.0.1:%d/"%args.port
                print("Word Garden is already running: "+url,flush=True)
                if not args.no_browser:webbrowser.open(url)
                return
        except (OSError,ValueError,AttributeError):pass
        finally:connection.close()
        parser.error("Port unavailable: %s. Try --port 8766."%exc)
    url="http://127.0.0.1:%d/"%server.server_port
    print("Word Garden: "+url+"\nDatabase: "+str(args.db)+"\nPress Ctrl+C to stop.",flush=True)
    if not args.no_browser:threading.Timer(0.6,lambda:webbrowser.open(url)).start()
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=="__main__":main()
