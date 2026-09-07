#!/usr/bin/env python3
"""Compile tracked public teaching sources into safe, repeatable D1 upserts."""
import json,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from content import parse_csv,dump,BASIC
from assets import enrich_words,validate_library,read_manifest,load_bundle,bundle_words
from audio import validate_audio_library,canonical
from worksheets import CSS
quote=lambda s:"'"+str(s).replace("'","''")+"'"
def main():
    validate_library();validate_audio_library()
    out=ROOT/'.wrangler/content';out.mkdir(parents=True,exist_ok=True)
    statements=[];vocab={}
    for level in ('ket','pet','cet-4','cet-6'):
        path=ROOT/'data'/(level+'.csv')
        if not path.exists():continue
        for w in enrich_words(parse_csv(path.read_text(encoding='utf-8-sig'),level.upper())):
            vocab[(w['level'],w['word'])]=w
            statements.append('INSERT INTO vocabulary(level,word,difficulty,is_basic,data) VALUES(%s,%s,%d,%d,%s) ON CONFLICT(level,word) DO UPDATE SET difficulty=excluded.difficulty,is_basic=excluded.is_basic,data=excluded.data;'%(quote(w['level']),quote(w['word']),w['difficulty'],w['is_basic'],quote(dump(w))))
    for path in sorted((ROOT/'assets/lessons').glob('*/manifest.json')):
        manifest=json.loads(path.read_text());words=[vocab[(w['level'],w['word'])] for w in bundle_words(manifest)]
        words,materials=load_bundle(manifest['id'],words)
        data={'word_order':manifest['word_order'],'words':words,'materials':materials,'title':manifest['title'],'level':manifest['level']}
        digest=hashlib.sha256(path.read_bytes()).hexdigest()
        # Immutable pack IDs: changed source must be published with a new ID.
        statements.append('INSERT INTO content_packs VALUES(%s,%s,%s) ON CONFLICT(id) DO NOTHING;'%(quote(manifest['id']),quote(digest),quote(dump(data))))
    for path in sorted((ROOT/'assets/audio/v1').glob('*.json')):
        m=json.loads(path.read_text())
        statements.append('INSERT INTO audio_index VALUES(%s,%s,%d,%s) ON CONFLICT(key) DO UPDATE SET file=excluded.file,bytes=excluded.bytes,request=excluded.request;'%(quote(m['key']),quote(m['file']),m['bytes'],quote(canonical(m['request']).decode())))
    (out/'seed.sql').write_text('\n'.join(statements)+'\n')
    (ROOT/'worker/worksheet-style.ts').write_text('// Generated from worksheets.py and content.py by cf_prepare.py.\nexport const worksheetCSS = '+json.dumps(CSS,ensure_ascii=False)+';\nexport const basicWords = '+json.dumps(sorted(BASIC))+';\n')
    files=[]
    for path in sorted((ROOT/'assets').rglob('*')):
        if path.is_file() and path.suffix in ('.png','.jpg','.jpeg','.webp','.mp3','.json','.md'):
            key=path.relative_to(ROOT/'assets').as_posix();files.append({'key':key,'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    for path in sorted((ROOT/'data').glob('*.csv')):files.append({'key':'data/'+path.name,'file':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
    (out/'objects.json').write_text(json.dumps(files,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({'vocabulary':len(vocab),'objects':len(files),'seed_sql_bytes':(out/'seed.sql').stat().st_size}))
if __name__=='__main__':main()
