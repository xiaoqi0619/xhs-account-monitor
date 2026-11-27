import fs from 'node:fs';
import path from 'node:path';
import { Hono } from 'hono';
import type { MonitorScheduler } from '../engine/scheduler.ts';
import { PHOTOS_ROOT, STORAGE_ROOT } from '../shared/paths.ts';
import {
  extractUserIdFromProfileUrl,
  getLocalDateKey,
  getYesterdayDateKey,
  saveConfig,
} from '../shared/utils.ts';
import type { MonitorDatabase } from '../storage/database.ts';
import { renderDashboardHtml } from './ui.ts';

function getMimeType(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    default:
      return 'application/octet-stream';
  }
}

export function createWebApp(db: MonitorDatabase, scheduler: MonitorScheduler): Hono {
  const app = new Hono();

  // 首页可视化控制台
  app.get('/', (c) => {
    return c.html(renderDashboardHtml());
  });

  // 本地已备份的图片静态访问（即使小红书原帖已删除，本地控制台依旧可查看全部高清照片与头像）
  app.get('/photos/*', (c) => {
    const reqPath = c.req.path.replace(/^\/photos\/+/, '');
    const resolved = path.resolve(PHOTOS_ROOT, reqPath);
    if (!resolved.startsWith(path.resolve(PHOTOS_ROOT))) {
      return c.text('Forbidden', 403);
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return c.text('Not Found', 404);
    }
    const buf = fs.readFileSync(resolved);
    const mime = getMimeType(path.extname(resolved));
    return new Response(buf, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  });

  const getActiveUserId = (): string | undefined => {
    const cfg = scheduler.getConfig();
    const uidFromUrl = extractUserIdFromProfileUrl(cfg.targetProfileUrl);
    if (uidFromUrl) return uidFromUrl;
    return db.getLatestProfile()?.userId || undefined;
  };

  // 1. 综合状态概览 API
  app.get('/api/overview', (c) => {
    const status = scheduler.getStatus();
    const config = scheduler.getConfig();
    const activeUserId = getActiveUserId();
    const profile = activeUserId ? db.getLatestProfile(activeUserId) : null;
    const avatarHistory = activeUserId ? db.getAvatarHistory(activeUserId) : [];
    const ipHistory = activeUserId ? db.getIpHistory(activeUserId) : [];
    const profileFieldHistory = activeUserId ? db.getProfileFieldHistory(activeUserId) : [];
    const stats = activeUserId
      ? db.getArchiveStats(activeUserId)
      : {
          totalNotes: 0,
          activeNotes: 0,
          deletedNotes: 0,
          editedNotes: 0,
          baselineNotes: 0,
          totalComments: 0,
          activeComments: 0,
          deletedComments: 0,
          comparisonsCount: 0,
          reconciliationsCount: 0,
          ipHistoryCount: 0,
          ipChangeCount: 0,
          profileFieldHistoryCount: 0,
          profileFieldChangeCount: 0,
        };
    const recentEvents = activeUserId ? db.getRecentEvents(60, undefined, activeUserId) : [];
    return c.json({
      ok: true,
      storageRoot: STORAGE_ROOT,
      todayKey: getLocalDateKey(),
      yesterdayKey: getYesterdayDateKey(),
      status,
      config,
      profile,
      avatarHistory,
      ipHistory,
      profileFieldHistory,
      stats,
      recentEvents,
    });
  });

  // 1.5 IP 属地检测与本地变更历史 API
  app.get('/api/ip-history', (c) => {
    const userId = c.req.query('userId') || getActiveUserId() || undefined;
    const profile = userId ? db.getLatestProfile(userId) : null;
    const limit = Number(c.req.query('limit') || 100);
    const history = userId ? db.getIpHistory(userId, limit) : [];
    const latestProfileIp = userId ? db.getLatestIpRecord(userId, 'PROFILE') : null;
    const totalChanges = history.filter((item) => item.previousIp !== null).length;
    return c.json({
      ok: true,
      userId: userId || '',
      currentIp: latestProfileIp?.ipLocation || profile?.ipLocation || '',
      totalRecords: history.length,
      totalChanges,
      history,
    });
  });

  // 1.6 账号资料（名字 / 性别 / 个性签名）变更历史 API
  app.get('/api/profile-history', (c) => {
    const userId = c.req.query('userId') || getActiveUserId() || undefined;
    const profile = userId ? db.getLatestProfile(userId) : null;
    const rawField = (c.req.query('field') || '').toUpperCase();
    const field =
      rawField === 'NICKNAME' || rawField === 'GENDER' || rawField === 'BIO'
        ? rawField
        : undefined;
    const limit = Number(c.req.query('limit') || 100);
    const history = userId ? db.getProfileFieldHistory(userId, field, limit) : [];
    const totalChanges = history.filter((item) => item.oldValue !== null).length;
    return c.json({
      ok: true,
      userId: userId || '',
      current: {
        nickname: profile?.nickname || '',
        gender: profile?.gender || '',
        bio: profile?.desc || '',
      },
      totalRecords: history.length,
      totalChanges,
      history,
    });
  });

  // 2. 本地永久笔记存档列表 API（支持筛选 ALL / ACTIVE / DELETED / BASELINE）
  app.get('/api/notes', (c) => {
    const filter = c.req.query('filter') || 'ALL';
    const userId = getActiveUserId();
    let notes = userId ? db.getAllNotes(userId) : [];
    if (filter === 'DELETED') {
      notes = notes.filter((n) => n.status === 'DELETED' || n.status === 'SUSPECTED_DELETED');
    } else if (filter === 'EDITED') {
      notes = notes.filter((n) => Boolean(n.lastEditedTimeText) || n.editCount > 0);
    } else if (filter === 'ACTIVE') {
      notes = notes.filter((n) => n.status === 'ACTIVE');
    } else if (filter === 'BASELINE') {
      notes = notes.filter((n) => n.isBaseline);
    } else if (filter === 'NEW') {
      notes = notes.filter((n) => !n.isBaseline);
    }
    return c.json({ ok: true, notes });
  });

  // 单篇笔记详情与全部本地存档评论（含已删评论）及编辑历史
  app.get('/api/notes/:noteId', (c) => {
    const noteId = c.req.param('noteId');
    const note = db.getNote(noteId);
    if (!note) return c.json({ ok: false, error: '未找到该笔记本地存档' }, 404);
    const comments = db.getCommentsByNote(noteId);
    const revisions = db.getNoteRevisions(noteId);
    return c.json({ ok: true, note, comments, revisions });
  });

  // 3. 删改与新评本地时间对比记录 API
  app.get('/api/comparisons', (c) => {
    const compareType = c.req.query('type') || undefined;
    const dateKey = c.req.query('date') || undefined;
    const activeUserId = getActiveUserId();
    const records = activeUserId
      ? db.getComparisonRecords({
          userId: activeUserId,
          compareType: compareType === 'ALL' ? undefined : compareType,
          dateKey: dateKey || undefined,
          limit: 150,
        })
      : [];
    return c.json({ ok: true, records });
  });

  // 4. 次日0点汇总与时间对照报告 API
  app.get('/api/daily-report', (c) => {
    const dateKey = c.req.query('date') || getYesterdayDateKey();
    const activeUserId = getActiveUserId();
    const report = activeUserId ? db.getDailyReport(dateKey, activeUserId) : null;
    const availableDates = activeUserId ? db.listDailyReportDates(activeUserId) : [];
    const reconciliations = activeUserId ? db.getTimeReconciliations(dateKey, activeUserId) : [];
    return c.json({
      ok: true,
      dateKey,
      todayKey: getLocalDateKey(),
      yesterdayKey: getYesterdayDateKey(),
      report,
      reconciliations,
      availableDates,
    });
  });

  // 手动触发某天汇总与时间对照
  app.post('/api/daily-report/generate', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      dateKey?: string;
      refreshOnline?: boolean;
    };
    const targetDate = body.dateKey || getYesterdayDateKey();
    const res = await scheduler.triggerReconcileForDate(
      targetDate,
      Boolean(body.refreshOnline)
    );
    return c.json(res);
  });

  // 人工标记时间对照项已确认
  app.post('/api/reconciliations/:id/review', async (c) => {
    const id = Number(c.req.param('id'));
    const body = (await c.req.json().catch(() => ({}))) as { reviewNote?: string };
    db.markReconciliationReviewed(id, body.reviewNote || '已人工核对确认');
    return c.json({ ok: true });
  });

  // 5. 控制台操作 API（立即巡视、暂停/恢复、打开浏览器扫码登录、保存配置、测试Bark）
  app.post('/api/actions/run-now', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      fullScan?: boolean;
    };
    const isFull = Boolean(body.fullScan);
    void scheduler.runOnce(isFull ? 'FULL_SCAN' : undefined);
    return c.json({
      ok: true,
      message: isFull ? '已开始检查全部笔记' : '已开始检查主页动态',
    });
  });

  app.post('/api/actions/pause', (c) => {
    scheduler.pauseManual();
    return c.json({ ok: true });
  });

  app.post('/api/actions/resume', (c) => {
    scheduler.resume();
    return c.json({ ok: true });
  });

  app.post('/api/actions/login', async (c) => {
    void scheduler.openInteractiveLogin();
    return c.json({
      ok: true,
      message: '正在弹出 Chrome 浏览器，请在窗口中扫码登录小红书（登录完成后会自动保存会话）',
    });
  });

  app.post('/api/actions/test-bark', async (c) => {
    const res = await scheduler.sendTestNotification();
    return c.json(res);
  });

  app.post('/api/actions/test-qq-mail', async (c) => {
    const res = await scheduler.sendTestQqMail();
    return c.json(res);
  });

  app.post('/api/config', async (c) => {
    const partial = await c.req.json();
    const updated = saveConfig(partial);
    scheduler.reloadConfig(updated);
    return c.json({ ok: true, config: updated });
  });

  return app;
}
