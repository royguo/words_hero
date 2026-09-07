"""Portable, versioned teaching assets; runtime uses saved lesson snapshots only."""
import copy
import hashlib
import json
import re
from pathlib import Path
from content import ROOT, LEVELS, UserError

ASSET_ROOT = ROOT / "assets"
TEACHING_FIELDS = {"meaning_zh", "pos", "example", "example_zh", "extra_examples",
                   "story_title", "story_zh", "student_prompt", "cloze", "cloze_answer",
                   "cloze_zh", "cloze_type", "parts", "note"}
IMAGE_TYPES = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
               ".webp": "image/webp", ".avif": "image/avif", ".gif": "image/gif"}


def asset_path(relative, root=ASSET_ROOT):
    if not isinstance(relative, str) or not relative or "\\" in relative:
        raise UserError("素材路径不正确")
    path = Path(relative)
    if path.is_absolute() or any(p.startswith(".") for p in path.parts):
        raise UserError("素材路径不正确")
    full = (root / path).resolve()
    if not full.is_relative_to(root.resolve()) or not full.is_file():
        raise UserError("素材文件不存在：" + relative, 404)
    return full


def read_manifest(relative, root=ASSET_ROOT):
    path = asset_path(relative, root)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError):
        raise UserError("素材清单不是有效的 JSON：" + relative)
    if not isinstance(data, dict) or data.get("schema_version") != 1:
        raise UserError("素材清单版本不支持：" + relative)
    return data


def image_snapshot(item, root=ASSET_ROOT):
    if not isinstance(item, dict):
        raise UserError("图片记录格式不正确")
    path = asset_path(item.get("file"), root)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if path.suffix.lower() not in IMAGE_TYPES or item.get("sha256") != digest or path.stem != digest:
        raise UserError("图片格式、内容哈希或文件名不匹配：" + str(path.name))
    for key in ("id", "alt", "prompt", "generator", "created_at"):
        if not isinstance(item.get(key), str) or not item[key].strip():
            raise UserError("图片缺少 " + key)
    return {"id": item["id"], "src": "/assets/" + item["file"], "sha256": digest,
            "alt": item["alt"], "caption": item.get("caption", "")}


def validate_teaching(teaching, word):
    if not isinstance(teaching, dict) or set(teaching) - TEACHING_FIELDS:
        raise UserError("单词教学字段不正确：" + word)
    for key, value in teaching.items():
        if key not in ("parts", "extra_examples") and (not isinstance(value, str) or len(value) > 3000):
            raise UserError("单词教学文本不正确：" + word)
    extras = teaching.get("extra_examples", [])
    if not isinstance(extras, list) or len(extras) > 6 or any(
        not isinstance(e, dict) or not all(isinstance(e.get(k), str) and 0 < len(e[k]) <= 300 for k in ("en", "zh")) for e in extras
    ):
        raise UserError("补充例句格式不正确：" + word)
    parts = teaching.get("parts", [])
    if not isinstance(parts, list) or len(parts) > 8 or any(
        not isinstance(p, dict) or p.get("kind") not in ("root", "prefix", "suffix", "compound")
        or not all(isinstance(p.get(k), str) and p[k] for k in ("text", "meaning")) for p in parts
    ):
        raise UserError("构词资料格式不正确：" + word)


def word_material(relative, word, root=ASSET_ROOT):
    data = read_manifest(relative, root)
    if data.get("word") != word["word"] or word["level"] not in data.get("levels", []):
        raise UserError("素材词义条目与所选单词或级别不匹配：" + word["word"])
    validate_teaching(data.get("teaching", {}), word["word"])
    if not data.get("id") or not isinstance(data.get("images"), list):
        raise UserError("单词素材缺少 ID 或图片列表")
    result = dict(word, **copy.deepcopy(data.get("teaching", {})))
    result["asset_id"] = data["id"]
    result["images"] = [image_snapshot(i, root) for i in data["images"]]
    return result


def enrich_words(words, root=ASSET_ROOT, mapping=None):
    if mapping is None:
        path = root / "catalog.json"
        mapping = read_manifest("catalog.json", root).get("words", {}) if path.exists() else {}
    result = []
    for word in words:
        key = word["level"] + ":" + word["word"]
        relative = mapping.get(key)
        result.append(word_material(relative, word, root) if relative else dict(word))
    return result


def load_bundle(bundle_id, words, root=ASSET_ROOT):
    if not isinstance(bundle_id, str) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,79}", bundle_id):
        raise UserError("课程素材包编号不正确")
    relative = "lessons/" + bundle_id + "/manifest.json"
    data = read_manifest(relative, root)
    order = data.get("word_order")
    if not isinstance(order, list) or not 1 <= len(order) <= 100 or any(not isinstance(w, str) or not w for w in order) or len(set(order)) != len(order):
        raise UserError("素材包需要 1–100 个不重复的单词")
    if data.get("id") != bundle_id or data.get("word_order") != [w["word"] for w in words]:
        raise UserError("素材包词单或顺序与课程不一致，请用当前课程编号重新导出任务")
    mapping = data.get("word_assets", {})
    if not isinstance(mapping, dict) or set(mapping) != {w["level"] + ":" + w["word"] for w in words}:
        raise UserError("素材包必须为固定词单声明全部单词素材")
    enriched = enrich_words(words, root, mapping)
    story = copy.deepcopy(data.get("story", {}))
    scenes = story.get("scenes", [])
    if not isinstance(scenes, list) or not 1 <= len(scenes) <= 12:
        raise UserError("故事需要 1–12 页图文")
    for key in ("title_en", "title_zh"):
        if not isinstance(story.get(key), str) or not 1 <= len(story[key]) <= 80:
            raise UserError("故事标题不正确")
    if story.get("level") != data.get("level") or data.get("level") not in LEVELS:
        raise UserError("故事难度级别不正确")
    coverage = story.get("covered_words", [])
    if not isinstance(coverage, list) or len(set(coverage)) != len(coverage) or not set(coverage) <= {w["word"] for w in words}:
        raise UserError("故事覆盖词单不正确")
    scene_ids = set()
    for scene in scenes:
        if not isinstance(scene, dict) or not re.fullmatch(r"[a-z0-9-]+", scene.get("id", "")) or scene["id"] in scene_ids:
            raise UserError("故事页编号缺失或重复")
        scene_ids.add(scene["id"])
        for key, limit in (("title", 40), ("en", 300), ("zh", 150)):
            if not isinstance(scene.get(key), str) or not 1 <= len(scene[key]) <= limit:
                raise UserError("故事页文字过长或缺失，请拆成多页")
        if len(scene["en"].split()) > 40:
            raise UserError("单页故事最多 40 个英文词，请拆页")
        question = scene.get("question")
        if not isinstance(question, dict) or any(not isinstance(question.get(k), str) or not 1 <= len(question[k]) <= 160 for k in ("en", "zh", "answer_en", "answer_zh")):
            raise UserError("故事页需提供简短互动问题和答案")
        scene["image"] = image_snapshot(scene["image"], root) if scene.get("image") else None
    english = " ".join(s["en"] for s in scenes)
    if any(not re.search(r"(?<![a-z])" + re.escape(w) + r"(?![a-z])", english, re.I) for w in coverage):
        raise UserError("声明覆盖的单词没有出现在故事正文中")
    digest = hashlib.sha256(asset_path(relative, root).read_bytes()).hexdigest()
    return enriched, {"bundle_id": bundle_id, "bundle_digest": digest, "story": story}


def validate_library(root=ASSET_ROOT):
    catalog = read_manifest("catalog.json", root)
    manifests = set()
    images = set()
    for key, relative in catalog.get("words", {}).items():
        level, word = key.split(":", 1)
        record = word_material(relative, {"word": word, "level": level}, root)
        manifests.add(relative)
        images.update(i["src"] for i in record["images"])
    ids = set()
    for path in sorted((root / "words").glob("*/*/manifest.json")):
        relative = path.relative_to(root).as_posix()
        data = read_manifest(relative, root)
        if not data.get("levels") or data.get("id") in ids:
            raise UserError("单词素材 ID 重复或级别缺失：" + relative)
        ids.add(data.get("id"))
        record = word_material(relative, {"word": data["word"], "level": data["levels"][0]}, root)
        manifests.add(relative)
        images.update(i["src"] for i in record["images"])
    bundles = []
    for path in sorted((root / "lessons").glob("*/manifest.json")):
        data = read_manifest(path.relative_to(root).as_posix(), root)
        words = bundle_words(data)
        _, snapshot = load_bundle(data["id"], words, root)
        bundles.append({"id": data["id"], "scenes": len(snapshot["story"]["scenes"]), "covered_words": len(snapshot["story"]["covered_words"])})
    return {"word_entries": len(manifests), "catalog_bindings": len(catalog.get("words", {})), "word_images": len(images), "bundles": bundles}


def bundle_words(data):
    """Recover portable source scopes, including teacher-confirmed mixed libraries."""
    keys = [key.split(":", 1) for key in data.get("word_assets", {})]
    result = []
    for word in data.get("word_order", []):
        matches = [key for key in keys if len(key) == 2 and key[1] == word and key[0] in LEVELS]
        if len(matches) != 1:
            raise UserError("素材包的单词需要唯一的来源词表：" + str(word))
        result.append({"word": word, "level": matches[0][0]})
    return result
