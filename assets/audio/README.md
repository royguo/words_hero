# 可复用语音素材

本目录的 MP3 和配套 JSON 进入 Git，随发布包分发。内容来自课堂的英语教材，不含班级名称、学生信息、教师笔记或答题记录。网页没有 GPT API 通道。

## 声音与来源

- 在线服务：Microsoft Edge 在线朗读，经社区维护的 [edge-tts](https://github.com/rany2/edge-tts) 客户端调用。
- 生成工具：`edge-tts==7.2.8`，在独立的 `.venv-audio` 中安装，上游代码使用 LGPLv3 许可；本仓库不内嵌该依赖代码或虚拟环境。
- 声音：`en-GB-SoniaNeural`，英式英语女声；合成语速 `-10%`。
- 音频：MP3，24 kHz、单声道、48 kbit/s。合成语音并非真人现场录音。
- 示例 `farm-friend-v1` 的 42 段语音于 2026-09-07 实际联网生成，包括 10 个单词、20 条例句、4 页故事和 8 条问题/答案。

## 结构与缓存规则

```text
assets/audio/v1/
  <request-sha256>.json    原文、声音、语速、格式、来源、时间、文件哈希
  <audio-sha256>.mp3       实际录音文件
```

请求哈希覆盖规范化文本（NFC、合并空白，保留大小写）、服务、模型类型、声音、合成语速、格式及缓存 schema。MP3 使用内容哈希命名，JSON 的 `file` 为相对 `assets/` 的路径。相同声音参数下的相同文本跨课程复用；更改文本或声音参数会产生新缓存键，旧录音保留。

缓存不绑定 SQLite ID，也不改历史课程。课程页面从已保存的课程快照汇总要朗读的原文，去重后查看缓存。一次下载成功即可复用，不需要每次播放都重新下载。

保存采用临时文件写入、原子替换、先音频后 manifest 的顺序。同一进程中相同请求合并，在线并发上限为 2；失败、中断或无效 MP3 不发布缓存记录。前端暂停只中止排队和等待，已经开始的单段生成可能在后台完成，重新检查时会识别它。

## 课前准备与验证

```bash
python3 scripts/setup_audio.py
python3 scripts/lesson_audio.py status WG-XXXXXXXXXX
python3 scripts/lesson_audio.py warm WG-XXXXXXXXXX
python3 scripts/lesson_audio.py validate
```

界面中的“课前缓存本课语音”使用相同缓存；暂停后再次点击即可继续。自动测试不联网，实际生成后还应检查 MP3 可解码。课堂开始前确认已保存数量等于总数。

仅播放已保存素材、明确禁用新语音联网请求：

```bash
WORD_GARDEN_TTS_OFFLINE=1 python3 server.py
```

没有语音组件、离线或服务异常时，已缓存的 MP3 仍可用。损坏的文件会报告校验失败，先从 Git 或素材备份恢复配套 JSON 和 MP3 后重试；不将损坏缓存静默替换为其他录音。

后续任务将新 MP3 与 JSON 一并提交并推送。网页本身不自动执行 Git；临时 `.audio-*` 文件、`.venv-audio` 和本地数据库不进入版本控制。备份数据库时另行保留整个 `assets/` 目录。
