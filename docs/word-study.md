# 单词来源与构成：结构化教材规范

`Word.word_study` 是可选的结构化对象；新精编教材必须填写。CSV 使用 `study_json` 列，单词 manifest 使用 `teaching.word_study`。Python 和 Worker 都会校验结构。精编示例见 `assets/words/farm/v2/manifest.json`。

| 字段 | 内容 |
|---|---|
| schema_version | 新教材使用 2；保留读取旧版 1 |
| formation | simple / compound / derived / phrase |
| construction | 屏幕展示的整体词或构词等式，最多 64 字符 |
| components | 最多 4 项：text、kind、meaning_zh；kind 为 base/root/prefix/suffix/word |
| explanation_zh | 构成及记忆联系，最多 100 字符 |
| origin_zh | 可省略或留空；仅保留可靠、有趣且有助记忆的背景，最多 60 字符 |
| family | 0–2 个确有帮助的关联词，含 word、meaning_zh、relation、connection_zh、双语 example |
| challenge | prompt_zh 和 answer_zh；用于讲课揭晓与课后构词联系题 |
| sources | 涉及词源/构词/关联时保留 1–6 条可靠 HTTPS 来源；无相关说明可空 |

整体词的 components 必须为空；其他构词方式至少两个成分。关联类型包括 compound（合成）、derivation（派生）、shared_root（同源）、word_family（词族）、phrase（搭配）、inflection（词形变化）、shared_affix（同词缀）。完整长度上限见 `word_study.py`，用于保证投影单页可读。

不要为了填写“来源”而写古语拼写、词形演变链或与当前含义无关的史料。先问：这条信息是否让小学生更容易记住词？若没有，不写。一般用一句短话即可；没有有趣背景时，保留完整词形、实用构词和例句。旧 v1 的来源正文保存在历史快照中，教学页统一隐藏；v2 的短提示由备课模型按此标准筛选。

不能看到相同字母就宣称同根。`lizard → lizards` 是复数变化，`afterwards` 的末尾 -s 是历史副词形式；要区分。简单词可以说明它如何形成其他词或搭配。关联例句要短、原创、级别适当；陌生的扩展词同时提供中文。

课前卡片点击“来源和构成”打开独立弹窗，避免展开挤坏卡片。

大屏幕顺序：单词、释义、双语例句 → **一个来源和构成页** → 下一个单词。来源页包含关联词、短例句、来源链接和可揭晓的小问题。旧词表缺少这一对象时，只显示已有且可解释的构词线索，不编造词源。跨词的完整情景故事仍在整组词学习之后展示。

创建课程版本时，`config.worksheets` 一次性保存跟写项目、构词联系题与句子题的题目/答案；之后打印或改掌握情况不会重排。题目、教师答案共用固定 ID 与分页逻辑。随堂跟写、课后填空、教师答案为三个独立 A4 文档。默认示例课随堂 3 页，课后 4 页（联系 2 页 + 句子 2 页），字号和留白优先于压缩纸张。

`farm-friend-v2` 保留原课 10 个单词、10 张词图与 4 页故事；新增每词词源、构成、2 组关联词及双语例句。逐词小故事退役。新材料绑定必须生成新课程版本，不能改旧快照。


新教材最简整体词示例（不硬编词源或关联）：

```json
{
  "schema_version": 2,
  "formation": "simple",
  "construction": "lizard",
  "components": [],
  "explanation_zh": "把 lizard 作为一个完整单词记住：蜥蜴。",
  "family": [],
  "challenge": {"prompt_zh": "lizard 是什么动物？", "answer_zh": "蜥蜴。"},
  "sources": []
}
```
