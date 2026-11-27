import type {
  AppConfig,
  DailyAnalyticsReport,
  MonitorEvent,
  ReconciliationStatus,
  StoredCommentRow,
  StoredNoteRow,
  TimeReconciliationItem,
} from '../shared/types.ts';
import {
  formatDateTime,
  formatNicknameWithRedId,
  formatSignedInt,
  getLocalDateKey,
  getLocalDayBoundsIso,
  nowIso,
  parseXhsRenderedTimeText,
  truncateText,
} from '../shared/utils.ts';
import type { MonitorDatabase } from '../storage/database.ts';
import { appendEventLogFile, writeDailyReportFiles } from '../storage/file-store.ts';
import { formatStoredNotePublishTime } from './diff-engine.ts';

function isSameDayRelativeText(txt: string): boolean {
  return /(刚刚|分钟前|小时前|今天)/.test(txt || '');
}

/**
 * 找出目标日期（如昨天）所有需要在次日0点进行「昨天 HH:mm」具体时间对照的笔记 ID 集合
 * 供调度器在次日0点优先进详情页刷新最新时间文本
 */
export function collectNoteIdsNeedingMidnightRefresh(
  db: MonitorDatabase,
  targetDateKey: string
): string[] {
  const { startMs, endMs } = getLocalDayBoundsIso(targetDateKey);
  const noteIdSet = new Set<string>();

  // 1. 当天首次记录的所有笔记（含首次运行当天刚发的相对时间笔记）
  const dayNotes = db.getNotesByFirstSeenDate(targetDateKey, true);
  for (const n of dayNotes) {
    if (n.status === 'DELETED') continue;
    const pubInDay =
      n.publishedAt !== null && n.publishedAt >= startMs && n.publishedAt <= endMs;
    if (!n.isBaseline || pubInDay || isSameDayRelativeText(n.firstRenderedTimeText)) {
      noteIdSet.add(n.noteId);
    }
  }

  // 2. 当天出现新评论的所有所属笔记
  const dayComments = db.getCommentsByFirstSeenDate(targetDateKey, true);
  for (const c of dayComments) {
    const createdInDay =
      c.createdAt !== null && c.createdAt >= startMs && c.createdAt <= endMs;
    if (!c.isBaseline || createdInDay || isSameDayRelativeText(c.firstRenderedTimeText)) {
      const parent = db.getNote(c.noteId);
      if (parent && parent.status !== 'DELETED') {
        noteIdSet.add(c.noteId);
      }
    }
  }

  // 3. 当天发生过编辑的笔记（次日0点可刷新抓取精确「编辑于 昨天 HH:mm」）
  for (const editedId of db.getEditedNoteIdsForDate(targetDateKey)) {
    const editedNote = db.getNote(editedId);
    if (editedNote && editedNote.status !== 'DELETED') {
      noteIdSet.add(editedId);
    }
  }

  return Array.from(noteIdSet);
}

/**
 * 次日0点核心汇总与时间复核引擎：
 * 1. 利用小红书次日跨0点后显示前一天「昨天 HH:mm」具体时间的机制，复核前一天所有笔记和评论的精确发布时间
 * 2. 将复核到的精确时间永久回写锁入本地 SQLite 数据库（解决2天后小红书前端不再显示具体时分的问题！）
 * 3. 与当天本地监控记录时间、当天相对时间推算值逐条对照，计算捕获延迟与误差
 * 4. 生成昨日全天汇总报告（含删改对比、新评时间对比、次日0点时间对照表）并输出 Markdown 文件
 */
export function runMidnightReconcileAndDailySummary(
  db: MonitorDatabase,
  config: AppConfig,
  targetDateKey: string,
  opts?: {
    isNextDayVerified?: boolean;
    overrideCheckNowIso?: string;
  }
): {
  report: DailyAnalyticsReport;
  events: MonitorEvent[];
} {
  const checkedAt = opts?.overrideCheckNowIso || nowIso();
  const checkedNowMs = new Date(checkedAt).getTime();
  const isNextDayVerified = opts?.isNextDayVerified ?? getLocalDateKey(checkedAt) > targetDateKey;
  const { startMs, endMs } = getLocalDayBoundsIso(targetDateKey);

  // 筛选昨日发布/捕获的笔记与评论（兼顾首次运行当天发布的动态）
  const candidateNotes = db.getNotesByFirstSeenDate(targetDateKey, true).filter((n) => {
    const pubInDay = n.publishedAt !== null && n.publishedAt >= startMs && n.publishedAt <= endMs;
    return !n.isBaseline || pubInDay || isSameDayRelativeText(n.firstRenderedTimeText);
  });

  const candidateComments = db.getCommentsByFirstSeenDate(targetDateKey, true).filter((c) => {
    const createdInDay =
      c.createdAt !== null && c.createdAt >= startMs && c.createdAt <= endMs;
    return !c.isBaseline || createdInDay || isSameDayRelativeText(c.firstRenderedTimeText);
  });

  const reconciliations: TimeReconciliationItem[] = [];

  // ==================== A. 对照昨日笔记发布时间 ====================
  for (const note of candidateNotes) {
    const item = reconcileNoteItem(
      note,
      targetDateKey,
      checkedAt,
      checkedNowMs,
      config.timeDiffReviewThresholdMinutes,
      db
    );
    db.upsertTimeReconciliation(item);
    reconciliations.push(item);
  }

  // ==================== B. 对照昨日评论发布时间 ====================
  for (const comment of candidateComments) {
    const parentNote = db.getNote(comment.noteId);
    const item = reconcileCommentItem(
      comment,
      parentNote,
      targetDateKey,
      checkedAt,
      checkedNowMs,
      config.timeDiffReviewThresholdMinutes,
      db
    );
    db.upsertTimeReconciliation(item);
    reconciliations.push(item);
  }

  const allReconciliations = db.getTimeReconciliations(targetDateKey);
  const needsReviewCount = allReconciliations.filter((r) => r.status === 'NEEDS_REVIEW').length;
  const matchedCount = allReconciliations.filter(
    (r) => r.status === 'MATCHED' || r.status === 'REVIEWED_OK'
  ).length;

  // ==================== C. 汇总昨日全天动态与对比记录 ====================
  const latestProfile = db.getLatestProfile();
  const userId = latestProfile?.userId || '';
  const bounds = userId
    ? db.getProfileDayBounds(userId, targetDateKey)
    : { first: null, last: null };

  const pStart = bounds.first || latestProfile;
  const pEnd = bounds.last || latestProfile;

  const dayEvents = db.getEventsForDate(targetDateKey);
  const dayComparisons = db
    .getComparisonRecords({ dateKey: targetDateKey, limit: 500 })
    .reverse();

  const hourlyActivity = new Array<number>(24).fill(0);
  let followsChangeEvents = 0;
  let fansChangeEvents = 0;
  let newNotesCount = 0;
  let updatedNotesCount = 0;
  let deletedNotesCount = 0;
  let newCommentsCount = 0;
  let deletedCommentsCount = 0;
  let likeChangeEvents = 0;
  let ipChangeEvents = 0;
  let profileFieldChangeEvents = 0;
  let totalActivityEvents = 0;

  for (const ev of dayEvents) {
    if (ev.isActivity) {
      totalActivityEvents++;
      const h = new Date(ev.createdAt).getHours();
      if (h >= 0 && h < 24) hourlyActivity[h]++;
    }
    switch (ev.eventType) {
      case 'FOLLOWS_CHANGED':
        followsChangeEvents++;
        break;
      case 'FANS_CHANGED':
        fansChangeEvents++;
        break;
      case 'NEW_NOTE':
        newNotesCount++;
        break;
      case 'NOTE_UPDATED':
        updatedNotesCount++;
        break;
      case 'NOTE_DELETED':
        deletedNotesCount++;
        break;
      case 'NEW_COMMENT':
        newCommentsCount++;
        break;
      case 'COMMENT_DELETED':
        deletedCommentsCount++;
        break;
      case 'NOTE_LIKE_CHANGED':
        likeChangeEvents++;
        break;
      case 'IP_CHANGED':
        ipChangeEvents++;
        break;
      case 'NICKNAME_CHANGED':
      case 'GENDER_CHANGED':
      case 'BIO_CHANGED':
        profileFieldChangeEvents++;
        break;
    }
  }
  const dayIpChanges = db.getIpChangesForDate(targetDateKey, userId || undefined);
  const ipChangesTotal = Math.max(ipChangeEvents, dayIpChanges.length);
  const dayProfileFieldChanges = db.getProfileFieldChangesForDate(
    targetDateKey,
    userId || undefined
  );
  const profileFieldChangesTotal = Math.max(
    profileFieldChangeEvents,
    dayProfileFieldChanges.length
  );

  // 若首次运行当天有当日笔记入库，也计入统计提示
  if (newNotesCount === 0 && candidateNotes.length > 0) {
    newNotesCount = candidateNotes.length;
  }
  if (newCommentsCount === 0 && candidateComments.length > 0) {
    newCommentsCount = candidateComments.length;
  }

  const maxHourVal = Math.max(...hourlyActivity);
  const peakHoursText =
    maxHourVal > 0
      ? hourlyActivity
          .map((cnt, h) => ({ cnt, h }))
          .filter((x) => x.cnt === maxHourVal)
          .map((x) => `${String(x.h).padStart(2, '0')}:00-${String(x.h).padStart(2, '0')}:59`)
          .join('、')
      : '全天平稳无明显异动峰值';

  // 构建笔记互动排行
  const allNotes = db.getAllNotes(userId || undefined);
  const noteLeaderboard = allNotes
    .map((n) => {
      const delta = db.getNoteMetricDeltaForDate(n.noteId, targetDateKey);
      const nNewComms = dayComparisons.filter(
        (c) => c.noteId === n.noteId && c.compareType === 'COMMENT_APPEARED'
      ).length;
      const nDelComms = dayComparisons.filter(
        (c) => c.noteId === n.noteId && c.compareType === 'COMMENT_DELETED'
      ).length;
      return {
        noteId: n.noteId,
        title: n.title || '（无标题）',
        status: n.status,
        publishTimeText: formatStoredNotePublishTime(n),
        likedDelta: delta.likedDelta,
        collectedDelta: delta.collectedDelta,
        newComments: nNewComms,
        deletedComments: nDelComms,
        currentLikes: n.likedRaw,
        currentCollects: n.collectedRaw,
        score:
          Math.abs(delta.likedDelta) +
          Math.abs(delta.collectedDelta) * 2 +
          nNewComms * 5 +
          nDelComms * 8,
      };
    })
    .filter((item) => item.score > 0 || item.status === 'DELETED')
    .sort((a, b) => b.score - a.score)
    .slice(0, 15)
    .map(({ score: _score, ...rest }) => rest);

  const followsStart = pStart?.followsNum ?? 0;
  const followsEnd = pEnd?.followsNum ?? 0;
  const fansStart = pStart?.fansNum ?? 0;
  const fansEnd = pEnd?.fansNum ?? 0;
  const interStart = pStart?.interactionNum ?? 0;
  const interEnd = pEnd?.interactionNum ?? 0;
  const ipStart = pStart?.ipLocation || '';
  const ipEnd = pEnd?.ipLocation || '';

  const insights: string[] = [
    `昨日（${targetDateKey}）共完成 ${db.countPatrolRunsForDate(targetDateKey)} 次自动巡检，捕获动态事件 ${totalActivityEvents} 起。`,
    `账号净变化：关注 ${formatSignedInt(followsEnd - followsStart)}，粉丝 ${formatSignedInt(
      fansEnd - fansStart
    )}，获赞与收藏 ${formatSignedInt(interEnd - interStart)}；IP 属地：${
      ipChangesTotal > 0
        ? `发生 ${ipChangesTotal} 次变更（${ipStart || '未知'} → ${ipEnd || '未知'}）`
        : ipEnd
        ? `稳定保持在【${ipEnd}】`
        : '暂未显示'
    }。`,
    `内容异动：新发笔记 ${newNotesCount} 篇、修改笔记 ${updatedNotesCount} 篇、删除笔记 ${deletedNotesCount} 篇；新增评论 ${newCommentsCount} 条、删除评论 ${deletedCommentsCount} 条。`,
    `次日0点具体时间对照：共核验昨日笔记与评论 ${allReconciliations.length} 条，其中 ${matchedCount} 条吻合，${needsReviewCount} 条偏差较大需关注，精确时间已全部永久锁定至本地数据库。`,
  ];

  const nickname = config.targetRemark || latestProfile?.nickname || '未命名目标';
  const summaryText = `${targetDateKey} 次日0点汇总（${nickname}）：新笔记 ${newNotesCount} / 删笔记 ${deletedNotesCount} / 新评 ${newCommentsCount} / 删评 ${deletedCommentsCount}${
    ipChangesTotal > 0 ? ` / IP变更 ${ipChangesTotal} 次` : ''
  }；时间对照核验 ${allReconciliations.length} 项（吻合 ${matchedCount}，待复查 ${needsReviewCount}）。`;

  const reportDraft: DailyAnalyticsReport = {
    dateKey: targetDateKey,
    generatedAt: checkedAt,
    isNextDayVerified,
    account: {
      userId: latestProfile?.userId || '',
      nickname: latestProfile?.nickname || '未知账号',
      redId: latestProfile?.redId || '',
      followsStart,
      followsEnd,
      followsNet: followsEnd - followsStart,
      followsChangeEvents,
      fansStart,
      fansEnd,
      fansNet: fansEnd - fansStart,
      fansChangeEvents,
      interactionStart: interStart,
      interactionEnd: interEnd,
      interactionNet: interEnd - interStart,
      ipLocationStart: ipStart,
      ipLocationEnd: ipEnd,
      ipChangeEvents: ipChangesTotal,
    },
    counts: {
      patrolRuns: db.countPatrolRunsForDate(targetDateKey),
      totalActivityEvents,
      newNotes: newNotesCount,
      updatedNotes: updatedNotesCount,
      deletedNotes: deletedNotesCount,
      newComments: newCommentsCount,
      deletedComments: deletedCommentsCount,
      likeChangeEvents,
      ipChanges: ipChangesTotal,
      profileFieldChanges: profileFieldChangesTotal,
      timeCheckTotal: allReconciliations.length,
      timeCheckMatched: matchedCount,
      timeCheckNeedsReview: needsReviewCount,
    },
    hourlyActivity,
    peakHoursText,
    insights,
    timeReconciliations: allReconciliations,
    comparisonRecords: dayComparisons,
    noteLeaderboard,
    summaryText,
    markdownReportPath: '',
  };

  const mdContent = renderMarkdownReport(reportDraft);
  const mdPath = writeDailyReportFiles(targetDateKey, reportDraft, mdContent);
  reportDraft.markdownReportPath = mdPath;

  db.saveDailyReport(reportDraft);
  if (isNextDayVerified) {
    db.setMeta('last_reconciled_date', targetDateKey);
  }

  const emittedEvents: MonitorEvent[] = [];
  const reportEv = db.insertEvent({
    eventType: 'DAILY_REPORT',
    title: `【次日0点汇总与时间对照】${targetDateKey}`,
    body: summaryText,
    level: 'timeSensitive',
    shouldPush: config.pushDailyReportToBark,
    triggersBurst: false,
    isActivity: false,
    createdAt: checkedAt,
  });
  appendEventLogFile(getLocalDateKey(checkedAt), reportEv as unknown as Record<string, unknown>);
  emittedEvents.push(reportEv);

  if (needsReviewCount > 0) {
    const alertEv = db.insertEvent({
      eventType: 'TIME_REVIEW_ALERT',
      title: `【时间对照偏差提醒】${targetDateKey} 有 ${needsReviewCount} 项需关注`,
      body: `次日0点复核「昨天 HH:mm」具体时间时，发现 ${needsReviewCount} 条内容的实际时间与当天本地记录时间相差超过阈值或存在二次编辑，请在控制台查看对照表。`,
      level: 'timeSensitive',
      shouldPush: config.pushDailyReportToBark,
      triggersBurst: false,
      isActivity: false,
      createdAt: checkedAt,
    });
    appendEventLogFile(getLocalDateKey(checkedAt), alertEv as unknown as Record<string, unknown>);
    emittedEvents.push(alertEv);
  }

  return { report: reportDraft, events: emittedEvents };
}

function reconcileNoteItem(
  note: StoredNoteRow,
  targetDateKey: string,
  checkedAt: string,
  checkedNowMs: number,
  thresholdMinutes: number,
  db: MonitorDatabase
): TimeReconciliationItem {
  const localRecordedMs = new Date(note.firstSeenAt).getTime();
  const parsedFirst = parseXhsRenderedTimeText(note.firstRenderedTimeText, localRecordedMs);
  const sameDayEstimatedMs = note.publishedAt ?? parsedFirst.parsedMs;
  const sameDayDisplay = note.firstRenderedTimeText
    ? `${note.firstRenderedTimeText}${
        parsedFirst.parsedMs && !parsedFirst.hasExactClock
          ? `（当天推算约 ${formatDateTime(parsedFirst.parsedMs).slice(11, 16)}）`
          : ''
      }`
    : note.publishedAt
    ? formatDateTime(note.publishedAt)
    : '当天未显示相对时间';

  if (note.status === 'DELETED') {
    const fallbackMs = note.verifiedPublishMs ?? sameDayEstimatedMs;
    return {
      targetDateKey,
      itemType: 'NOTE',
      targetId: note.noteId,
      noteId: note.noteId,
      titleOrExcerpt: `笔记《${note.title}》`,
      authorNickname: '被监控账号',
      localRecordedAt: note.firstSeenAt,
      sameDayPlatformTimeText: sameDayDisplay,
      sameDayEstimatedMs,
      nextDayVerifiedTimeText: `0点前已删除（${note.estimatedDeleteWindow || '已删除'}）`,
      verifiedPlatformMs: fallbackMs,
      captureDelayMinutes:
        fallbackMs !== null ? Math.round((localRecordedMs - fallbackMs) / 60_000) : null,
      estimateErrorMinutes: null,
      diffMinutes: null,
      status: 'DELETED_BEFORE_MIDNIGHT',
      anomalyReason: `该笔记在跨0点前已删除，已保留当天捕获时间（${formatDateTime(
        note.firstSeenAt
      )}）与大概删除时间区间`,
      reviewNote: '',
      checkedAt,
      reviewedAt: null,
    };
  }

  const parsedLatest = parseXhsRenderedTimeText(note.latestRenderedTimeText, checkedNowMs);

  // 优先取非编辑态的「昨天 HH:mm」解析值或接口毫秒时间戳
  let verifiedMs: number | null = null;
  if (note.publishedAt) {
    verifiedMs = note.publishedAt;
  } else if (parsedLatest.hasExactClock && parsedLatest.parsedMs && !parsedLatest.isEditedText) {
    verifiedMs = parsedLatest.parsedMs;
  } else if (note.verifiedPublishMs) {
    verifiedMs = note.verifiedPublishMs;
  } else if (parsedLatest.parsedMs) {
    verifiedMs = parsedLatest.parsedMs;
  }

  // 永久回写锁定精确发布时间与精确编辑时间到 notes 表（防止2天后变成 MM-DD 丢失具体时分！）
  const exactEditMsFromLatest =
    parsedLatest.isEditedText && parsedLatest.hasExactClock && parsedLatest.parsedMs
      ? parsedLatest.parsedMs
      : null;
  const needLockPublish = Boolean(verifiedMs && (!note.verifiedPublishMs || !note.verifiedTimeText));
  const needLockEdit = Boolean(
    exactEditMsFromLatest &&
      (!note.lastEditedAtMs || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(note.lastEditedTimeText))
  );
  if (needLockPublish || needLockEdit) {
    const lockedEditText = exactEditMsFromLatest
      ? formatDateTime(exactEditMsFromLatest)
      : note.lastEditedTimeText;
    db.upsertNote({
      ...note,
      verifiedPublishMs: needLockPublish ? verifiedMs : note.verifiedPublishMs,
      verifiedTimeText: needLockPublish && verifiedMs ? formatDateTime(verifiedMs) : note.verifiedTimeText,
      lastEditedAtMs: needLockEdit ? exactEditMsFromLatest : note.lastEditedAtMs,
      lastEditedTimeText: needLockEdit ? lockedEditText : note.lastEditedTimeText,
      editCount: needLockEdit ? Math.max(note.editCount, 1) : note.editCount,
    });
    if (needLockEdit && exactEditMsFromLatest) {
      db.updateLatestRevisionEditTime(
        note.noteId,
        exactEditMsFromLatest,
        lockedEditText,
        note.latestRenderedTimeText
      );
    }
  }

  const nextDayText = note.latestRenderedTimeText
    ? `${note.latestRenderedTimeText}${
        verifiedMs ? `（精确时间：${formatDateTime(verifiedMs)}）` : ''
      }`
    : verifiedMs
    ? formatDateTime(verifiedMs)
    : '待刷新具体时间';

  if (verifiedMs === null) {
    return {
      targetDateKey,
      itemType: 'NOTE',
      targetId: note.noteId,
      noteId: note.noteId,
      titleOrExcerpt: `笔记《${note.title}》`,
      authorNickname: '被监控账号',
      localRecordedAt: note.firstSeenAt,
      sameDayPlatformTimeText: sameDayDisplay,
      sameDayEstimatedMs,
      nextDayVerifiedTimeText: nextDayText,
      verifiedPlatformMs: null,
      captureDelayMinutes: null,
      estimateErrorMinutes: null,
      diffMinutes: null,
      status: 'NEEDS_REVIEW',
      anomalyReason: '暂未获取到次日「昨天 HH:mm」具体时间文本，建议重新执行复核',
      reviewNote: '',
      checkedAt,
      reviewedAt: null,
    };
  }

  // 若页面显示「编辑于 昨天 HH:mm」且没有底层原始 publishedAt，可能导致显示时间晚于首次捕获时间
  const comparisonMs =
    parsedLatest.isEditedText && parsedLatest.parsedMs && !note.publishedAt
      ? parsedLatest.parsedMs
      : verifiedMs;

  const captureDelayMinutes = Math.round((localRecordedMs - comparisonMs) / 60_000);
  const estimateErrorMinutes =
    parsedFirst.parsedMs !== null
      ? Math.round((parsedFirst.parsedMs - verifiedMs) / 60_000)
      : null;
  const absDiff = Math.abs(captureDelayMinutes);

  let status: ReconciliationStatus = 'MATCHED';
  let reason = '';

  if (captureDelayMinutes < -3 || (parsedLatest.isEditedText && note.updatedAt && note.updatedAt > localRecordedMs)) {
    status = 'NEEDS_REVIEW';
    reason = `次日页面展示含二次编辑时间（${note.latestRenderedTimeText}），与当天首次捕获记录存在改动差`;
  } else if (absDiff > thresholdMinutes) {
    status = 'NEEDS_REVIEW';
    reason = `当天本地捕获时间比小红书实际发布时间晚 ${captureDelayMinutes} 分钟（超过设定阈值 ${thresholdMinutes} 分钟）`;
  } else {
    reason = `对照吻合：实际发布 ${formatDateTime(verifiedMs).slice(
      11,
      16
    )}，当天本地记录 ${formatDateTime(localRecordedMs).slice(11, 16)}（延迟 ${Math.max(
      0,
      captureDelayMinutes
    )} 分钟${
      estimateErrorMinutes !== null
        ? `，当天相对时间推算误差 ${formatSignedInt(estimateErrorMinutes)} 分钟`
        : ''
    }）`;
  }

  return {
    targetDateKey,
    itemType: 'NOTE',
    targetId: note.noteId,
    noteId: note.noteId,
    titleOrExcerpt: `笔记《${note.title}》`,
    authorNickname: '被监控账号',
    localRecordedAt: note.firstSeenAt,
    sameDayPlatformTimeText: sameDayDisplay,
    sameDayEstimatedMs,
    nextDayVerifiedTimeText: nextDayText,
    verifiedPlatformMs: verifiedMs,
    captureDelayMinutes,
    estimateErrorMinutes,
    diffMinutes: absDiff,
    status,
    anomalyReason: reason,
    reviewNote: '',
    checkedAt,
    reviewedAt: null,
  };
}

function reconcileCommentItem(
  comment: StoredCommentRow,
  parentNote: StoredNoteRow | null,
  targetDateKey: string,
  checkedAt: string,
  checkedNowMs: number,
  thresholdMinutes: number,
  db: MonitorDatabase
): TimeReconciliationItem {
  const localRecordedMs = new Date(comment.firstSeenAt).getTime();
  const parsedFirst = parseXhsRenderedTimeText(comment.firstRenderedTimeText, localRecordedMs);
  const sameDayEstimatedMs = comment.createdAt ?? parsedFirst.parsedMs;
  const sameDayDisplay = comment.firstRenderedTimeText
    ? `${comment.firstRenderedTimeText}${
        parsedFirst.parsedMs && !parsedFirst.hasExactClock
          ? `（当天推算约 ${formatDateTime(parsedFirst.parsedMs).slice(11, 16)}）`
          : ''
      }`
    : comment.createdAt
    ? formatDateTime(comment.createdAt)
    : '当天未显示相对时间';

  const noteTitle = parentNote?.title || comment.noteId;
  const displayCommentAuthor = formatNicknameWithRedId(comment.nickname, comment.userRedId);
  const excerpt = `评论「${truncateText(comment.content, 28)}」（《${truncateText(
    noteTitle,
    14
  )}》）`;

  if (comment.status === 'DELETED') {
    const fallbackMs = comment.verifiedCreatedMs ?? sameDayEstimatedMs;
    return {
      targetDateKey,
      itemType: 'COMMENT',
      targetId: comment.commentId,
      noteId: comment.noteId,
      titleOrExcerpt: excerpt,
      authorNickname: displayCommentAuthor,
      localRecordedAt: comment.firstSeenAt,
      sameDayPlatformTimeText: sameDayDisplay,
      sameDayEstimatedMs,
      nextDayVerifiedTimeText: `0点前已删除（${comment.estimatedDeleteWindow || '已删'}）`,
      verifiedPlatformMs: fallbackMs,
      captureDelayMinutes:
        fallbackMs !== null ? Math.round((localRecordedMs - fallbackMs) / 60_000) : null,
      estimateErrorMinutes: null,
      diffMinutes: null,
      status: 'DELETED_BEFORE_MIDNIGHT',
      anomalyReason: `该评论在跨0点前已删除，保留当天本地捕获时间（${formatDateTime(
        comment.firstSeenAt
      )}）与大概删除时间`,
      reviewNote: '',
      checkedAt,
      reviewedAt: null,
    };
  }

  const parsedLatest = parseXhsRenderedTimeText(comment.latestRenderedTimeText, checkedNowMs);
  let verifiedMs: number | null = null;
  if (comment.createdAt) {
    verifiedMs = comment.createdAt;
  } else if (parsedLatest.hasExactClock && parsedLatest.parsedMs) {
    verifiedMs = parsedLatest.parsedMs;
  } else if (comment.verifiedCreatedMs) {
    verifiedMs = comment.verifiedCreatedMs;
  } else if (parsedLatest.parsedMs) {
    verifiedMs = parsedLatest.parsedMs;
  }

  if (verifiedMs && (!comment.verifiedCreatedMs || !comment.verifiedTimeText)) {
    db.upsertComment({
      ...comment,
      verifiedCreatedMs: verifiedMs,
      verifiedTimeText: formatDateTime(verifiedMs),
    });
  }

  const nextDayText = comment.latestRenderedTimeText
    ? `${comment.latestRenderedTimeText}${
        verifiedMs ? `（精确时间：${formatDateTime(verifiedMs)}）` : ''
      }`
    : verifiedMs
    ? formatDateTime(verifiedMs)
    : '待刷新具体时间';

  if (verifiedMs === null) {
    return {
      targetDateKey,
      itemType: 'COMMENT',
      targetId: comment.commentId,
      noteId: comment.noteId,
      titleOrExcerpt: excerpt,
      authorNickname: displayCommentAuthor,
      localRecordedAt: comment.firstSeenAt,
      sameDayPlatformTimeText: sameDayDisplay,
      sameDayEstimatedMs,
      nextDayVerifiedTimeText: nextDayText,
      verifiedPlatformMs: null,
      captureDelayMinutes: null,
      estimateErrorMinutes: null,
      diffMinutes: null,
      status: 'NEEDS_REVIEW',
      anomalyReason: '暂未获取到次日「昨天 HH:mm」具体评论时间文本',
      reviewNote: '',
      checkedAt,
      reviewedAt: null,
    };
  }

  const captureDelayMinutes = Math.round((localRecordedMs - verifiedMs) / 60_000);
  const estimateErrorMinutes =
    parsedFirst.parsedMs !== null
      ? Math.round((parsedFirst.parsedMs - verifiedMs) / 60_000)
      : null;
  const absDiff = Math.abs(captureDelayMinutes);

  const status: ReconciliationStatus =
    absDiff > thresholdMinutes ? 'NEEDS_REVIEW' : 'MATCHED';
  const reason =
    status === 'NEEDS_REVIEW'
      ? `当天评论本地捕获时间晚于实际评论时间 ${captureDelayMinutes} 分钟（超过阈值 ${thresholdMinutes} 分钟）`
      : `对照吻合：实际评论 ${formatDateTime(verifiedMs).slice(
          11,
          16
        )}，当天本地记录 ${formatDateTime(localRecordedMs).slice(11, 16)}（延迟 ${Math.max(
          0,
          captureDelayMinutes
        )} 分钟${
          estimateErrorMinutes !== null
            ? `，当天相对时间推算误差 ${formatSignedInt(estimateErrorMinutes)} 分钟`
            : ''
        }）`;

  return {
    targetDateKey,
    itemType: 'COMMENT',
    targetId: comment.commentId,
    noteId: comment.noteId,
    titleOrExcerpt: excerpt,
    authorNickname: displayCommentAuthor,
    localRecordedAt: comment.firstSeenAt,
    sameDayPlatformTimeText: sameDayDisplay,
    sameDayEstimatedMs,
    nextDayVerifiedTimeText: nextDayText,
    verifiedPlatformMs: verifiedMs,
    captureDelayMinutes,
    estimateErrorMinutes,
    diffMinutes: absDiff,
    status,
    anomalyReason: reason,
    reviewNote: '',
    checkedAt,
    reviewedAt: null,
  };
}

function renderMarkdownReport(r: DailyAnalyticsReport): string {
  const lines: string[] = [];
  lines.push(`# 小红书监控系统 · 次日0点汇总与时间对照报告（${r.dateKey}）`);
  lines.push('');
  lines.push(`- **监控账号**：${r.account.nickname}（小红书号：\`${r.account.redId || '-'}\`）`);
  lines.push(`- **报告生成时间**：${formatDateTime(r.generatedAt)}`);
  lines.push(
    `- **次日0点复核状态**：${
      r.isNextDayVerified ? '已跨0点复核「昨天 HH:mm」精确时间并锁定入库' : '当日实时预览（跨0点后将自动复核精确时间）'
    }`
  );
  lines.push(`- **活跃高峰时段**：${r.peakHoursText}`);
  lines.push('');

  lines.push('## 一、核心指标汇总');
  lines.push('');
  lines.push('| 维度 | 起始值 | 结束值 | 净变化 / 次数 |');
  lines.push('| :--- | :--- | :--- | :--- |');
  lines.push(
    `| 关注数 | ${r.account.followsStart} | ${r.account.followsEnd} | ${formatSignedInt(
      r.account.followsNet
    )}（变动 ${r.account.followsChangeEvents} 次） |`
  );
  lines.push(
    `| 粉丝数 | ${r.account.fansStart} | ${r.account.fansEnd} | ${formatSignedInt(
      r.account.fansNet
    )}（变动 ${r.account.fansChangeEvents} 次） |`
  );
  lines.push(
    `| 获赞与收藏 | ${r.account.interactionStart} | ${r.account.interactionEnd} | ${formatSignedInt(
      r.account.interactionNet
    )} |`
  );
  lines.push(
    `| 笔记动态 | - | - | 新增 ${r.counts.newNotes} / 修改 ${r.counts.updatedNotes} / 删除 ${r.counts.deletedNotes} |`
  );
  lines.push(
    `| 评论动态 | - | - | 新增评论 ${r.counts.newComments} / 删除评论 ${r.counts.deletedComments} |`
  );
  lines.push(
    `| IP 属地 | ${r.account.ipLocationStart || '-'} | ${r.account.ipLocationEnd || '-'} | 变更 ${
      r.account.ipChangeEvents ?? r.counts.ipChanges ?? 0
    } 次 |`
  );
  lines.push('');

  lines.push('## 二、次日0点「昨天 HH:mm」具体时间 vs 当天本地记录时间对照表');
  lines.push('');
  if (r.timeReconciliations.length === 0) {
    lines.push('> 昨日无新发布笔记或新评论需要时间对照。');
  } else {
    lines.push(
      '| 类型 | 内容摘要 | 发布者 | 当天本地记录时间 | 当天页面显示/推算 | 次日0点复核具体时间 | 捕获延迟 | 状态与说明 |'
    );
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');
    for (const item of r.timeReconciliations) {
      const typeLabel = item.itemType === 'NOTE' ? '笔记' : '评论';
      const delayStr =
        item.captureDelayMinutes !== null ? `${item.captureDelayMinutes} 分钟` : '-';
      const statusBadge =
        item.status === 'MATCHED' || item.status === 'REVIEWED_OK'
          ? '吻合'
          : item.status === 'DELETED_BEFORE_MIDNIGHT'
          ? '0点前已删'
          : '需关注';
      lines.push(
        `| ${typeLabel} | ${item.titleOrExcerpt.replace(/\|/g, '｜')} | ${
          item.authorNickname
        } | ${formatDateTime(item.localRecordedAt)} | ${item.sameDayPlatformTimeText.replace(
          /\|/g,
          '｜'
        )} | ${item.nextDayVerifiedTimeText.replace(/\|/g, '｜')} | ${delayStr} | **${statusBadge}**：${item.anomalyReason.replace(
          /\|/g,
          '｜'
        )} |`
      );
    }
  }
  lines.push('');

  lines.push('## 三、删帖、改文、新评论与删评论本地存档对比记录');
  lines.push('');
  if (r.comparisonRecords.length === 0) {
    lines.push('> 昨日未发生删帖、改文、新增评论或删评记录。');
  } else {
    for (const c of r.comparisonRecords) {
      const tagMap = {
        NOTE_DELETED: '删除笔记对比',
        NOTE_EDITED: '修改笔记对比',
        COMMENT_APPEARED: '新增评论与笔记时间对比',
        COMMENT_DELETED: '删除评论对比',
        AVATAR_CHANGED: '更换头像存档对比',
        IP_CHANGED: 'IP属地变更对比',
        NICKNAME_CHANGED: '名字变更对比',
        GENDER_CHANGED: '性别变更对比',
        BIO_CHANGED: '个性签名变更对比',
      };
      const isProfileAttrComp =
        c.compareType === 'IP_CHANGED' ||
        c.compareType === 'NICKNAME_CHANGED' ||
        c.compareType === 'GENDER_CHANGED' ||
        c.compareType === 'BIO_CHANGED';
      lines.push(
        `### [${tagMap[c.compareType]}] ${isProfileAttrComp ? c.noteTitle : `《${c.noteTitle}》`}`
      );
      if (isProfileAttrComp) {
        lines.push(`- **变更前**：${c.localSavedContent}`);
        if (c.newContentIfEdited) {
          lines.push(`- **变更后**：${c.newContentIfEdited}`);
        }
        lines.push(`- **原记录时间**：${c.notePublishTime}`);
        if (c.lastSeenAliveTime) {
          lines.push(`- **上次确认原值时间**：${c.lastSeenAliveTime}`);
        }
        lines.push(`- **发现变更时间**：${c.detectedChangeTime}`);
        lines.push(`- **推算变更区间**：${c.estimatedActionTimeText}`);
        lines.push('');
        continue;
      }
      lines.push(`- **本地存档笔记发布时间**：${c.notePublishTime}`);
      if (c.commentPublishTime) {
        lines.push(`- **评论时间**：${c.commentPublishTime}（评论者：@${c.authorNickname}）`);
      }
      lines.push(`- **本地首次捕获时间**：${c.firstCapturedTime}`);
      if (c.lastSeenAliveTime) {
        lines.push(`- **最后一次确认存活时间**：${c.lastSeenAliveTime}`);
      }
      lines.push(`- **发现变动时间**：${c.detectedChangeTime}`);
      lines.push(`- **大概时间区间 / 间隔对比**：${c.estimatedActionTimeText}`);
      lines.push(`- **本地存档内容**：\n  > ${c.localSavedContent.replace(/\n/g, '\n  > ')}`);
      if (c.newContentIfEdited) {
        lines.push(`- **修改后新内容**：\n  > ${c.newContentIfEdited.replace(/\n/g, '\n  > ')}`);
      }
      if (c.localPhotoPaths.length > 0) {
        lines.push(`- **本地已备份照片数**：${c.localPhotoPaths.length} 张（\`${c.localPhotoPaths.join('`, `')}\`）`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
