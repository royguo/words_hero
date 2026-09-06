# 词表范围参考

这里保存从剑桥 2025 年 8 月 A2 Key / B1 Preliminary 指南提取的英文词头与词性，以及用于匹配词典的归一化词头。只作为词汇范围的核对输入，不能把提取行数视为官方独立单词统计。

- `*-heads.json`：提取行。包括短语、变体以及少数排版重复或拼写问题。
- `*-matched.json`：词典匹配用词头。最终教材另做常用义修订、去重、基础词过滤及误拼修正。
- 不随发布包分发参考 PDF。
- 从词典重新扩充时，将 MIT 许可 ECDICT CSV 放为 `word-garden-ecdict.csv`，再依次运行 `scripts/build_vocab.py`、`scripts/expand_vocab.py`、`scripts/augment_vocab.py`、`scripts/build_materials.py`。
- 通常只需要修改教材源并运行 `npm run materials`，不必从头重建词汇范围。

原始指南及词典链接见项目 README。
