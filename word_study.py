"""Bounded, portable authoring schema for one word's origin/construction slide.

Raises ValueError so CSV and asset importers can use their own error envelopes.
Legacy snapshots need no migration and are never assigned invented etymologies.
"""
import copy
from urllib.parse import urlparse

FORMATIONS = {"simple", "compound", "derived", "phrase"}
COMPONENTS = {"base", "root", "prefix", "suffix", "word"}
RELATIONS = {"compound", "derivation", "shared_root", "word_family", "phrase", "inflection", "shared_affix"}


def validate_study(study):
    def fields(value, names):
        if not isinstance(value, dict) or set(value) != set(names.split()):
            raise ValueError("单词来源与构成的字段不正确")

    def text(value, limit):
        if not isinstance(value, str) or not value.strip() or len(value) > limit:
            raise ValueError("单词来源与构成的文本为空或超过单页长度限制")

    if isinstance(study, dict) and study.get("schema_version") == 2 and "origin_zh" not in study:
        study = {**study, "origin_zh": ""}
    fields(study, "schema_version formation construction components explanation_zh origin_zh family challenge sources")
    if type(study["schema_version"]) is not int or study["schema_version"] not in (1, 2):
        raise ValueError("单词来源与构成的版本不支持")
    if study["formation"] not in FORMATIONS:
        raise ValueError("构成类型不正确")
    for name, limit in (("construction", 64), ("explanation_zh", 100)):
        text(study[name], limit)
    origin = study["origin_zh"]
    if not isinstance(origin, str) or len(origin) > (60 if study["schema_version"] == 2 else 100):
        raise ValueError("来源提示应短而有助记忆；没有合适内容请留空")
    parts = study["components"]
    if not isinstance(parts, list) or len(parts) > 4:
        raise ValueError("每个词最多 4 个构成成分")
    if (study["formation"] == "simple" and parts) or (study["formation"] != "simple" and len(parts) < 2):
        raise ValueError("整体词不应硬拆，合成或派生词至少有两个成分")
    for part in parts:
        fields(part, "text kind meaning_zh")
        if part["kind"] not in COMPONENTS:
            raise ValueError("构词成分类型不正确")
        text(part["text"], 24)
        text(part["meaning_zh"], 18)
    family = study["family"]
    if not isinstance(family, list) or not (0 if study["schema_version"] == 2 else 1) <= len(family) <= 2:
        raise ValueError("每个词提供 1–2 个关联词，保证大屏一页可读")
    for related in family:
        fields(related, "word meaning_zh relation connection_zh example")
        if related["relation"] not in RELATIONS:
            raise ValueError("关联词类型不正确")
        for key, limit in (("word", 28), ("meaning_zh", 20), ("connection_zh", 55)):
            text(related[key], limit)
        fields(related["example"], "en zh")
        text(related["example"]["en"], 90)
        text(related["example"]["zh"], 40)
    fields(study["challenge"], "prompt_zh answer_zh")
    text(study["challenge"]["prompt_zh"], 100)
    text(study["challenge"]["answer_zh"], 70)
    sources = study["sources"]
    minimum_sources = 1 if study["schema_version"] == 1 or origin or parts or family else 0
    if not isinstance(sources, list) or not minimum_sources <= len(sources) <= 6:
        raise ValueError("需记录可核查的词源或构词资料来源")
    for source in sources:
        fields(source, "title url")
        text(source["title"], 80)
        text(source["url"], 300)
        url = urlparse(source["url"])
        if url.scheme != "https" or not url.hostname or url.username or url.password:
            raise ValueError("来源必须是 HTTPS 资料链接")
    return copy.deepcopy(study)
