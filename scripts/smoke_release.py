#!/usr/bin/env python3
"""Verify the zipped local app over HTTP in a fresh temporary folder."""
import json,re,subprocess,sys,tempfile,zipfile
from pathlib import Path
from http.client import HTTPConnection
ROOT=Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix="word-garden-release-") as tmp:
    with zipfile.ZipFile(ROOT/"release/WordGarden-v1.zip") as archive:
        assert not any(".sqlite3" in n or "node_modules" in n for n in archive.namelist())
        archive.extractall(tmp)
    app=Path(tmp)/"WordGarden-v1"
    db=app/"data/classroom.sqlite3"
    process=subprocess.Popen([sys.executable,"server.py","--port","0","--no-browser"],cwd=app,
                             stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    try:
        first=process.stdout.readline()
        match=re.search(r"http://127.0.0.1:(\d+)/",first)
        if not match:raise AssertionError("Startup failed: "+first)
        port=int(match[1])
        def request(path,data=None):
            conn=HTTPConnection("127.0.0.1",port,timeout=10)
            body=json.dumps(data).encode() if data is not None else None
            try:
                conn.request("POST" if body else "GET",path,body,
                             {"Content-Type":"application/json"} if body else {})
                response=conn.getresponse();raw=response.read()
                assert response.status in (200,201),(path,response.status,raw[:150])
                return raw
            finally:conn.close()
        state=json.loads(request("/api/state"))
        assert not state["classes"]
        assert [v["total"] for v in state["levels"]]==[1707,3084,0,0]
        page=request("/").decode()
        assets={p for p in re.findall(r'(?:src|href)="([^"]+)"',page) if p.startswith("/")}
        assert assets
        for asset in assets:request(asset)
        # Canonical picture packs must work in the relocated, offline installation.
        validation=subprocess.run([sys.executable,"scripts/lesson_assets.py","validate"],cwd=app,capture_output=True,text=True,timeout=20)
        assert validation.returncode==0,validation.stderr
        catalog=json.loads((app/"assets/catalog.json").read_text())
        picture_files=set()
        for relative in set(catalog["words"].values()):
            entry=json.loads((app/"assets"/relative).read_text())
            picture_files.update(i["file"] for i in entry["images"])
        bundle=json.loads((app/"assets/lessons/farm-friend-v1/manifest.json").read_text())
        picture_files.update(s["image"]["file"] for s in bundle["story"]["scenes"] if s["image"])
        for image in picture_files:
            raw=request("/assets/"+image)
            assert raw.startswith(b"\x89PNG"),image
        cid=json.loads(request("/api/classes",{"name":"Release check"}))["id"]
        draft=json.loads(request("/api/preview",{"class_id":cid,"level":"PET","count":50}))
        assert not json.loads(request("/api/state?class_id="+cid))["lessons"]
        lesson=json.loads(request("/api/drafts/"+draft["id"]+"/confirm",{"revision":draft["revision"]}))
        assert [w["id"] for w in lesson["words"]]==[w["id"] for w in draft["words"]]
        assert len(lesson["words"])==50
        assert all(w["story_zh"] and w["example"] and w["cloze"] for w in lesson["words"])
        assert len(lesson["config"]["worksheet_order"]["english_to_chinese"])==50
        for kind in ("classroom","homework","answers"):
            html=request("/api/versions/"+lesson["version_id"]+"/worksheet?kind="+kind).decode()
            assert "@page{size:A4" in html
            assert 'aria-label="' in html
        backup=request("/api/backup")
        assert backup.startswith(b"SQLite format 3")
        again=subprocess.run([sys.executable,"server.py","--port",str(port),"--no-browser"],
                             cwd=app,capture_output=True,text=True,timeout=10)
        assert again.returncode==0 and "already running" in again.stdout,again.stderr
        demo=subprocess.run([sys.executable,"scripts/lesson_assets.py","--db","tmp/demo.sqlite3","create-demo","farm-friend-v1"],cwd=app,capture_output=True,text=True,timeout=20)
        assert demo.returncode==0,demo.stderr
        assert json.loads(demo.stdout)["course_code"].startswith("WG-")
        print(json.dumps({"release":"passed","words":len(lesson["words"]),
                          "assets_served":len(assets),"materials_complete":True,
                          "teaching_images_served":len(picture_files),"portable_demo":"recreated",
                          "a4_views":3,"backup":"valid","repeat_launch":"reused"},indent=2))
    finally:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait()
