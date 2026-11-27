import { XhsCollector } from '../collector/xhs-collector.ts';
import { NotificationHub } from '../notify/index.ts';
import type {
  AppConfig,
  CollectMode,
  DailyAnalyticsReport,
  RuntimeStatus,
  SchedulerMode,
} from '../shared/types.ts';
import {
  extractUserIdFromProfileUrl,
  getLocalDateKey,
  getYesterdayDateKey,
  loadConfig,
  nowIso,
} from '../shared/utils.ts';
import type { MonitorDatabase } from '../storage/database.ts';
import { appendEventLogFile } from '../storage/file-store.ts';
import { processCollectResult } from './diff-engine.ts';
import {
  collectNoteIdsNeedingMidnightRefresh,
  runMidnightReconcileAndDailySummary,
} from './reconciler.ts';

export class MonitorScheduler {
  private config: AppConfig;
  private db: MonitorDatabase;
  private collector: XhsCollector;
  private notifier: NotificationHub;

  private mode: SchedulerMode = 'IDLE';
  private previousModeBeforeRun: 'NORMAL' | 'BURST' = 'NORMAL';
  private burstRemaining = 0;
  private isRunningNow = false;
  private progressText = '等待启动...';
  private lastRunAt: string | null = null;
  private lastSuccessAt: string | null = null;
  private nextRunAt: string | null = null;
  private nextRunKind: CollectMode | null = null;
  private nextFullScanAtMs: number | null = null;
  private nextRunDelayMs: number | null = null;
  private recentChangedNoteIds: string[] = [];
  private lastError: string | null = null;
  private totalRuns = 0;
  private lastChangesCount = 0;

  private patrolTimer: ReturnType<typeof setTimeout> | null = null;
  private countdownWatchdogTimer: ReturnType<typeof setInterval> | null = null;
  private midnightTickTimer: ReturnType<typeof setInterval> | null = null;
  private reconcilingLock = false;

  constructor(db: MonitorDatabase, initialConfig?: AppConfig) {
    this.db = db;
    this.config = initialConfig || loadConfig();
    this.collector = new XhsCollector(this.config);
    this.notifier = new NotificationHub(this.config);
  }

  getConfig(): AppConfig {
    return this.config;
  }

  reloadConfig(newConfig: AppConfig): void {
    const oldUrl = this.config.targetProfileUrl;
    const intervalChanged =
      this.config.lightCheckMinMinutes !== newConfig.lightCheckMinMinutes ||
      this.config.lightCheckMaxMinutes !== newConfig.lightCheckMaxMinutes ||
      this.config.fullScanMinMinutes !== newConfig.fullScanMinMinutes ||
      this.config.fullScanMaxMinutes !== newConfig.fullScanMaxMinutes ||
      this.config.burstMinMinutes !== newConfig.burstMinMinutes ||
      this.config.burstMaxMinutes !== newConfig.burstMaxMinutes;
    this.config = newConfig;
    this.collector.updateConfig(newConfig);
    this.notifier = new NotificationHub(newConfig);

    if (this.config.targetProfileUrl && this.mode === 'IDLE') {
      this.start();
    } else if (oldUrl !== newConfig.targetProfileUrl && newConfig.targetProfileUrl && !this.isRunningNow) {
      this.nextFullScanAtMs = null;
      this.recentChangedNoteIds = [];
      this.scheduleNext(1500);
    } else if (
      intervalChanged &&
      !this.isRunningNow &&
      (this.mode === 'NORMAL' || this.mode === 'BURST')
    ) {
      this.nextFullScanAtMs = this.computeNextFullScanMs();
      this.scheduleNext();
    }
  }

  private randomRangeMinutesMs(minMinutes: number, maxMinutes: number): number {
    const lo = Math.max(1, Math.min(minMinutes, maxMinutes));
    const hi = Math.max(lo, maxMinutes);
    const minMs = Math.round(lo * 60_000);
    const maxMs = Math.round(hi * 60_000);
    const baseMs =
      maxMs > minMs ? minMs + Math.floor(Math.random() * (maxMs - minMs + 1)) : minMs;
    const jitterMs =
      Math.floor(Math.random() * Math.max(0, this.config.randomJitterSeconds)) * 1000;
    return baseMs + jitterMs;
  }

  private computeNextFullScanMs(): number {
    return (
      Date.now() +
      this.randomRangeMinutesMs(this.config.fullScanMinMinutes, this.config.fullScanMaxMinutes)
    );
  }

  start(): void {
    if (!this.midnightTickTimer) {
      // 每 20 秒检查一次是否到达每日自动汇总时间
      this.midnightTickTimer = setInterval(() => {
        void this.checkMidnightSummaryWindow();
      }, 20_000);
    }
    if (!this.countdownWatchdogTimer) {
      // 每 1 秒校准倒计时，防止电脑休眠/唤醒造成 setTimeout 偏移，确保时间一到立刻启动
      this.countdownWatchdogTimer = setInterval(() => {
        if (
          !this.isRunningNow &&
          this.nextRunAt &&
          (this.mode === 'NORMAL' || this.mode === 'BURST') &&
          Date.now() >= new Date(this.nextRunAt).getTime()
        ) {
          void this.runOnce(this.nextRunKind || undefined);
        }
      }, 1000);
    }

    if (!this.config.targetProfileUrl) {
      this.mode = 'IDLE';
      this.progressText = '尚未填写监控目标链接';
      this.nextRunAt = null;
      this.nextRunKind = null;
      this.nextRunDelayMs = null;
      return;
    }

    this.mode = 'NORMAL';
    this.progressText = '准备就绪，即将开始检查...';
    const lastFull = this.db.getMeta('last_full_audit_at');
    if (lastFull) {
      const elapsed = Date.now() - new Date(lastFull).getTime();
      const targetFullGap = this.randomRangeMinutesMs(
        this.config.fullScanMinMinutes,
        this.config.fullScanMaxMinutes
      );
      this.nextFullScanAtMs =
        elapsed >= targetFullGap ? Date.now() + 1500 : new Date(lastFull).getTime() + targetFullGap;
    } else {
      this.nextFullScanAtMs = this.computeNextFullScanMs();
    }
    this.scheduleNext(1500);
  }

  stop(): void {
    if (this.patrolTimer) {
      clearTimeout(this.patrolTimer);
      this.patrolTimer = null;
    }
    if (this.countdownWatchdogTimer) {
      clearInterval(this.countdownWatchdogTimer);
      this.countdownWatchdogTimer = null;
    }
    if (this.midnightTickTimer) {
      clearInterval(this.midnightTickTimer);
      this.midnightTickTimer = null;
    }
    this.nextRunAt = null;
    this.nextRunKind = null;
    this.nextRunDelayMs = null;
  }

  pauseManual(): void {
    if (this.patrolTimer) {
      clearTimeout(this.patrolTimer);
      this.patrolTimer = null;
    }
    this.mode = 'PAUSED_MANUAL';
    this.nextRunAt = null;
    this.nextRunKind = null;
    this.nextRunDelayMs = null;
    this.progressText = '已暂停定时监控';
  }

  resume(): void {
    if (!this.config.targetProfileUrl) {
      this.mode = 'IDLE';
      return;
    }
    this.mode = this.burstRemaining > 0 ? 'BURST' : 'NORMAL';
    this.lastError = null;
    this.progressText = '已恢复监控，即将开始检查...';
    this.scheduleNext(1000);
  }

  getStatus(): RuntimeStatus {
    const targetUid =
      extractUserIdFromProfileUrl(this.config.targetProfileUrl) ||
      this.db.getLatestProfile()?.userId ||
      null;
    const isBaselineDone = this.db.isBaselineCompletedForUser(targetUid);
    return {
      mode: this.mode,
      previousModeBeforeRun: this.previousModeBeforeRun,
      burstRemaining: this.burstRemaining,
      isRunningNow: this.isRunningNow,
      progressText: this.progressText,
      isBaselineDone,
      baselineCompletedAt: this.db.getMeta('baseline_completed_at'),
      lastRunAt: this.lastRunAt,
      lastSuccessAt: this.lastSuccessAt,
      nextRunAt: this.nextRunAt,
      nextRunKind: this.nextRunKind,
      nextFullScanAt: this.nextFullScanAtMs ? new Date(this.nextFullScanAtMs).toISOString() : null,
      nextRunDelayMs: this.nextRunDelayMs,
      serverNow: nowIso(),
      nextMidnightSummaryTime: this.config.nextDaySummaryTime,
      lastReconciledDate: this.db.getMeta('last_reconciled_date'),
      lastError: this.lastError,
      totalRuns: this.totalRuns,
      lastChangesCount: this.lastChangesCount,
    };
  }

  async openInteractiveLogin(): Promise<{ ok: boolean; message: string }> {
    const wasPausedAuth = this.mode === 'PAUSED_AUTH';
    const res = await this.collector.openLoginSession(5, (msg) => {
      this.progressText = msg;
    });
    if (res.ok && wasPausedAuth && this.config.targetProfileUrl) {
      this.resume();
    }
    return res;
  }

  async sendTestNotification(): Promise<{ ok: boolean; errors: string[] }> {
    return this.notifier.sendBarkPayload({
      title: '【小红书监控系统】Bark 推送连通成功',
      body: `当前时间：${new Date().toLocaleString('zh-CN')}，删帖对比与每日汇总通知已就绪！`,
      level: 'timeSensitive',
      url: `http://localhost:${this.config.port}/`,
    });
  }

  async sendTestQqMail(): Promise<{ ok: boolean; errors: string[] }> {
    return this.notifier.sendQqMailPayload({
      title: '【小红书监控系统】QQ 邮箱推送连通成功',
      body: `当前时间：${new Date().toLocaleString('zh-CN')}，后续监控变动、删帖对比与每日汇总将同步发送到你的 QQ 邮箱！`,
      level: 'timeSensitive',
      url: `http://localhost:${this.config.port}/`,
    });
  }

  private scheduleNext(overrideMs?: number): void {
    if (this.patrolTimer) {
      clearTimeout(this.patrolTimer);
      this.patrolTimer = null;
    }
    if (this.mode === 'PAUSED_MANUAL' || this.mode === 'PAUSED_AUTH' || this.mode === 'IDLE') {
      this.nextRunAt = null;
      this.nextRunKind = null;
      this.nextRunDelayMs = null;
      return;
    }

    const targetUid =
      extractUserIdFromProfileUrl(this.config.targetProfileUrl) ||
      this.db.getLatestProfile()?.userId ||
      null;
    const needBaseline = !this.db.isBaselineCompletedForUser(targetUid);

    let delayMs: number;
    let kind: CollectMode;

    if (overrideMs !== undefined) {
      delayMs = overrideMs;
      kind = needBaseline
        ? 'BASELINE'
        : this.mode === 'BURST'
        ? 'BURST_CHECK'
        : 'PROFILE_LIGHT';
    } else if (needBaseline) {
      delayMs = 1500;
      kind = 'BASELINE';
    } else if (this.mode === 'BURST') {
      delayMs = this.randomRangeMinutesMs(this.config.burstMinMinutes, this.config.burstMaxMinutes);
      kind = 'BURST_CHECK';
    } else {
      const nowMs = Date.now();
      if (!this.nextFullScanAtMs) {
        this.nextFullScanAtMs = this.computeNextFullScanMs();
      }
      const lightDelayMs = this.randomRangeMinutesMs(
        this.config.lightCheckMinMinutes,
        this.config.lightCheckMaxMinutes
      );
      const lightTargetMs = nowMs + lightDelayMs;
      // 若距离下一次全量检查已到点或不足 2 分钟，直接安排全量全部笔记检查，避免连跑两轮
      if (this.nextFullScanAtMs <= lightTargetMs + 120_000) {
        delayMs = Math.max(2000, this.nextFullScanAtMs - nowMs);
        kind = 'FULL_SCAN';
      } else {
        delayMs = lightDelayMs;
        kind = 'PROFILE_LIGHT';
      }
    }

    this.nextRunKind = kind;
    this.nextRunDelayMs = delayMs;
    this.nextRunAt = new Date(Date.now() + delayMs).toISOString();
    this.patrolTimer = setTimeout(() => {
      void this.runOnce(kind);
    }, delayMs);
  }

  /**
   * 执行单轮巡视（自动判定是否属于首次运行全量存档 BASELINE / 定期全量对账 FULL_AUDIT / 常规巡视 PATROL）
   */
  async runOnce(forceMode?: CollectMode, priorityNoteIds?: string[]): Promise<{
    ok: boolean;
    message: string;
  }> {
    if (this.isRunningNow) {
      return { ok: false, message: '当前已有巡视任务正在执行中' };
    }
    if (!this.config.targetProfileUrl) {
      return { ok: false, message: '请先在设置中填写目标小红书主页链接' };
    }

    if (this.patrolTimer) {
      clearTimeout(this.patrolTimer);
      this.patrolTimer = null;
    }

    const startedAt = nowIso();
    this.isRunningNow = true;
    this.lastRunAt = startedAt;
    this.nextRunAt = null;
    this.nextRunKind = null;
    this.nextRunDelayMs = null;
    if (this.mode === 'BURST' || this.mode === 'NORMAL') {
      this.previousModeBeforeRun = this.mode;
    }
    this.mode = 'RUNNING';

    try {
      const targetUid =
        extractUserIdFromProfileUrl(this.config.targetProfileUrl) ||
        this.db.getLatestProfile()?.userId ||
        null;
      const isFirstRun = !this.db.isBaselineCompletedForUser(targetUid);

      const collectMode: CollectMode =
        forceMode ||
        (isFirstRun
          ? 'BASELINE'
          : this.previousModeBeforeRun === 'BURST'
          ? 'BURST_CHECK'
          : 'PROFILE_LIGHT');

      const storedActiveNotes = targetUid
        ? this.db.getAllNotes(targetUid).filter((n) => n.status !== 'DELETED')
        : [];
      const knownNotes = storedActiveNotes.map((n) => n.noteId);
      const knownNoteSnapshots: Record<string, { title: string; likedNum: number }> = {};
      for (const n of storedActiveNotes) {
        knownNoteSnapshots[n.noteId] = { title: n.title, likedNum: n.likedNum };
      }

      const suspectedIds = storedActiveNotes
        .filter((n) => n.status === 'SUSPECTED_DELETED')
        .map((n) => n.noteId);

      const latestProf = targetUid ? this.db.getLatestProfile(targetUid) : null;

      const mergedPriorityIds = Array.from(
        new Set([
          ...(priorityNoteIds || []),
          ...suspectedIds,
          ...(collectMode === 'BURST_CHECK' ? this.recentChangedNoteIds : []),
        ])
      );

      this.progressText =
        collectMode === 'BASELINE'
          ? '首次备份：正在保存全部笔记、图片与评论...'
          : collectMode === 'FULL_SCAN'
          ? '正在检查全部笔记详情与评论...'
          : collectMode === 'BURST_CHECK'
          ? '高频监控：正在检查主页、变动帖与最新笔记...'
          : collectMode === 'MIDNIGHT_RECONCILE'
          ? '正在核对昨天发布内容的精确时间...'
          : '正在检查主页动态...';

      const collectRes = await this.collector.collect({
        mode: collectMode,
        knownActiveNoteIds: knownNotes,
        knownNoteSnapshots,
        knownProfileInteractionNum: latestProf ? latestProf.interactionNum : null,
        priorityInspectNoteIds: mergedPriorityIds,
        burstExtraRecentNotesCount: this.config.burstExtraRecentNotes,
        knownUserRedIds: this.db.getAllCachedUserRedIds(),
        onProgress: (msg) => {
          this.progressText = msg;
        },
      });

      if (collectRes.status === 'NEEDS_AUTH_OR_VERIFY') {
        this.mode = 'PAUSED_AUTH';
        this.lastError = collectRes.reason || '需要扫码登录或完成人工安全验证';
        this.progressText = `已挂起：${this.lastError}`;
        this.nextRunAt = null;

        this.db.recordPatrolRun({
          runType: collectMode,
          status: 'NEEDS_AUTH',
          notesScanned: 0,
          commentsScanned: 0,
          eventsCount: 1,
          errorMsg: this.lastError,
          startedAt,
        });

        const alertEv = this.db.insertEvent({
          eventType: 'SYSTEM_ALERT',
          title: '【监控需登录/验证确认】小红书监控已自动挂起',
          body: this.lastError,
          level: 'critical',
          shouldPush: true,
          triggersBurst: false,
          isActivity: false,
          createdAt: nowIso(),
        });
        appendEventLogFile(getLocalDateKey(), alertEv as unknown as Record<string, unknown>);
        await this.notifier.notifyEvents([alertEv], this.db);
        return { ok: false, message: this.lastError };
      }

      if (collectRes.status !== 'OK') {
        this.lastError = collectRes.reason || '采集异常';
        this.mode = this.previousModeBeforeRun;
        this.progressText = `本轮异常（将在下一周期自动重试）：${this.lastError}`;
        this.db.recordPatrolRun({
          runType: collectMode,
          status: 'ERROR',
          notesScanned: 0,
          commentsScanned: 0,
          eventsCount: 0,
          errorMsg: this.lastError,
          startedAt,
        });
        this.scheduleNext();
        return { ok: false, message: this.lastError };
      }

      // 执行全量存档或删改/评论对比
      this.progressText = '正在保存照片并对比本地历史存档数据...';
      const summary = await processCollectResult(collectRes, this.db, this.config);

      if (collectMode === 'BASELINE' || collectMode === 'FULL_SCAN') {
        this.db.setMeta('last_full_audit_at', nowIso());
        this.nextFullScanAtMs = this.computeNextFullScanMs();
      }

      await this.notifier.notifyEvents(summary.events, this.db);

      this.totalRuns++;
      this.lastSuccessAt = nowIso();
      this.lastError = null;
      this.lastChangesCount = summary.events.length;

      this.db.recordPatrolRun({
        runType: collectMode,
        status: 'OK',
        notesScanned: summary.notesProcessed,
        commentsScanned: summary.commentsProcessed,
        eventsCount: summary.events.length,
        startedAt,
      });

      // 三态分层调度：发现有效变动切入高频追踪（连续 2 轮无新动静恢复常态）
      const burstEvents = summary.events.filter((e) => e.triggersBurst);
      if (burstEvents.length > 0) {
        const hitNoteIds = burstEvents
          .map((e) => e.noteId)
          .filter(
            (id): id is string =>
              typeof id === 'string' &&
              id.length > 0 &&
              !id.startsWith('ip_') &&
              !id.startsWith('avatar_') &&
              !id.startsWith('profile_')
          );
        this.recentChangedNoteIds = Array.from(
          new Set([...hitNoteIds, ...this.recentChangedNoteIds])
        ).slice(0, 12);
        this.mode = 'BURST';
        this.burstRemaining = this.config.burstQuietChecksToRecover;
      } else if (this.previousModeBeforeRun === 'BURST') {
        this.burstRemaining = Math.max(0, this.burstRemaining - 1);
        if (this.burstRemaining > 0) {
          this.mode = 'BURST';
        } else {
          this.mode = 'NORMAL';
          this.recentChangedNoteIds = [];
          if (!this.nextFullScanAtMs || this.nextFullScanAtMs < Date.now()) {
            this.nextFullScanAtMs = this.computeNextFullScanMs();
          }
        }
      } else {
        this.mode = 'NORMAL';
      }

      const modeDesc =
        collectMode === 'FULL_SCAN'
          ? '全部笔记检查'
          : collectMode === 'BURST_CHECK'
          ? `高频监控（剩余 ${this.burstRemaining} 轮）`
          : '主页检查';
      this.progressText = summary.isBaselineRun
        ? `首次备份完成：共保存 ${summary.notesProcessed} 篇笔记、${summary.commentsProcessed} 条评论`
        : `${modeDesc}完成（发现 ${summary.events.length} 项变动）`;

      this.scheduleNext();
      return { ok: true, message: this.progressText };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastError = msg;
      this.mode = this.previousModeBeforeRun;
      this.progressText = `运行出错：${msg}`;
      this.scheduleNext();
      return { ok: false, message: msg };
    } finally {
      this.isRunningNow = false;
    }
  }

  /**
   * 次日0点自动检测（如跨过 00:00 到达 00:02 时）：
   * 先对前一天所有笔记与评论重新抓取页面刷新出的「昨天 HH:mm」精确时间，再与当天本地记录时间做逐条对照并汇总！
   */
  private async checkMidnightSummaryWindow(): Promise<void> {
    if (this.reconcilingLock || this.isRunningNow) return;
    if (this.mode === 'PAUSED_AUTH' || this.mode === 'IDLE') return;

    const now = new Date();
    const curHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    if (curHHMM < this.config.nextDaySummaryTime) return;

    const yesterdayKey = getYesterdayDateKey(now);
    const lastReconciled = this.db.getMeta('last_reconciled_date');
    if (lastReconciled === yesterdayKey) return;

    // 检查昨天是否有监控记录（首次安装当天没有昨天记录则跳过空跑，直接标记）
    const hasYesterdayData =
      this.db.countPatrolRunsForDate(yesterdayKey) > 0 ||
      this.db.getNotesByFirstSeenDate(yesterdayKey, true).length > 0 ||
      this.db.getCommentsByFirstSeenDate(yesterdayKey, true).length > 0 ||
      this.db.getEventsForDate(yesterdayKey).length > 0;

    if (!hasYesterdayData) {
      this.db.setMeta('last_reconciled_date', yesterdayKey);
      return;
    }

    await this.triggerReconcileForDate(yesterdayKey, true);
  }

  /**
   * 触发指定日期的汇总与时间对照（支持先联网刷新小红书「昨天 HH:mm」精确时间）
   */
  async triggerReconcileForDate(
    targetDateKey: string,
    refreshOnlineFirst = true
  ): Promise<{ ok: boolean; report?: DailyAnalyticsReport; message: string }> {
    if (this.reconcilingLock) {
      return { ok: false, message: '正在执行次日时间对照与汇总，请稍候' };
    }
    this.reconcilingLock = true;

    try {
      const needRefreshIds = collectNoteIdsNeedingMidnightRefresh(this.db, targetDateKey);
      if (
        refreshOnlineFirst &&
        this.config.targetProfileUrl &&
        needRefreshIds.length > 0 &&
        !this.isRunningNow
      ) {
        this.progressText = `次日0点复核：正在打开昨日 ${needRefreshIds.length} 篇相关笔记获取「昨天 HH:mm」具体时间...`;
        await this.runOnce('MIDNIGHT_RECONCILE', needRefreshIds);
      }

      const isNextDay = getLocalDateKey() > targetDateKey;
      const { report, events } = runMidnightReconcileAndDailySummary(
        this.db,
        this.config,
        targetDateKey,
        { isNextDayVerified: isNextDay }
      );

      await this.notifier.notifyEvents(events, this.db);
      return {
        ok: true,
        report,
        message: `${targetDateKey} 汇总与时间对照已完成（报告已保存至 ${report.markdownReportPath}）`,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this.reconcilingLock = false;
    }
  }
}
