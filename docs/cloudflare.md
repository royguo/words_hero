# Cloudflare 生产与本地测试

生产入口为 **https://kitedance.com**。前端静态文件与 API 由 `kite-words` Worker 提供；数据库为独立的 `kite-words-db`（D1），图片、音频和素材原件位于 `kite-words-assets`（R2）。它们不与原 KiteDance 产品的数据混用。

## 本地模拟

```bash
npm ci
cp .dev.vars.example cloudflare/.dev.vars
# 将 SESSION_SECRET 换成任意足够长的本地随机字符串。
npm run cf:setup
npm run cf:dev
```

打开 http://127.0.0.1:8787，使用 `admin / 95279527` 登录。`.dev.vars` 仅供本地测试，禁止提交；本地默认 `AUDIO_ONLINE=false`，可以直接验证仓库已有录音。改成 true 后可实际测试在线合成。

本地使用 Wrangler 的真实 Worker 运行时，以及本地 D1 / R2 绑定；数据放在 `.wrangler/state`，不连接生产库。`KITE_CF_STATE` 可以指定另一个隔离目录供初始化和测试使用。`npm run test:cloudflare` 在临时目录运行整个 HTTP 流程，不改当前预览或真实课堂数据库。

`npm run dev` 是前端热更新；需同时启动本地 Worker。常规测试建议使用 `npm run cf:setup && npm run cf:dev`，与线上静态构建完全一致。旧 `server.py` / SQLite 保留为教材编译、迁移及旧离线包兼容参考，生产和日常测试均以 Worker 为准。

## 更新生产

登录 Cloudflare 后运行：

```bash
npx wrangler login
npm run assets:pull       # 收回课堂中新生成的公共录音，便于 Git 长期追踪
npm run cf:deploy
```

发布命令按顺序执行：素材校验和编译 → 类型检查与静态构建 → D1 迁移 → R2 素材同步 → 词库、内容包和音频索引 upsert → Worker 发布。任何步骤失败都会停止。迁移由 `migrations/` 与 D1 的迁移记录控制，只执行未执行的文件；**不能修改已经发布的迁移文件**，后续变更新增编号。

词库更新按 `(level, word)` 更新，保留线上数字 ID。既有课程读取创建时的完整快照，不会被新的词表或 catalog 改写。发布过程不导入本地课堂、不清库、不创建示例班级。R2 同步只添加/更新明确的源文件，不删除远端资产；内容哈希文件与发布过的 manifest 不能原地改稿。

`assets:pull` 从 D1 的独立音频索引与 R2 拉取 MP3 / manifest，校验文本缓存键、字节数与 SHA-256 后放进 `assets/audio/v1/`；不导出班级、笔记或学生记录。每轮完成后将代码、素材、来源与提示词一起 commit & push。网页和 Worker 自身不保存 GitHub 凭证、不执行 Git 命令。

## 登录

固定教师账号 `admin`，默认密码按用户要求为 `95279527`。生产密码与会话签名值存为 Worker secrets `ADMIN_PASSWORD`、`SESSION_SECRET`，用 `wrangler secret bulk --config cloudflare/wrangler.jsonc` 从本地私密文件/stdin 配置。普通部署不会重设密码或轮换签名值。

成功登录使用 30 天 HttpOnly、SameSite=Strict 会话 Cookie，HTTPS 下加 Secure；网页不将明文密码写入 localStorage。浏览器再次访问会自动登录，也可以主动退出。学生只由教师创建；首页 tab 区分身份，学生登录到 `/learn`，服务端禁止访问教师接口和其他学生会话。学生密码 PBKDF2 加盐存储，不回显；修改账号/密码或移除学生会撤销旧 Cookie。迁移 `0003_students.sql` 新增学生、练习会话、答题事件和记忆表；备份 JSON 包含这些私人数据，禁止提交 Git。

## 一次性迁移旧 SQLite

迁移输出包含课堂私有数据，必须放在忽略目录。本次已迁移原有班级与示例课的全部三个版本，课程编号保持不变。数字词汇 ID 按 `(level, word)` 重新映射到 D1，练习题、草稿答案和题序中的引用一起转换。

```bash
python3 scripts/cf_legacy_export.py --target remote
npx wrangler d1 execute kite-words-db --config cloudflare/wrangler.jsonc --remote --file .wrangler/private/legacy.sql
```

仅用于首次迁移，不属于正常更新命令。导入遇到已存在的课堂/课程/版本 ID 会跳过，避免覆盖线上进度。迁移前使用 SQLite backup API 备份；网页备份按钮现在导出课堂 JSON，生产完整数据库也可用 `wrangler d1 export` 导出 SQL。

## 删除与恢复边界

删除课程或班级使用 `deleted_at`，从正常列表、选词占用及学习进度中排除。删除班级会隐藏其全部课程，同时阻止其中学生登录；学生的历史记录继续保留。最新课程版本需要结课后才进入学生词库，未完成的旧练习会在下一次请求时检查并失效。R2 图片、音频、词库、内容包和音频索引没有与课堂记录级联删除的外键；删除后仍可复用。

当前没有回收站 UI。误删可由维护者将目标记录的 `deleted_at` 设为 NULL 恢复；如果所属班级也被删除，需要先恢复班级。恢复前检查课堂编号与目标 ID。未删除课程的历史版本继续完整回溯。

## 域名与回退

原 `kitedance.com` / `www.kitedance.com` 的 Custom Domain 属于 `kitedance-api-production`。新站使用更优先的 `kitedance.com/*`、`www.kitedance.com/*` Worker routes。原 Worker、D1 与 R2 仍保留，`api.`、`chat.`、`play.`、`trading.`、`stage.` 等子域名不改动。

需要回到旧站时，先确认已备份新站课堂数据，再移除这两条 `kite-words` routes；旧 Custom Domain 即恢复接管。新站自身的代码回退使用 Wrangler deployment rollback；数据库采用向前兼容迁移，不自动降级或删除列。

## 语音实现

浏览器统一请求 `/api/audio`。服务端用标准化文本 + Edge/Sonia/语速/格式计算稳定缓存键，命中 R2 就返回录音 URL；未命中通过 Edge 神经语音的 WebSocket 协议生成完整 MP3，验证后先存音频、再存 manifest、最后更新独立 D1 音频索引。图片和音频从同域 `/assets/…` 流式读取 R2，音频支持 Range 和长期缓存。

Cloudflare Worker 不运行 Python 子进程；`worker/audio.ts` 将原 edge-tts 协议适配到了 Workers。协议参考 edge-tts 7.2.8，保留上游 LGPL 许可于 `LICENSES/`。没有 GPT API 通道，没有系统合成声音回退。首次生成依赖外部语音服务可用性，已有录音独立保存；云端页面仍需网络访问，不把“素材已缓存”表述为整个网站可以离线运行。

参考：[Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)、[D1 本地开发](https://developers.cloudflare.com/d1/best-practices/local-development/)、[Workers WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)。
