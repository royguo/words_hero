# 可复用课堂素材

本目录全部进入 Git。课堂运行时只读取本地文件；不请求图片网站或模型。班级、课程进度、学生信息和数据库备份不存放在这里。

## 目录与版本

```text
assets/
  catalog.json                         新课程的默认单词素材索引
  words/<word>/v1/manifest.json         词义、例句、记忆情景、练习、图片元数据
  words/<word>/v1/<sha256>.png          内置 imagegen 生成的原始图片
  lessons/<bundle-id>/manifest.json    固定词单、单词素材引用、故事与互动问答
  lessons/<bundle-id>/<sha256>.png     故事配图
```

所有 JSON 都有 `schema_version: 1`。词单用 `KET:word` 等语义键映射，不依赖 SQLite 的数字 ID。`levels` 明确允许使用该词义素材的范围；一个词可有多套词义素材和多个版本。catalog 的键指向当前推荐版本，已创建的课程保存自己的文字和图片引用快照。

单词 manifest 的 `images` 是数组，可以为空，也可以有多张。每张记录 `id / file / sha256 / alt / caption / prompt / generator / created_at`。`file` 相对本目录；哈希必须与文件内容、文件名一致。故事页使用相同图片结构，`image: null` 时留空。不要用外链、占位图片或脚本代替文件。

`teaching` 可保存释义、词性、主例句、补充例句、中文记忆画面、构词及来源、学生问题和完形题。`story.scenes` 每页包含标题、英语、中文、图片、互动问题与答案。每页最多 40 个英文词 / 300 个字符，超过时增加页面；故事声明的目标词必须实际出现在正文中。英语中的目标词由网页高亮，图片本身不嵌文字。

## 课程制作

1. 在网页固定一课的词单，复制课程编号，例如 `WG-XXXXXXXXXX`。
2. 下载页面上的“素材任务”，或导出：

   ```bash
   python3 scripts/lesson_assets.py brief WG-XXXXXXXXXX --output tmp/lesson-brief.json
   ```

3. 按仓库 [AGENTS.md](../AGENTS.md) 制作或复用素材。先读旧 manifest；新增文件和 v2 版本，不覆盖旧资产。记录原始完整提示词，使用内置 imagegen，保存实际生成结果。
4. 校验，然后绑定到刚才的编号：

   ```bash
   python3 scripts/lesson_assets.py validate
   python3 scripts/lesson_assets.py apply WG-XXXXXXXXXX farm-friend-v1
   ```

绑定只接受与当前课程完全一致的词单和顺序；创建新课程版本并返回新编号，保留原词序和打印题序，不重新随机抽词。不允许修改已结课或旧版本。重复绑定完全相同的内容不新增版本。

新课会自动复用 catalog 中已收录的单词素材。跨词故事只按固定词单显式绑定：没有合适故事的课程不会套用不相关的情节，课堂导航也不会出现空故事页。

## 仓库示例：农场里的新同学

`farm-friend-v1` 来自一次随机抽取的 10 个非基础 KET 词，先定词单再写作，没有为了作图换词。包含 10 张词图、20 条简短例句、10 个记忆情景，以及 4 页原创图文对话和 4 道口头问题。故事共 101 个英文词，恰好自然用到了这 10 个词。图片采用明快、写实的儿童生活摄影风格，人物和衣服跨页保持一致。

可以在任何新的本地数据库中显式重建这节示例课：

```bash
python3 scripts/lesson_assets.py create-demo farm-friend-v1
# 也可以指定另一个数据库；--db 放在子命令之前。
python3 scripts/lesson_assets.py --db tmp/demo.sqlite3 create-demo farm-friend-v1
```

普通启动不创建演示课，仓库不包含真实课堂数据库。

## 来源与整理

本批图片使用内置 imagegen 生成，文字为 AI 辅助原创并逐词整理。每张图片的完整提示词位于相应 manifest，生成方法明确记录；没有抓取第三方图片。AI 图片是教学情景，不作为真实人物、农场或事件的照片证据。

构词说明参考 Merriam-Webster 的 [online](https://www.merriam-webster.com/dictionary/online)、[classmate](https://www.merriam-webster.com/dictionary/classmate)、[photo-](https://www.merriam-webster.com/dictionary/photo-) 与 [-er](https://www.merriam-webster.com/dictionary/-er)，核对日期 2026-09-07。仅整理词义和来源，不复制词典例句；课堂例句和故事独立编写。联想故事不代表真实词源。
