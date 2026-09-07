"""Online TTS at preparation time, immutable MP3 assets at teaching time.

The HTTP server keeps its stdlib-only runtime. Edge runs in an optional isolated
worker. Cache identity excludes classroom data.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

from assets import ASSET_ROOT, asset_path
from content import ROOT, UserError

MAX_TEXT = 2000
MAX_AUDIO = 5_000_000
FORMAT = "audio-24khz-48kbitrate-mono-mp3"
SOURCE_URL = "https://github.com/rany2/edge-tts"


def normalize_text(value):
    if not isinstance(value, str) or len(value) > MAX_TEXT:
        raise UserError("朗读文字须为 1–2000 个字符")
    text = unicodedata.normalize("NFC", " ".join(value.split()))
    if not text or not re.search(r"[A-Za-z]", text) or any(unicodedata.category(c).startswith("C") for c in text):
        raise UserError("请提供有效的英文朗读内容")
    return text


def canonical(data):
    return json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


def lesson_texts(lesson):
    """Only authored English material, never names, notes, marks or attempts."""
    items = {}

    def add(text, kind):
        if text:
            text = normalize_text(text)
            items.setdefault(text, {"text": text, "kind": kind})

    for word in lesson["words"]:
        add(word["word"], "word")
        add(word.get("example"), "example")
        for example in word.get("extra_examples", []):
            add(example.get("en"), "example")
        for related in word.get("word_study", {}).get("family", []):
            add(related.get("word"), "word")
            add(related.get("example", {}).get("en"), "example")
    for scene in lesson.get("materials", {}).get("story", {}).get("scenes", []):
        add(scene.get("en"), "story")
        add(scene.get("question", {}).get("en"), "question")
        add(scene.get("question", {}).get("answer_en"), "answer")
    return list(items.values())


def is_mp3(body):
    # The provider returns a raw MPEG stream (an optional ID3v2 tag
    # is also allowed). Reject JSON/HTML errors before publishing cache entries.
    if not 128 <= len(body) <= MAX_AUDIO:
        return False
    start = 0
    if body.startswith(b"ID3"):
        if any(x >= 128 for x in body[6:10]):
            return False
        start = 10 + sum(x << shift for x, shift in zip(body[6:10], (21, 14, 7, 0)))
    if start + 4 > len(body):
        return False
    a, b, c = body[start:start + 3]
    return (a == 255 and b & 224 == 224 and b & 24 != 8 and b & 6 != 0
            and c >> 4 not in (0, 15) and c & 12 != 12)


class AudioLibrary:
    def __init__(self, asset_root=ASSET_ROOT, environ=None, synthesize=None):
        self.asset_root = Path(asset_root)
        self.environ = dict(os.environ if environ is None else environ)
        self.provider = "edge"
        self.profile = {"schema_version": 1, "provider": self.provider,
                        "model": "neural", "voice": "en-GB-SoniaNeural",
                        "rate": "-10%", "format": FORMAT}
        self.runner = ROOT / ".venv-audio" / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
        self.synthesize = synthesize or self._synthesize
        # Fixed stripes avoid an ever-growing lock table; requests for one clip
        # coalesce, and distinct clips cannot flood the upstream service.
        self.locks = [threading.Lock() for _ in range(64)]
        self.slots = threading.BoundedSemaphore(2)

    def configuration(self):
        reason = ""
        if self.environ.get("WORD_GARDEN_TTS_OFFLINE") == "1":
            reason = "已设为离线播放；未缓存的语音需要联网准备。"
        elif not self.runner.is_file():
            reason = "在线语音组件尚未安装，请按项目说明启用；已有录音仍可播放。"
        return {"provider": self.provider, "voice": self.profile["voice"],
                "label": "英式英语 · Sonia · 清晰慢速", "configured": not reason,
                "message": reason, "synthetic": True}

    def identity(self, text):
        request = {**self.profile, "text": normalize_text(text)}
        return hashlib.sha256(canonical(request)).hexdigest(), request

    def _manifest_path(self, key):
        return self.asset_root / "audio" / "v1" / (key + ".json")

    def cached(self, key, request):
        path = self._manifest_path(key)
        if not path.exists():
            return None
        try:
            path = asset_path("audio/v1/" + key + ".json", self.asset_root)
            if path.stat().st_size > 20_000:
                raise ValueError("manifest size")
            manifest = json.loads(path.read_text(encoding="utf-8"))
            digest = manifest["sha256"]
            if (manifest["key"] != key or manifest["request"] != request
                    or not re.fullmatch(r"[a-f0-9]{64}", digest)
                    or manifest["file"] != "audio/v1/" + digest + ".mp3"):
                raise ValueError("manifest identity")
            audio = asset_path(manifest["file"], self.asset_root)
            if audio.stat().st_size > MAX_AUDIO:
                raise ValueError("audio size")
            body = audio.read_bytes()
            if (len(body) != manifest["bytes"] or hashlib.sha256(body).hexdigest() != digest
                    or not is_mp3(body)):
                raise ValueError("audio checksum")
            return {"key": key, "url": "/assets/" + manifest["file"], "bytes": len(body), "cached": True}
        except (OSError, ValueError, KeyError, TypeError, UserError):
            raise UserError("这份语音缓存不完整，请从素材备份恢复后重试。", 409)

    def inventory(self, lesson):
        items = []
        for item in lesson_texts(lesson):
            key, request = self.identity(item["text"])
            clip = self.cached(key, request)
            items.append({**item, "key": key, "cached": bool(clip), "url": clip["url"] if clip else None})
        return {"configuration": self.configuration(), "items": items,
                "total": len(items), "cached": sum(i["cached"] for i in items)}

    def prepare(self, text):
        key, request = self.identity(text)
        clip = self.cached(key, request)
        if clip:
            return clip
        lock = self.locks[int(key[:8], 16) % len(self.locks)]
        if not lock.acquire(timeout=35):
            raise UserError("语音正在准备，请稍后再试。", 429)
        try:
            clip = self.cached(key, request)
            if clip:
                return clip
            configuration = self.configuration()
            if not configuration["configured"]:
                raise UserError(configuration["message"], 503)
            if not self.slots.acquire(timeout=2):
                raise UserError("正在准备其他语音，请稍后再试。", 429)
            try:
                body = self.synthesize(request)
            finally:
                self.slots.release()
            if not is_mp3(body):
                raise UserError("语音服务没有返回有效录音，请稍后重试。", 502)
            digest = hashlib.sha256(body).hexdigest()
            relative = "audio/v1/" + digest + ".mp3"
            manifest = {"schema_version": 1, "key": key, "request": request,
                        "file": relative, "sha256": digest, "bytes": len(body),
                        "created_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                        "generator": "edge-tts 7.2.8", "source": SOURCE_URL, "synthetic": True}
            # Publish audio first, manifest last. A killed process never leaves
            # a cache hit referring to a half-written recording.
            self._atomic(self.asset_root / relative, body)
            self._atomic(self._manifest_path(key), json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8") + b"\n")
            return {"key": key, "url": "/assets/" + relative, "bytes": len(body), "cached": False}
        except OSError:
            raise UserError("无法保存语音，请检查素材目录是否可写以及磁盘空间。", 503)
        finally:
            lock.release()

    def _atomic(self, path, body):
        # A local symlink must not redirect generated files outside assets/.
        if not path.resolve().is_relative_to(self.asset_root.resolve()):
            raise UserError("语音素材路径不正确", 400)
        path.parent.mkdir(parents=True, exist_ok=True)
        temp = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".audio-", delete=False) as stream:
                temp = Path(stream.name)
                stream.write(body)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temp, path)
        finally:
            if temp is not None:
                temp.unlink(missing_ok=True)

    def _synthesize(self, request):
        try:
            result = subprocess.run([str(self.runner), str(ROOT / "scripts/tts_worker.py")],
                                    input=canonical(request), capture_output=True, timeout=32)
        except (OSError, subprocess.TimeoutExpired):
            raise UserError("在线语音连接超时，请检查网络后重试；已有录音仍可离线播放。", 503)
        if result.returncode:
            raise UserError("在线语音暂时不可用，请稍后重试；已有录音仍可离线播放。", 502)
        return result.stdout


def validate_audio_library(root=ASSET_ROOT):
    """Validate reusable audio independently of any private classroom database."""
    total = 0
    for path in sorted((Path(root) / "audio" / "v1").glob("*.json")):
        try:
            manifest = json.loads(path.read_text(encoding="utf-8"))
            request = manifest["request"]
            key = hashlib.sha256(canonical(request)).hexdigest()
            if key != path.stem or manifest["schema_version"] != 1:
                raise ValueError("identity")
            library = AudioLibrary(root, environ={})
            if not library.cached(key, request):
                raise ValueError("missing")
            total += 1
        except (OSError, ValueError, KeyError, TypeError, UserError):
            raise UserError("语音素材校验失败：" + path.name, 409)
    return {"audio_clips": total}
