# 系统架构与核心机制说明

## 1. 三态分层调度与评论者缓存策略

为降低对目标平台的无效请求频率、贴近正常浏览节奏，调度器（`src/engine/scheduler.ts`）与采集器（`src/collector/xhs-collector.ts`）采用 **三态分层检查**：

| 模式 | 默认间隔 | 采集范围 | 切换规则 |
| :--- | :--- | :--- | :--- |
| **轻量主页模式 (`PROFILE_LIGHT`)** | 随机 15–20 分钟 | 仅刷目标主页 1 页（监测名字/性别/签名/头像/IP、关注粉丝总赞藏、新帖、删帖、标题与点赞变动）；若发现某篇变动，当轮仅深入查变动帖；若总赞藏变了但各贴点赞未变则自动升级检查全部笔记 | 常态默认模式 |
| **定期全部笔记 (`FULL_SCAN`)** | 随机 50–55 分钟 | 完整检查全部笔记详情、评论列表与编辑时间 | 到达定期全量时刻，或手动点击「检查全部笔记」 |
| **高频追踪模式 (`BURST_CHECK`)** | 随机 5–10 分钟 | 主页 + 变动帖 + 除变动帖外最新 N 篇（默认 4 篇） | 检测到监控范围内的有效变动时切入；连续 2 轮无新变动自动恢复常态 |

- **评论者小红书号防重查缓存**：每轮采集前，调度器从 SQLite 读取全量 `user_red_id_cache`（含已查询到的小红书号与已标记 `UNKNOWN` 的账号）传入采集器。本地已缓存的评论者绝不再访问其个人主页，仅对全新评论者按单轮上限补充查询并回写缓存。
- **短页面与 0→1 篇笔记防护**：针对作品数极少（0–1 篇）的账号主页，打开页面后主动等待作品列表接口、笔记卡片或空态提示完成渲染，并在总获赞非零且未收到作品接口时拒绝锁定 0 篇空基线；同时轻量模式下从 0 篇变为 1 篇时会自动进入详情页完成完整归档。
- **建档失败退避重试**：若首次建档遇到浏览器占用或网络抖动，调度器按 15 秒 / 60 秒退避重试，避免短间隔连续刷屏。

---

## 2. 多账号数据隔离机制

虽然系统每次专注监控当前配置的目标账号，但本地 SQLite 数据库支持无损切换并长期保留多个历史监控账号的独立存档：

- **全表按 `user_id` 分账**：`profile_snapshots`、`notes`、`events`、`comparison_records`、`time_reconciliations`、`daily_reports`（`(user_id, date_key)` 复合主键）、`patrol_runs`、`avatar_history`、`ip_history`、`profile_field_history` 全部按目标账号 `user_id` 隔离查询与统计，评论通过所属 `notes.user_id` 关联隔离。
- **按账号独立状态键**：`kv_meta` 中的建档完成时间（`baseline_completed_at:<uid>`）、上次全量时间（`last_full_audit_at:<uid>`）与上次汇总日期（`last_reconciled_date:<uid>`）均按账号独立存储。
- **切号无缝衔接**：切换目标链接时立即重置高频队列与前端缓存，新账号首采前严格归零展示；日后切回旧账号时自动恢复原有全部备份与建档状态，无需重复建档。

---

## 3. 「首次全量备份 + 次日 0 点时间核对 + 本地时间锁定」

小红书网页端的时间展示遵循以下阶梯规则：

| 发布后阶段 | 小红书页面展示格式 | 本系统应对策略 |
| :--- | :--- | :--- |
| **发布当天（Day 0）** | `刚刚`、`15分钟前`、`3小时前` | 先记录 `first_seen_at`（当天本地首次捕获时间）、底层时间戳及页面相对时间文本。 |
| **次日跨 0 点后（Day 1）** | **`昨天 21:36`**（或 `编辑于 昨天 22:10`） | **黄金精确窗口**。每天 `00:02` 自动重访昨日相关笔记与评论，抓取精确到分钟的时间，永久回写锁定到 `verified_publish_ms` / `verified_time_text`（以及编辑后的 `last_edited_at_ms` / `last_edited_time_text`），并与当天本地记录时间对照，偏差超过阈值（默认 40 分钟）时标黄提醒。 |
| **超过 2 天后（Day 2+）** | `11-23` 或 `2025-10-08`（不再显示 `HH:mm`） | 页面时分消失，但本地 SQLite 已永久锁定精确时间。后续即使老笔记被删除、被编辑或出现新评论，系统仍能调出精确的原始时间进行对比。 |

---

## 4. 删除时间推算与本地归档流水

每次巡视确认某篇笔记或某条评论存活时，都会刷新其 `last_seen_at`（最后确认存活时间）。当在 `detected_at` 确认其删除/不可见时：

- **最早可能删除时刻**：`T_start = last_seen_at`
- **最晚确认删除时刻**：`T_end = detected_at`
- **大概删除中位时间**：`T_mid = (T_start + T_end) / 2`
- **误差半径**：`± (T_end - T_start) / 2`（轻量主页期约 `±7.5–10 分钟`，高频追踪期约 `±2.5–5 分钟`）
- **存活总时长**：`T_mid - 笔记原始发布时间`

所有变动证据同步持久化到以下位置：
1. SQLite 数据库 `storage/database/monitor.db`（`notes`、`note_revisions`、`comments`、`comparison_records`、`ip_history`、`profile_field_history`、`avatar_history`、`time_reconciliations`、`daily_reports`、`events` 等表）
2. 本地图片备份 `storage/photos/{avatars,notes,comments}/` 及每篇笔记的 `笔记图文信息备份.json`
3. JSONL 流水日志 `storage/logs/{events,comparisons,ip-changes,profile-changes}-YYYY-MM-DD.jsonl`
4. 每日汇总报告 `storage/reports/daily-report-YYYY-MM-DD.{md,json}`

---

## 5. 多通道通知分发

`src/notify/index.ts` 的 `NotificationHub` 统一管理已启用的推送通道并按顺序分发提醒：
- **Bark (`src/notify/bark.ts`)**：通过 HTTP JSON 接口向 iOS 设备推送实时通知与控制台跳转链接。
- **QQ 邮箱 (`src/notify/qq-mail.ts`)**：基于 Node.js 原生 `node:tls` 直连 `smtp.qq.com:465`（SMTPS + `AUTH LOGIN`），零第三方依赖发送 UTF-8 HTML 通知邮件。
