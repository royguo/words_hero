# 背包里的小乘客 · The Little Camper

20 个 KET 词，一次随机抽取后固定顺序。排除基础词及本班已学词，没有为了配图更换单词。

curtain、practice、driver、copy、serve、tooth、honey、danger、camping、geography、unhappy、bath、seat、single、serious、helicopter、jellyfish、kitten、backpack、good-looking。

每词提供一个核心词义、两条例句、两项关联词或搭配及其例句、一个构词小问题和一道句子填空。构词重点包括 `un-`、`-er`、`-ing`、`geo-` / `-graphy` 与合成词。只为 geography 和 helicopter 保留简短、可核查的助记来源；其他词不填无助记忆的词源历史。

四页故事每页 28–31 个英文词，带中译、问题与答案，正文实际覆盖 11 个目标词。故事图直接引用 backpack、driver、unhappy、camping 的公用词图，保持角色和道具一致，无需为每个课程重复保存同一图片。

全部配图使用内置 imagegen，最终图片与完整提示词、来源、日期、参考素材及 SHA-256 保存于各词的 `v1/manifest.json`。局部修订保留初始提示词与原图哈希；未选用的图片不作为课堂素材发布。英式音标校订位于 `data/pronunciations.ts`，来源为 Cambridge Dictionary。

本课共有 152 条独立朗读文本，包含目标词、例句、关联词、故事与问答；沿用 Sonia 英式慢速语音，MP3 和生成记录保存于 `assets/audio/v1/`，按文本和声音参数跨课复用。

绑定课程时一次性保存随堂抄写、构词联系、20 道句子填空及答案，并由现有 A4 模板分页。双面单词卡片为 20 张、每面 6 格，长边翻转。课堂编号及班级数据属于私人数据，不写进此公共素材包。

校验：`python3 scripts/lesson_assets.py validate`、`python3 scripts/lesson_audio.py validate`。新增版本使用新目录和素材 ID，不能覆盖已发布文件。
