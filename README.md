# 小红书监控系统 (XHS Account Monitor v2.0)

> **平台支持**：目前仅完整适配并在 **Windows 10 / 11** 上实机验证，**macOS / Linux 暂未适配**。

专为小红书目标账号打造的 **本地全量存档、三态分层监控、变动时间对比、次日 0 点「昨天 HH:mm」精确时间对照汇总** 系统，配套 Linear 极简风格本地 Web 控制台与 Bark / QQ 邮箱双通道提醒。

项目仅依赖 Node.js v24 原生能力（内置 TypeScript 执行与 `node:sqlite`）及极少量核心包，支持多账号独立数据隔离，并已通过 `.gitignore` 严格隔离本地隐私配置与抓取数据，可直接开源部署或上传 GitHub。

---

## 界面预览

### 概览与实时倒计时（常态监控 / 检测到删帖自动切入高频追踪）

![概览页 - 正常监控与独立倒计时](docs/images/overview1.png)

![概览页 - 删帖触发高频监控与已删标记](docs/images/overview3.png)

### 变动记录与本地备份（删帖区间推算、编辑历史与原图/评论永久留存）

![变动记录 - 删帖时间区间推算与原文原图留存](docs/images/comparisons3.png)

![本地备份 - 原帖删除后仍永久保留卡片与删除区间](docs/images/archive1.png)

![作品详情抽屉 - 已删提示、编辑前后对比与评论存档](docs/images/note-detail1.png)

### 系统设置（三态分层参数 + Bark / QQ 邮箱双通道通知）

![设置页 - 监控目标、分层间隔与双通道推送](docs/images/settings.png)

<details>
<summary>展开查看更多页面截图（动态流 / 新评与改文对比 / 本地备份常规态 / 资料记录 / 正常态作品详情）</summary>

#### 概览动态流
![概览页 - 动态事件明细流](docs/images/overview2.png)

#### 变动记录 · 新评论与改文对比
![变动记录 - 新评论发布时间对比](docs/images/comparisons1.png)

![变动记录 - 评论配图与改文前后红绿 Diff 对照](docs/images/comparisons2.png)

#### 本地备份 · 全部作品与资料记录
![本地备份 - 全部作品网格视图](docs/images/archive.png)

![本地备份 - 名字、性别与个性签名资料记录](docs/images/archive-profile.png)

#### 作品详情抽屉（正常态）
![作品详情抽屉 - 正常态详情、编辑历史与评论区存档](docs/images/note-detail.png)

</details>

---

## 核心功能

1. **首次运行全量备份（解决超过 2 天丢失具体时分的问题）**
   - 首次填写目标主页链接后，自动抓取并保存账号现有全部笔记、高清原图、头像、正文以及全部历史评论与子回复。
   - 同时记录接口毫秒级时间戳与页面显示文本，并在每篇笔记目录下生成 `笔记图文信息备份.json`；即使超过 2 天小红书页面只显示 `MM-DD`，本地库仍永久保留精确发布时间与图文快照。
   - 针对仅 0–1 篇笔记的短页面做了异步加载等待与空基线防护，避免因网络波动误判为 0 篇笔记。

2. **三态分层监控 + 评论者小红书号缓存（更贴近真人浏览习惯）**
   - **轻量主页模式（默认随机 15–20 分钟）**：平时仅访问目标主页 1 页，即可监测名字/性别/签名/头像/IP、关注粉丝总赞藏、新发笔记、删帖、标题与点赞变化；若发现某篇变动（含 0 篇变 1 篇），当轮仅深入检查变动帖。
   - **定期全部笔记模式（默认随机 50–55 分钟）**：定时完整巡查全部笔记详情、评论与编辑时间；顶部提供 **「检查全部笔记」** 按钮随时手动触发。
   - **高频追踪模式（默认随机 5–10 分钟）**：检测到监控范围内的有效变动后自动切换，每轮精准检查「主页 + 变动帖 + 除变动帖外最新 4 篇」，连续 2 轮无新动静自动恢复常态。
   - **评论者小红书号防重查缓存**：启动采集前全量传入本地 `user_red_id_cache`，已有记录（含已标记查不到的账号）绝不重复访问对方主页，仅对全新评论者按需查询。

3. **全方位变动对比与多账号独立隔离**
   - **删帖 / 删评对比**：保留本地已抢救的原图与原文，并根据「最后确认存活时间 ~ 本次发现消失时间」自动推算大概删除时间区间与存活时长。
   - **改文与编辑时间记录**：记录笔记前后内容红绿 Diff 对比及平台留下的精确编辑时间（写入 `notes` 与 `note_revisions` 版本表）。
   - **新评论对比**：支持在超过 2 天的老笔记下出现新评论时，调取本地锁定的原笔记精确发布时间进行对比。
   - **账号资料与 IP 属地追踪**：自动记录 **IP 属地**（含主页与笔记级）、**头像**、**名字**、**性别**、**个性签名**（默认「还没有简介」等占位自动归一化为空白）的变更轨迹，同步写入 SQLite 与 `storage/logs/*.jsonl`。
   - **多账号切换完全隔离**：数据库全表按 `user_id` 分账存储（笔记、评论、动态、变动记录、IP/头像/资料历史、每日汇总与建档状态互不串台），随时切换目标账号不会继承旧账号数据，切回历史账号可无损续接监控且免重复建档。

4. **次日 0 点（默认 `00:02`）精确时间核对与每日汇总**
   - 利用小红书跨过零点后会将前一天内容显示为精确 **`昨天 HH:mm`**（及 `编辑于 昨天 HH:mm`）的机制，每天自动复核前一天所有新内容，将精确时间永久锁定至本地数据库，并与当天首次捕获时间对照输出 Markdown / JSON 日报至 `storage/reports/`。
   - 控制台顶部支持一键查看 **「当天汇总」**。

5. **Linear 风格本地 Web 控制台 + 双通道消息推送**
   - 本地访问 `http://localhost:3000`，支持明暗主题切换、独立实时倒计时卡片、作品详情抽屉、原图灯箱预览与快捷键（`1–5` 切换视图、`/` 搜索、`Esc` 关闭弹窗）。
   - 支持 **Bark（iOS 推送）** 与 **QQ 邮箱（原生 SMTPS `smtp.qq.com:465`，零额外依赖）** 双通道提醒，可同时开启或单独使用，并在设置页提供一键测试按钮。

---

## 项目目录结构

```text
xhs-account-monitor/
├── config/
│   ├── config.example.json       # 公开配置模板
│   └── config.local.json         # 本地私有配置（含目标链接、Bark Key、QQ 授权码，已被 .gitignore 忽略）
├── docs/
│   ├── ARCHITECTURE.md           # 分层调度、多账号隔离、时间对比与数据流架构说明
│   └── images/                   # Web 控制台界面效果图
├── scripts/
│   ├── login.ts                  # 独立弹出浏览器扫码登录小红书
│   ├── run-reconcile.ts          # 手动触发指定日期的次日 0 点核对与汇总
│   └── self-test.ts              # 离线全链路自动化自检测试套件（7 大场景）
├── src/
│   ├── main.ts                   # 服务主入口
│   ├── collector/
│   │   └── xhs-collector.ts      # Playwright 采集器（API 拦截 + SSR 状态 + DOM 时间三合一）
│   ├── engine/
│   │   ├── diff-engine.ts        # 首次全量建档 & 删改/评论/头像/IP/资料对比引擎
│   │   ├── reconciler.ts         # 次日 0 点「昨天 HH:mm」核对与每日汇总引擎
│   │   └── scheduler.ts          # 三态分层调度器 + 实时倒计时校准 + 每日 00:02 自动汇总
│   ├── notify/
│   │   ├── bark.ts               # Bark 手机通知通道
│   │   ├── qq-mail.ts            # QQ 邮箱原生 SMTPS 通知通道
│   │   └── index.ts              # 多通道通知分发中心
│   ├── shared/
│   │   ├── paths.ts              # 统一目录路径管理
│   │   ├── types.ts              # 全局 TypeScript 类型定义
│   │   └── utils.ts              # 配置读写、时间解析、图片去重与数据清洗工具
│   ├── storage/
│   │   ├── database.ts           # 基于 Node 24 内置 node:sqlite 的多账号隔离持久化层
│   │   └── file-store.ts         # 本地图片归档、图文 JSON 备份、JSONL 流水与日报输出
│   └── web/
│       ├── server.ts             # Hono 本地 Web API 与静态图片服务
│       └── ui.ts                 # Linear 风格本地可视化管理控制台
├── storage/                      # 本地数据目录（仅保留 .gitkeep 骨架，真实数据均被 .gitignore 忽略）
│   ├── browser-profile/          # 独立 Chrome 登录态缓存
│   ├── database/                 # SQLite 本地数据库 (monitor.db)
│   ├── logs/                     # 每日事件、对比、IP 与资料变更 JSONL 流水
│   ├── photos/                   # 永久备份的高清图片库（avatars / notes / comments）
│   └── reports/                  # 每日汇总与时间核对报告 (.md / .json)
├── .gitattributes                # 跨平台换行符规范
├── .gitignore                    # Git 忽略规则（严格排除依赖、隐私配置与本地抓取数据）
├── LICENSE                       # MIT 开源许可证
├── package.json                  # 项目脚本与依赖定义
├── tsconfig.json                 # TypeScript 严格类型检查配置
├── 启动监控系统.bat               # Windows 双击一键启动脚本
└── 扫码登录小红书.bat             # Windows 双击一键扫码登录脚本
```

---

## 快速开始

### 环境要求
- **操作系统**：**Windows 10 / 11**（macOS / Linux 暂未适配）
- **Node.js `v24+`**（使用原生 TypeScript 执行与内置 `node:sqlite`）
- 本机安装有 **Google Chrome**（或 Microsoft Edge）

### 1. 安装依赖
```bash
npm install
```

### 2. 扫码登录小红书
双击运行 **`扫码登录小红书.bat`**（或执行 `npm run login`），在弹出的浏览器窗口中使用小红书 App 扫码登录，登录态会自动保存至 `storage/browser-profile/`。

### 3. 启动系统并配置目标
1. 双击运行 **`启动监控系统.bat`**（或执行 `npm start`）。
2. 浏览器访问 **`http://localhost:3000`**，进入 **「设置」** 页。
3. 填写目标账号的小红书个人主页完整链接，按需配置 **Bark** 或 **QQ 邮箱 + 16 位 SMTP 授权码** 并点击保存。
4. 系统将自动完成首次全量备份，并按三态分层策略开始定时监控。

---

## 常用命令

| 命令 | 说明 |
| :--- | :--- |
| `npm start` | 启动监控调度器与本地 `http://localhost:3000` 控制台 |
| `npm run dev` | 开发模式（监听源码变更自动重启） |
| `npm run login` | 打开独立浏览器窗口扫码登录小红书 |
| `npm run reconcile` | 手动触发昨天内容的「昨天 HH:mm」核对与每日汇总 |
| `npm test` | 运行离线全链路自检测试（7 大核心场景） |
| `npm run typecheck` | 运行 TypeScript 严格类型检查 |

---

## 开源与安全提示

- 本项目已通过 `.gitignore` 忽略 `node_modules/`、`config/config.local.json` 以及 `storage/` 下的真实数据库、图片、日志、报告和浏览器登录态。
- 推送到公开仓库前，建议确认 `config/config.local.json` 与 `storage/database/monitor.db` 未被纳入提交列表。
- 本项目仅供个人学习与合规研究使用，请合理设置检查频率并遵守目标平台服务条款。

## License

[MIT](./LICENSE)
