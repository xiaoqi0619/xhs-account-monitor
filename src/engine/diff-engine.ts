import type {
  AppConfig,
  CollectResult,
  CommentSnapshot,
  CompareType,
  ComparisonRecord,
  EventType,
  MonitorEvent,
  NoteSnapshot,
  ProfileFieldKey,
  ProfileSnapshot,
  StoredCommentRow,
  StoredNoteRow,
} from '../shared/types.ts';
import {
  estimateDeletionWindow,
  extractIpFromRenderedTimeText,
  extractXhsImageKey,
  formatDateTime,
  formatDiffDelta,
  formatDurationMinutes,
  formatNicknameWithRedId,
  getLocalDateKey,
  normalizeIpLocation,
  normalizeProfileBio,
  normalizeProfileGender,
  normalizeProfileNickname,
  nowIso,
  parseXhsRenderedTimeText,
  truncateText,
} from '../shared/utils.ts';
import type { MonitorDatabase } from '../storage/database.ts';
import {
  appendComparisonLogFile,
  appendEventLogFile,
  appendIpChangeLogFile,
  appendProfileChangeLogFile,
  archiveCommentPhotos,
  archiveNotePhotosAndMeta,
  archiveUserAvatar,
} from '../storage/file-store.ts';

interface DiffProcessOptions {
  /** 测试或离线模拟时跳过真实网络下载图片 */
  skipMediaDownload?: boolean;
  /** 指定当前巡视时间（用于离线测试跨天与删除时间推算） */
  overrideNowIso?: string;
}

interface DiffProcessSummary {
  isBaselineRun: boolean;
  events: MonitorEvent[];
  comparisons: ComparisonRecord[];
  notesProcessed: number;
  commentsProcessed: number;
}

/**
 * 格式化本地永久保存的笔记发布时间描述（即使过了2天小红书前端不再显示时分，也能读取本地已锁定的精确时间）
 */
export function formatStoredNotePublishTime(note: StoredNoteRow): string {
  if (note.verifiedTimeText) {
    return note.firstRenderedTimeText && !note.verifiedTimeText.includes(note.firstRenderedTimeText)
      ? `${note.verifiedTimeText}（首次记录显示：${note.firstRenderedTimeText}）`
      : note.verifiedTimeText;
  }
  if (note.publishedAt) {
    return formatDateTime(note.publishedAt);
  }
  if (note.firstRenderedTimeText) {
    return `${note.firstRenderedTimeText}（本地首次入库：${formatDateTime(note.firstSeenAt)}）`;
  }
  return `本地首次入库：${formatDateTime(note.firstSeenAt)}`;
}

function formatStoredCommentPublishTime(comment: StoredCommentRow): string {
  if (comment.verifiedTimeText) {
    return comment.verifiedTimeText;
  }
  if (comment.createdAt) {
    return formatDateTime(comment.createdAt);
  }
  if (comment.firstRenderedTimeText) {
    return `${comment.firstRenderedTimeText}（本地首次入库：${formatDateTime(comment.firstSeenAt)}）`;
  }
  return `本地首次入库：${formatDateTime(comment.firstSeenAt)}`;
}

function resolveNoteVerifiedTime(
  note: NoteSnapshot,
  existing: StoredNoteRow | null,
  refMs: number
): { verifiedMs: number | null; verifiedText: string; cleanRendered: string } {
  const parsed = parseXhsRenderedTimeText(note.renderedTimeText, refMs);
  const cleanRendered = parsed.cleanTimeText || note.renderedTimeText || '';

  // 1. 若已有精确锁定时间（例如之前通过 API 毫秒时间戳或次日0点「昨天 HH:mm」锁定过），优先保留不被2天后粗略的 MM-DD 覆盖！
  if (existing?.verifiedPublishMs && existing.verifiedTimeText) {
    return {
      verifiedMs: existing.verifiedPublishMs,
      verifiedText: existing.verifiedTimeText,
      cleanRendered,
    };
  }

  // 2. 接口直接返回了发布毫秒时间戳（最准确，不受2天后前端隐藏时分影响）
  if (note.publishedAt && note.publishedAt > 0) {
    return {
      verifiedMs: note.publishedAt,
      verifiedText: formatDateTime(note.publishedAt),
      cleanRendered,
    };
  }

  // 3. 页面展示了带具体时分的文本（如「昨天 21:36」「今天 09:15」「2026-11-25 21:36」）且非二次编辑时间
  if (parsed.hasExactClock && parsed.parsedMs && !parsed.isEditedText) {
    return {
      verifiedMs: parsed.parsedMs,
      verifiedText: formatDateTime(parsed.parsedMs),
      cleanRendered,
    };
  }

  return {
    verifiedMs: existing?.verifiedPublishMs ?? null,
    verifiedText: existing?.verifiedTimeText ?? '',
    cleanRendered,
  };
}

const EXACT_DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

function resolveNoteEditTime(
  note: NoteSnapshot,
  existing: StoredNoteRow | null,
  refMs: number
): {
  isEditedByPlatform: boolean;
  hasExactEditClock: boolean;
  lastEditedAtMs: number | null;
  lastEditedTimeText: string;
  hasNewPlatformEdit: boolean;
  upgradedToExactClock: boolean;
} {
  const parsed = parseXhsRenderedTimeText(note.renderedTimeText, refMs);
  const pubMs = note.publishedAt ?? existing?.publishedAt ?? existing?.verifiedPublishMs ?? null;
  const apiEditMs =
    note.updatedAt &&
    note.updatedAt > 0 &&
    ((pubMs !== null && note.updatedAt - pubMs >= 5_000) ||
      (pubMs === null && parsed.isEditedText))
      ? note.updatedAt
      : null;

  const domExactEditMs =
    parsed.isEditedText && parsed.hasExactClock && parsed.parsedMs ? parsed.parsedMs : null;
  const domApproxEditMs =
    parsed.isEditedText && !parsed.hasExactClock && parsed.parsedMs ? parsed.parsedMs : null;

  const prevEditMs = existing?.lastEditedAtMs ?? null;
  const prevEditText = existing?.lastEditedTimeText ?? '';
  const prevWasExact = Boolean(prevEditMs && EXACT_DATETIME_RE.test(prevEditText));

  // 1. 平台底层接口明确返回了精确到秒的编辑时间戳（最准确）
  if (apiEditMs) {
    const hasNewPlatformEdit = Boolean(
      existing && (!prevEditMs || apiEditMs > prevEditMs + 2_000)
    );
    const upgradedToExactClock = Boolean(
      existing && !prevWasExact && prevEditText && !hasNewPlatformEdit
    );
    return {
      isEditedByPlatform: true,
      hasExactEditClock: true,
      lastEditedAtMs: apiEditMs,
      lastEditedTimeText: formatDateTime(apiEditMs),
      hasNewPlatformEdit,
      upgradedToExactClock,
    };
  }

  // 2. 页面明确展示了带具体时分的编辑时间（如次日0点显现的「编辑于 昨天 22:10」或「编辑于 2026-11-26 22:10」）
  if (domExactEditMs) {
    const looksLikeSameEditUpgrade = Boolean(
      existing &&
        prevEditText &&
        !prevWasExact &&
        (prevEditMs === null || Math.abs(domExactEditMs - prevEditMs) <= 120 * 60_000)
    );
    const hasNewPlatformEdit = Boolean(
      existing &&
        !looksLikeSameEditUpgrade &&
        (!prevEditMs || domExactEditMs > prevEditMs + 60_000)
    );
    return {
      isEditedByPlatform: true,
      hasExactEditClock: true,
      lastEditedAtMs: domExactEditMs,
      lastEditedTimeText: formatDateTime(domExactEditMs),
      hasNewPlatformEdit,
      upgradedToExactClock: looksLikeSameEditUpgrade,
    };
  }

  // 3. 页面展示了模糊/相对的编辑文本（如「编辑于 12分钟前」「编辑于 6天前」「编辑于 11-17」）
  if (parsed.isEditedText) {
    // 已有永久锁定的精确编辑时间时，绝不被2天后粗略的「编辑于 11-17 / 6天前」覆盖
    if (prevWasExact) {
      return {
        isEditedByPlatform: true,
        hasExactEditClock: true,
        lastEditedAtMs: prevEditMs,
        lastEditedTimeText: prevEditText,
        hasNewPlatformEdit: false,
        upgradedToExactClock: false,
      };
    }
    const isFreshRelativeEdit = /(刚刚|分钟前|小时前)/.test(parsed.cleanTimeText);
    const approxText =
      isFreshRelativeEdit && domApproxEditMs
        ? `${parsed.cleanTimeText}（推算约 ${formatDateTime(domApproxEditMs)}）`
        : parsed.cleanTimeText;
    const hasNewPlatformEdit = Boolean(existing && !prevEditText);
    return {
      isEditedByPlatform: true,
      hasExactEditClock: false,
      lastEditedAtMs: domApproxEditMs ?? prevEditMs,
      lastEditedTimeText: prevEditText && !isFreshRelativeEdit ? prevEditText : approxText,
      hasNewPlatformEdit,
      upgradedToExactClock: false,
    };
  }

  return {
    isEditedByPlatform: false,
    hasExactEditClock: prevWasExact,
    lastEditedAtMs: prevEditMs,
    lastEditedTimeText: prevEditText,
    hasNewPlatformEdit: false,
    upgradedToExactClock: false,
  };
}

function resolveCommentVerifiedTime(
  c: CommentSnapshot,
  existing: StoredCommentRow | null,
  refMs: number
): { verifiedMs: number | null; verifiedText: string; cleanRendered: string } {
  const parsed = parseXhsRenderedTimeText(c.renderedTimeText, refMs);
  const cleanRendered = parsed.cleanTimeText || c.renderedTimeText || '';

  if (existing?.verifiedCreatedMs && existing.verifiedTimeText) {
    return {
      verifiedMs: existing.verifiedCreatedMs,
      verifiedText: existing.verifiedTimeText,
      cleanRendered,
    };
  }

  if (c.createdAt && c.createdAt > 0) {
    return {
      verifiedMs: c.createdAt,
      verifiedText: formatDateTime(c.createdAt),
      cleanRendered,
    };
  }

  if (parsed.hasExactClock && parsed.parsedMs) {
    return {
      verifiedMs: parsed.parsedMs,
      verifiedText: formatDateTime(parsed.parsedMs),
      cleanRendered,
    };
  }

  return {
    verifiedMs: existing?.verifiedCreatedMs ?? null,
    verifiedText: existing?.verifiedTimeText ?? '',
    cleanRendered,
  };
}

/**
 * 全量建档 & 增量对比核心引擎
 * - 首次运行：保存账号现有全部笔记、高清图片、全量评论及发布时间基线
 * - 后续运行：对比删帖（推算删除大概时间区间）、改文、新增评论（与本地笔记时间对比）、删除评论（推算删除大概时间区间）
 */
export async function processCollectResult(
  collectResult: CollectResult,
  db: MonitorDatabase,
  config: AppConfig,
  opts?: DiffProcessOptions
): Promise<DiffProcessSummary> {
  if (collectResult.status !== 'OK' || !collectResult.profile) {
    return {
      isBaselineRun: false,
      events: [],
      comparisons: [],
      notesProcessed: 0,
      commentsProcessed: 0,
    };
  }

  const runNow = opts?.overrideNowIso || nowIso();
  const runNowMs = new Date(runNow).getTime();
  const dateKey = getLocalDateKey(runNow);
  const skipDownload = Boolean(opts?.skipMediaDownload);

  const profile: ProfileSnapshot = {
    ...collectResult.profile,
    nickname: normalizeProfileNickname(collectResult.profile.nickname) || '未知用户',
    gender: normalizeProfileGender(collectResult.profile.gender),
    desc: normalizeProfileBio(collectResult.profile.desc),
    ipLocation: normalizeIpLocation(collectResult.profile.ipLocation),
  };
  const displayName = config.targetRemark || profile.nickname;
  const isBaselineRun = !db.isBaselineCompletedForUser(profile.userId);

  const emittedEvents: MonitorEvent[] = [];
  const emittedComparisons: ComparisonRecord[] = [];

  const pushEvent = (ev: Omit<MonitorEvent, 'createdAt'>) => {
    const stored = db.insertEvent({ ...ev, createdAt: runNow });
    appendEventLogFile(dateKey, stored as unknown as Record<string, unknown>);
    emittedEvents.push(stored);
  };

  const pushComparison = (comp: ComparisonRecord) => {
    const stored = db.insertComparisonRecord(comp);
    appendComparisonLogFile(dateKey, stored as unknown as Record<string, unknown>);
    emittedComparisons.push(stored);
  };

  // 1. 存档头像（保留历史每次更换的头像文件）与对比账号资料变动
  const prevProfile = db.getLatestProfile(profile.userId);
  const latestAvatarRec = db.getLatestAvatarRecord(profile.userId);

  let localAvatar: string | null = latestAvatarRec?.localPath || prevProfile?.localAvatarPath || null;
  let avatarChanged = false;

  if (skipDownload) {
    const curKey = extractXhsImageKey(profile.avatar);
    if (curKey && (!latestAvatarRec || latestAvatarRec.avatarKey !== curKey)) {
      const mockPath = `/photos/avatars/${profile.userId}_${curKey.slice(0, 10)}.webp`;
      avatarChanged = Boolean(latestAvatarRec);
      localAvatar = mockPath;
      db.insertAvatarRecord({
        userId: profile.userId,
        avatarKey: curKey,
        sha256: curKey.slice(0, 12),
        remoteUrl: profile.avatar,
        localPath: mockPath,
        capturedAt: runNow,
      });
    }
  } else {
    const avatarRes = await archiveUserAvatar(profile.userId, profile.avatar, latestAvatarRec);
    localAvatar = avatarRes.localPath;
    avatarChanged = avatarRes.changed;
    if (
      avatarRes.localPath &&
      (!latestAvatarRec || avatarRes.changed || latestAvatarRec.localPath !== avatarRes.localPath)
    ) {
      db.insertAvatarRecord({
        userId: profile.userId,
        avatarKey: avatarRes.avatarKey,
        sha256: avatarRes.sha256,
        remoteUrl: profile.avatar,
        localPath: avatarRes.localPath,
        capturedAt: runNow,
      });
    }
  }

  if (!isBaselineRun && avatarChanged && localAvatar) {
    const oldAvatarPath = latestAvatarRec?.localPath || prevProfile?.localAvatarPath || '';
    const avatarPaths = [oldAvatarPath, localAvatar].filter(Boolean);
    const estWin = prevProfile
      ? estimateDeletionWindow(prevProfile.capturedAt, runNow).windowText.replace('删除区间', '更换区间')
      : `约 ${formatDateTime(runNow)}`;
    const avatarMsg = `检测到账号「${displayName}」更换了新头像！新旧头像均已永久保存至本地库（${estWin}）。`;

    pushComparison({
      dateKey,
      compareType: 'AVATAR_CHANGED',
      noteId: `avatar_${profile.userId}`,
      commentId: null,
      noteTitle: `账号头像更换（${profile.nickname}）`,
      authorNickname: formatNicknameWithRedId(profile.nickname, profile.redId),
      localSavedContent: `原头像本地存档：${oldAvatarPath || '无'}`,
      newContentIfEdited: `新头像本地存档：${localAvatar}`,
      localPhotoPaths: avatarPaths,
      notePublishTime: latestAvatarRec ? formatDateTime(latestAvatarRec.capturedAt) : '首次建档',
      commentPublishTime: null,
      firstCapturedTime: latestAvatarRec ? formatDateTime(latestAvatarRec.capturedAt) : formatDateTime(runNow),
      lastSeenAliveTime: prevProfile ? formatDateTime(prevProfile.capturedAt) : null,
      detectedChangeTime: formatDateTime(runNow),
      estimatedActionTimeText: estWin,
      survivalMinutes: null,
      summaryText: avatarMsg,
    });

    pushEvent({
      eventType: 'AVATAR_CHANGED',
      title: `【更换头像】${displayName}`,
      body: avatarMsg,
      level: 'timeSensitive',
      shouldPush: true,
      triggersBurst: true,
      isActivity: true,
      beforeSnapshot: { avatar: oldAvatarPath },
      afterSnapshot: { avatar: localAvatar },
    });
  }

  // 1.5 检测账号 IP 属地变化并归档到本地库 ip_history 与本地日志
  const cleanCurrentIp = profile.ipLocation;
  const latestIpRec = db.getLatestIpRecord(profile.userId, 'PROFILE');
  if (cleanCurrentIp) {
    if (!latestIpRec) {
      const savedBaseIp = db.insertIpRecord({
        userId: profile.userId,
        ipLocation: cleanCurrentIp,
        previousIp: null,
        source: 'PROFILE',
        noteId: null,
        estimatedChangeWindow: null,
        dateKey,
        capturedAt: runNow,
      });
      appendIpChangeLogFile(dateKey, {
        ...savedBaseIp,
        nickname: profile.nickname,
        redId: profile.redId,
        isChange: false,
      });
    } else if (latestIpRec.ipLocation !== cleanCurrentIp) {
      const ipWin = prevProfile
        ? estimateDeletionWindow(prevProfile.capturedAt, runNow).windowText.replace(
            '删除区间',
            '变更区间'
          )
        : `约 ${formatDateTime(runNow)}`;
      const savedIpChange = db.insertIpRecord({
        userId: profile.userId,
        ipLocation: cleanCurrentIp,
        previousIp: latestIpRec.ipLocation,
        source: 'PROFILE',
        noteId: null,
        estimatedChangeWindow: ipWin,
        dateKey,
        capturedAt: runNow,
      });
      appendIpChangeLogFile(dateKey, {
        ...savedIpChange,
        nickname: profile.nickname,
        redId: profile.redId,
        isChange: true,
      });

      if (!isBaselineRun) {
        const ipSummary = `账号「${displayName}」IP 属地由【${latestIpRec.ipLocation}】变更为【${cleanCurrentIp}】（${ipWin}）`;

        pushComparison({
          dateKey,
          compareType: 'IP_CHANGED',
          noteId: `ip_${profile.userId}`,
          commentId: null,
          noteTitle: `IP 属地变更：${latestIpRec.ipLocation} → ${cleanCurrentIp}`,
          authorNickname: formatNicknameWithRedId(profile.nickname, profile.redId),
          localSavedContent: latestIpRec.ipLocation,
          newContentIfEdited: cleanCurrentIp,
          localPhotoPaths: [],
          notePublishTime: formatDateTime(latestIpRec.capturedAt),
          commentPublishTime: null,
          firstCapturedTime: formatDateTime(latestIpRec.capturedAt),
          lastSeenAliveTime: prevProfile ? formatDateTime(prevProfile.capturedAt) : null,
          detectedChangeTime: formatDateTime(runNow),
          estimatedActionTimeText: ipWin,
          survivalMinutes: null,
          summaryText: ipSummary,
        });

        pushEvent({
          eventType: 'IP_CHANGED',
          title: `【IP属地变更】${displayName}：${latestIpRec.ipLocation} → ${cleanCurrentIp}`,
          body: ipSummary,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          beforeSnapshot: { ipLocation: latestIpRec.ipLocation, source: 'PROFILE' },
          afterSnapshot: { ipLocation: cleanCurrentIp, source: 'PROFILE' },
        });
      }
    }
  }

  // 1.6 检测账号名字、性别、个性签名（默认空白）变化并归档到本地库 profile_field_history 与日志
  const profileFieldSpecs: Array<{
    field: ProfileFieldKey;
    label: string;
    emptyDisplay: string;
    value: string;
    skipIfUnreliable: boolean;
    eventType: EventType;
    compareType: CompareType;
  }> = [
    {
      field: 'NICKNAME',
      label: '名字',
      emptyDisplay: '（未知）',
      value: profile.nickname,
      skipIfUnreliable: !profile.nickname || profile.nickname === '未知用户',
      eventType: 'NICKNAME_CHANGED',
      compareType: 'NICKNAME_CHANGED',
    },
    {
      field: 'GENDER',
      label: '性别',
      emptyDisplay: '（未设置）',
      value: profile.gender,
      skipIfUnreliable: false,
      eventType: 'GENDER_CHANGED',
      compareType: 'GENDER_CHANGED',
    },
    {
      field: 'BIO',
      label: '个性签名',
      emptyDisplay: '（空白）',
      value: profile.desc,
      skipIfUnreliable: false,
      eventType: 'BIO_CHANGED',
      compareType: 'BIO_CHANGED',
    },
  ];

  for (const spec of profileFieldSpecs) {
    if (spec.skipIfUnreliable) continue;
    const latestRec = db.getLatestProfileFieldRecord(profile.userId, spec.field);
    if (!latestRec) {
      const savedBase = db.insertProfileFieldRecord({
        userId: profile.userId,
        field: spec.field,
        oldValue: null,
        newValue: spec.value,
        estimatedChangeWindow: null,
        dateKey,
        capturedAt: runNow,
      });
      appendProfileChangeLogFile(dateKey, {
        ...savedBase,
        nickname: profile.nickname,
        redId: profile.redId,
        isChange: false,
      });
    } else if (latestRec.newValue !== spec.value) {
      const fieldWin = prevProfile
        ? estimateDeletionWindow(prevProfile.capturedAt, runNow).windowText.replace(
            '删除区间',
            '变更区间'
          )
        : `约 ${formatDateTime(runNow)}`;
      const savedChange = db.insertProfileFieldRecord({
        userId: profile.userId,
        field: spec.field,
        oldValue: latestRec.newValue,
        newValue: spec.value,
        estimatedChangeWindow: fieldWin,
        dateKey,
        capturedAt: runNow,
      });
      appendProfileChangeLogFile(dateKey, {
        ...savedChange,
        nickname: profile.nickname,
        redId: profile.redId,
        isChange: true,
      });

      if (!isBaselineRun) {
        const oldDisp = latestRec.newValue || spec.emptyDisplay;
        const newDisp = spec.value || spec.emptyDisplay;
        const fieldSummary = `账号「${displayName}」${spec.label}由【${truncateText(
          oldDisp,
          60
        )}】变更为【${truncateText(newDisp, 60)}】（${fieldWin}）`;

        pushComparison({
          dateKey,
          compareType: spec.compareType,
          noteId: `profile_${spec.field.toLowerCase()}_${profile.userId}`,
          commentId: null,
          noteTitle:
            spec.field === 'BIO'
              ? `个性签名变更（${profile.nickname}）`
              : `${spec.label}变更：${oldDisp} → ${newDisp}`,
          authorNickname: formatNicknameWithRedId(profile.nickname, profile.redId),
          localSavedContent: oldDisp,
          newContentIfEdited: newDisp,
          localPhotoPaths: [],
          notePublishTime: formatDateTime(latestRec.capturedAt),
          commentPublishTime: null,
          firstCapturedTime: formatDateTime(latestRec.capturedAt),
          lastSeenAliveTime: prevProfile ? formatDateTime(prevProfile.capturedAt) : null,
          detectedChangeTime: formatDateTime(runNow),
          estimatedActionTimeText: fieldWin,
          survivalMinutes: null,
          summaryText: fieldSummary,
        });

        pushEvent({
          eventType: spec.eventType,
          title:
            spec.field === 'BIO'
              ? `【个性签名变更】${displayName}`
              : `【${spec.label}变更】${displayName}：${oldDisp} → ${newDisp}`,
          body: fieldSummary,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          beforeSnapshot: { field: spec.field, value: latestRec.newValue },
          afterSnapshot: { field: spec.field, value: spec.value },
        });
      }
    }
  }

  if (!isBaselineRun && prevProfile) {
    if (prevProfile.followsNum !== profile.followsNum) {
      pushEvent({
        eventType: 'FOLLOWS_CHANGED',
        title: `【关注变动】${displayName}`,
        body: `关注数变化：${formatDiffDelta(
          prevProfile.followsNum,
          profile.followsNum,
          prevProfile.followsRaw,
          profile.followsRaw
        )}`,
        level: 'timeSensitive',
        shouldPush: true,
        triggersBurst: true,
        isActivity: true,
        beforeSnapshot: { follows: prevProfile.followsRaw },
        afterSnapshot: { follows: profile.followsRaw },
      });
    }

    if (prevProfile.fansNum !== profile.fansNum) {
      pushEvent({
        eventType: 'FANS_CHANGED',
        title: `【粉丝变动】${displayName}`,
        body: `粉丝数变化：${formatDiffDelta(
          prevProfile.fansNum,
          profile.fansNum,
          prevProfile.fansRaw,
          profile.fansRaw
        )}`,
        level: 'active',
        shouldPush: true,
        triggersBurst: false,
        isActivity: false,
        beforeSnapshot: { fans: prevProfile.fansRaw },
        afterSnapshot: { fans: profile.fansRaw },
      });
    }

    if (prevProfile.interactionNum !== profile.interactionNum) {
      pushEvent({
        eventType: 'INTERACTION_CHANGED',
        title: `【获赞与收藏变动】${displayName}`,
        body: `总获赞与收藏：${formatDiffDelta(
          prevProfile.interactionNum,
          profile.interactionNum,
          prevProfile.interactionRaw,
          profile.interactionRaw
        )}`,
        level: 'active',
        shouldPush: config.notifyOnLikeChange,
        triggersBurst: config.likeChangeTriggersBurst,
        isActivity: config.likeChangeTriggersBurst,
      });
    }
  }

  db.insertProfileSnapshot(profile, localAvatar, runNow);

  // 同步缓存本轮解析到的所有用户小红书号（含被监控作者本人及评论区用户），并自动回填历史评论
  const backfilledNoteIds = new Set<string>();
  if (profile.userId && profile.redId) {
    for (const nid of db.upsertUserRedId(profile.userId, profile.redId, profile.nickname)) {
      backfilledNoteIds.add(nid);
    }
  }
  for (const [uid, rid] of Object.entries(collectResult.resolvedUserRedIds || {})) {
    for (const nid of db.upsertUserRedId(uid, rid)) {
      backfilledNoteIds.add(nid);
    }
  }

  // 2. 处理本轮采集到的所有笔记（保存照片、对比新增与编辑）
  const incomingNotes = collectResult.notes || [];
  const seenNoteIds = new Set<string>();
  let totalCommentsProcessed = 0;

  for (const rawNote of incomingNotes) {
    const cleanNoteIp = normalizeIpLocation(
      rawNote.ipLocation || extractIpFromRenderedTimeText(rawNote.renderedTimeText)
    );
    const note: NoteSnapshot = {
      ...rawNote,
      ipLocation: cleanNoteIp,
    };
    seenNoteIds.add(note.noteId);
    const existing = db.getNote(note.noteId);
    const timeResolved = resolveNoteVerifiedTime(note, existing, runNowMs);
    const editResolved = resolveNoteEditTime(note, existing, runNowMs);
    const noteCommentsBundle = collectResult.noteComments?.get(note.noteId);

    // 永久保存高清图片与图文/评论 JSON 备份到 storage/photos/notes/<noteId>/
    const needSaveMedia =
      isBaselineRun ||
      !existing ||
      existing.localPhotoPaths.length === 0 ||
      note.detailLoaded;

    let localPhotos = existing?.localPhotoPaths || [];
    if (needSaveMedia) {
      const archived = await archiveNotePhotosAndMeta(note, {
        skipDownload,
        verifiedTimeText: timeResolved.verifiedText || undefined,
        lastEditedTimeText: editResolved.lastEditedTimeText || undefined,
        editCount: existing
          ? Math.max(existing.editCount, editResolved.lastEditedTimeText ? 1 : 0)
          : editResolved.lastEditedTimeText
          ? 1
          : 0,
        revisions: existing ? db.getNoteRevisions(note.noteId) : undefined,
        firstSeenAt: existing?.firstSeenAt || runNow,
        comments: noteCommentsBundle?.comments,
      });
      if (archived.length > 0) {
        localPhotos = archived;
      }
    }

    if (!existing) {
      // 全新入库的笔记（首次运行归档为存量基线；后续运行归为新发笔记！）
      const newRow: StoredNoteRow = {
        noteId: note.noteId,
        userId: profile.userId,
        xsecToken: note.xsecToken,
        title: note.title || '（无标题笔记）',
        desc: note.desc || '',
        noteType: note.noteType || 'normal',
        publishedAt: note.publishedAt,
        updatedAt: note.updatedAt,
        lastEditedAtMs: editResolved.lastEditedAtMs,
        lastEditedTimeText: editResolved.lastEditedTimeText,
        editCount: editResolved.lastEditedTimeText ? 1 : 0,
        firstRenderedTimeText: timeResolved.cleanRendered,
        latestRenderedTimeText: timeResolved.cleanRendered,
        verifiedPublishMs: timeResolved.verifiedMs,
        verifiedTimeText: timeResolved.verifiedText,
        ipLocation: note.ipLocation,
        likedRaw: note.likedRaw,
        likedNum: note.likedNum,
        collectedRaw: note.collectedRaw,
        collectedNum: note.collectedNum,
        commentRaw: note.commentRaw,
        commentNum: note.commentNum,
        coverUrl: note.coverUrl,
        imageUrls: note.imageUrls,
        localPhotoPaths: localPhotos,
        status: 'ACTIVE',
        missingStreak: 0,
        isBaseline: isBaselineRun,
        firstSeenAt: runNow,
        firstSeenDateKey: dateKey,
        lastSeenAt: runNow,
        deletedDetectedAt: null,
        estimatedDeletedAt: null,
        estimatedDeleteWindow: null,
      };
      db.upsertNote(newRow);
      db.recordNoteMetricPoint(note.noteId, note.likedNum, note.collectedNum, note.commentNum, runNow);

      if (!isBaselineRun) {
        const pubDisplay =
          timeResolved.verifiedText || timeResolved.cleanRendered || formatDateTime(runNow);
        pushEvent({
          eventType: 'NEW_NOTE',
          title: `【新发笔记】${displayName}：《${truncateText(newRow.title, 28)}》`,
          body: `发布时间：${pubDisplay} | 正文：${truncateText(
            newRow.desc || newRow.title,
            80
          )}（已备份 ${localPhotos.length} 张原图）`,
          noteId: note.noteId,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          afterSnapshot: {
            title: newRow.title,
            desc: newRow.desc,
            renderedTimeText: newRow.firstRenderedTimeText,
            localPhotoPaths: localPhotos,
          },
        });
      }
    } else {
      // 本地已存在该笔记：检查恢复可见、文案/标题修改、点赞收藏变化
      const wasDeleted = existing.status === 'DELETED';
      const mergedTitle = note.title || existing.title;
      const mergedDesc = note.detailLoaded ? note.desc : existing.desc;
      const mergedImages =
        note.detailLoaded && note.imageUrls.length > 0 ? note.imageUrls : existing.imageUrls;

      const titleChanged =
        Boolean(note.title) && Boolean(existing.title) && note.title.trim() !== existing.title.trim();
      const descChanged =
        note.detailLoaded &&
        existing.desc !== '' &&
        note.desc.trim() !== existing.desc.trim();
      const imagesCountChanged =
        note.detailLoaded &&
        existing.imageUrls.length > 1 &&
        note.imageUrls.length > 0 &&
        note.imageUrls.length !== existing.imageUrls.length;
      const prevNoteIp = normalizeIpLocation(existing.ipLocation);
      const noteIpChanged = Boolean(cleanNoteIp && prevNoteIp && cleanNoteIp !== prevNoteIp);

      if (!isBaselineRun && noteIpChanged) {
        const noteIpWin = estimateDeletionWindow(existing.lastSeenAt, runNow).windowText.replace(
          '删除区间',
          '变更区间'
        );
        const savedNoteIpRec = db.insertIpRecord({
          userId: profile.userId,
          ipLocation: cleanNoteIp,
          previousIp: prevNoteIp,
          source: 'NOTE',
          noteId: note.noteId,
          estimatedChangeWindow: noteIpWin,
          dateKey,
          capturedAt: runNow,
        });
        appendIpChangeLogFile(dateKey, {
          ...savedNoteIpRec,
          nickname: profile.nickname,
          redId: profile.redId,
          noteTitle: mergedTitle,
          isChange: true,
        });

        const noteIpSummary = `笔记《${mergedTitle}》IP 属地由【${prevNoteIp}】变更为【${cleanNoteIp}】（${noteIpWin}）`;
        pushComparison({
          dateKey,
          compareType: 'IP_CHANGED',
          noteId: note.noteId,
          commentId: null,
          noteTitle: `笔记 IP 属地变更：《${mergedTitle}》（${prevNoteIp} → ${cleanNoteIp}）`,
          authorNickname: formatNicknameWithRedId(profile.nickname, profile.redId),
          localSavedContent: prevNoteIp,
          newContentIfEdited: cleanNoteIp,
          localPhotoPaths: localPhotos,
          notePublishTime: formatStoredNotePublishTime(existing),
          commentPublishTime: null,
          firstCapturedTime: formatDateTime(existing.firstSeenAt),
          lastSeenAliveTime: formatDateTime(existing.lastSeenAt),
          detectedChangeTime: formatDateTime(runNow),
          estimatedActionTimeText: noteIpWin,
          survivalMinutes: null,
          summaryText: noteIpSummary,
        });

        pushEvent({
          eventType: 'IP_CHANGED',
          title: `【笔记IP属地变更】${displayName}：${prevNoteIp} → ${cleanNoteIp}`,
          body: noteIpSummary,
          noteId: note.noteId,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          beforeSnapshot: { ipLocation: prevNoteIp, source: 'NOTE', noteTitle: mergedTitle },
          afterSnapshot: { ipLocation: cleanNoteIp, source: 'NOTE', noteTitle: mergedTitle },
        });
      }

      if (!isBaselineRun && wasDeleted) {
        pushEvent({
          eventType: 'NOTE_RESTORED',
          title: `【笔记恢复可见】《${truncateText(mergedTitle, 28)}》`,
          body: `此前被标记删除/隐藏的笔记重新出现在主页`,
          noteId: note.noteId,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
        });
      }

      const contentChanged = titleChanged || descChanged || imagesCountChanged;
      const editDetected = contentChanged || editResolved.hasNewPlatformEdit;

      let nextLastEditedAtMs = editResolved.lastEditedAtMs;
      let nextLastEditedTimeText = editResolved.lastEditedTimeText;
      let nextEditCount = Math.max(
        existing.editCount,
        editResolved.lastEditedTimeText ? 1 : 0
      );

      // 若次日0点捕获到「编辑于 昨天 HH:mm」将先前的相对编辑时间精确化，同步回写最新一条编辑记录
      if (
        !isBaselineRun &&
        !editDetected &&
        editResolved.upgradedToExactClock &&
        editResolved.lastEditedAtMs &&
        editResolved.lastEditedTimeText
      ) {
        db.updateLatestRevisionEditTime(
          note.noteId,
          editResolved.lastEditedAtMs,
          editResolved.lastEditedTimeText,
          timeResolved.cleanRendered || note.renderedTimeText || ''
        );
        backfilledNoteIds.add(note.noteId);
      }

      if (!isBaselineRun && editDetected) {
        const editWindow = estimateDeletionWindow(existing.lastSeenAt, runNow);
        const editWindowText = editWindow.windowText.replace('删除区间', '修改区间');

        if (!nextLastEditedTimeText) {
          nextLastEditedAtMs = new Date(editWindow.midpointIso).getTime();
          nextLastEditedTimeText = editWindowText;
        }
        nextEditCount = existing.editCount + 1;

        const revisionRendered = timeResolved.cleanRendered || note.renderedTimeText || '';
        db.insertNoteRevision({
          noteId: note.noteId,
          oldTitle: existing.title,
          newTitle: mergedTitle,
          oldDesc: existing.desc,
          newDesc: mergedDesc,
          oldImages: existing.imageUrls,
          newImages: mergedImages,
          editedAtMs: nextLastEditedAtMs,
          editedTimeText: nextLastEditedTimeText,
          renderedTimeText: revisionRendered,
          estimatedEditWindow: editWindowText,
          changedAt: runNow,
        });
        backfilledNoteIds.add(note.noteId);

        const savedNotePubTime = formatStoredNotePublishTime(existing);
        const editActionText = editResolved.isEditedByPlatform
          ? `编辑时间：${nextLastEditedTimeText}（捕获：${formatDateTime(runNow)}）`
          : editWindowText;
        const editSummary = contentChanged
          ? `笔记《${mergedTitle}》（原发布：${savedNotePubTime}）检测到内容编辑，编辑时间：${nextLastEditedTimeText}。原存档：「${truncateText(
              `${existing.title} | ${existing.desc}`,
              80
            )}」 -> 修改后：「${truncateText(`${mergedTitle} | ${mergedDesc}`, 80)}」`
          : `笔记《${mergedTitle}》（原发布：${savedNotePubTime}）检测到重新编辑标记，编辑时间：${nextLastEditedTimeText}（标题与正文文字未变，可能修改了配图、封面、话题或位置）`;

        pushComparison({
          dateKey,
          compareType: 'NOTE_EDITED',
          noteId: note.noteId,
          commentId: null,
          noteTitle: mergedTitle,
          authorNickname: profile.nickname,
          localSavedContent: contentChanged
            ? `【原存档标题】${existing.title}\n【原存档正文】${existing.desc}`
            : `【编辑前时间】${existing.lastEditedTimeText || savedNotePubTime}\n【标题】${existing.title}\n【正文】${existing.desc}`,
          newContentIfEdited: contentChanged
            ? `【修改后标题】${mergedTitle}\n【修改后正文】${mergedDesc}`
            : `【最新编辑时间】${nextLastEditedTimeText}${
                revisionRendered ? `（页面显示：${revisionRendered}）` : ''
              }\n【标题】${mergedTitle}\n【正文】${mergedDesc}`,
          localPhotoPaths: localPhotos,
          notePublishTime: savedNotePubTime,
          commentPublishTime: null,
          firstCapturedTime: formatDateTime(existing.firstSeenAt),
          lastSeenAliveTime: formatDateTime(existing.lastSeenAt),
          detectedChangeTime: formatDateTime(runNow),
          estimatedActionTimeText: editActionText,
          survivalMinutes: null,
          summaryText: editSummary,
        });

        pushEvent({
          eventType: 'NOTE_UPDATED',
          title: `【修改笔记】${displayName}：《${truncateText(mergedTitle, 28)}》`,
          body: editSummary,
          noteId: note.noteId,
          level: 'timeSensitive',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          beforeSnapshot: {
            title: existing.title,
            desc: existing.desc,
            lastEditedTimeText: existing.lastEditedTimeText,
          },
          afterSnapshot: {
            title: mergedTitle,
            desc: mergedDesc,
            editedAtMs: nextLastEditedAtMs,
            editedTimeText: nextLastEditedTimeText,
          },
        });
      }

      if (
        !isBaselineRun &&
        (existing.likedNum !== note.likedNum ||
          (note.detailLoaded && existing.collectedNum !== note.collectedNum))
      ) {
        const likeDiff = formatDiffDelta(
          existing.likedNum,
          note.likedNum,
          existing.likedRaw,
          note.likedRaw
        );
        pushEvent({
          eventType: 'NOTE_LIKE_CHANGED',
          title: `【作品互动变化】《${truncateText(mergedTitle, 26)}》`,
          body: `点赞 ${likeDiff}${
            note.detailLoaded && existing.collectedNum !== note.collectedNum
              ? ` | 收藏 ${formatDiffDelta(
                  existing.collectedNum,
                  note.collectedNum,
                  existing.collectedRaw,
                  note.collectedRaw
                )}`
              : ''
          }`,
          noteId: note.noteId,
          level: 'active',
          shouldPush: config.notifyOnLikeChange,
          triggersBurst: config.likeChangeTriggersBurst,
          isActivity: config.likeChangeTriggersBurst,
        });
      }

      const updatedRow: StoredNoteRow = {
        ...existing,
        xsecToken: note.xsecToken || existing.xsecToken,
        title: mergedTitle,
        desc: mergedDesc,
        noteType: note.noteType || existing.noteType,
        publishedAt: note.publishedAt ?? existing.publishedAt,
        updatedAt: note.updatedAt ?? existing.updatedAt,
        lastEditedAtMs: nextLastEditedAtMs,
        lastEditedTimeText: nextLastEditedTimeText,
        editCount: nextEditCount,
        latestRenderedTimeText: timeResolved.cleanRendered || existing.latestRenderedTimeText,
        verifiedPublishMs: timeResolved.verifiedMs,
        verifiedTimeText: timeResolved.verifiedText,
        ipLocation: note.ipLocation || existing.ipLocation,
        likedRaw: note.likedRaw,
        likedNum: note.likedNum,
        collectedRaw: note.detailLoaded ? note.collectedRaw : existing.collectedRaw,
        collectedNum: note.detailLoaded ? note.collectedNum : existing.collectedNum,
        commentRaw: note.detailLoaded ? note.commentRaw : existing.commentRaw,
        commentNum: note.detailLoaded ? note.commentNum : existing.commentNum,
        coverUrl: note.coverUrl || existing.coverUrl,
        imageUrls: mergedImages,
        localPhotoPaths: localPhotos,
        status: 'ACTIVE',
        missingStreak: 0,
        lastSeenAt: runNow,
        deletedDetectedAt: null,
        estimatedDeletedAt: null,
        estimatedDeleteWindow: null,
      };
      db.upsertNote(updatedRow);
      db.recordNoteMetricPoint(
        note.noteId,
        updatedRow.likedNum,
        updatedRow.collectedNum,
        updatedRow.commentNum,
        runNow
      );
    }

    // 3. 处理该笔记的评论区（首次运行全量存档评论；后续运行对比评论出现与评论删除！）
    if (noteCommentsBundle) {
      const parentNote = db.getNote(note.noteId)!;
      const savedNotePubTime = formatStoredNotePublishTime(parentNote);
      const noteBaseMs =
        parentNote.verifiedPublishMs ??
        parentNote.publishedAt ??
        new Date(parentNote.firstSeenAt).getTime();

      const seenCommentIds = new Set<string>();

      for (const rawC of noteCommentsBundle.comments) {
        const c: CommentSnapshot = {
          ...rawC,
          ipLocation: normalizeIpLocation(
            rawC.ipLocation || extractIpFromRenderedTimeText(rawC.renderedTimeText)
          ),
        };
        totalCommentsProcessed++;
        seenCommentIds.add(c.commentId);
        const existingComment = db.getComment(c.commentId);
        const cTime = resolveCommentVerifiedTime(c, existingComment, runNowMs);
        const commentPhotos = await archiveCommentPhotos(
          note.noteId,
          c.commentId,
          c.pictureUrls,
          skipDownload
        );

        const resolvedUserRedId =
          c.userRedId ||
          existingComment?.userRedId ||
          db.getCachedRedId(c.userId);
        const resolvedTargetRedId =
          c.targetRedId ||
          existingComment?.targetRedId ||
          (c.targetUserId ? db.getCachedRedId(c.targetUserId) : '');

        if (c.userId && resolvedUserRedId) {
          db.upsertUserRedId(c.userId, resolvedUserRedId, c.nickname, c.userXsecToken || '');
        }

        const displayCommentAuthor = formatNicknameWithRedId(c.nickname, resolvedUserRedId);
        const displayTargetAuthor = c.targetNickname
          ? formatNicknameWithRedId(c.targetNickname, resolvedTargetRedId)
          : '';

        if (!existingComment) {
          const newCommentRow: StoredCommentRow = {
            commentId: c.commentId,
            noteId: note.noteId,
            parentId: c.parentId,
            userId: c.userId,
            userRedId: resolvedUserRedId,
            userXsecToken: c.userXsecToken || '',
            nickname: c.nickname,
            userAvatar: c.userAvatar,
            targetUserId: c.targetUserId || '',
            targetRedId: resolvedTargetRedId,
            targetNickname: c.targetNickname,
            content: c.content,
            pictureUrls: c.pictureUrls || [],
            localPhotoPaths: commentPhotos,
            createdAt: c.createdAt,
            firstRenderedTimeText: cTime.cleanRendered,
            latestRenderedTimeText: cTime.cleanRendered,
            verifiedCreatedMs: cTime.verifiedMs,
            verifiedTimeText: cTime.verifiedText,
            ipLocation: c.ipLocation,
            likeCountRaw: c.likeCountRaw,
            status: 'ACTIVE',
            isBaseline: isBaselineRun,
            firstSeenAt: runNow,
            firstSeenDateKey: dateKey,
            lastSeenAt: runNow,
            deletedDetectedAt: null,
            estimatedDeleteWindow: null,
          };
          db.upsertComment(newCommentRow);

          if (!isBaselineRun) {
            // 评论的出现：与本地已存储的笔记发布时间（含超过2天已不显示具体时分的老笔记本地存档时间）做对比记录！
            const parsedRel = parseXhsRenderedTimeText(c.renderedTimeText, runNowMs);
            const estCommentMs = cTime.verifiedMs ?? parsedRel.parsedMs ?? runNowMs;
            const afterNoteMinutes = Math.max(0, Math.round((estCommentMs - noteBaseMs) / 60_000));
            const commentTimeStr =
              cTime.verifiedText ||
              (cTime.cleanRendered
                ? `${cTime.cleanRendered}（推算约 ${formatDateTime(estCommentMs)}）`
                : formatDateTime(runNow));

            const replyPrefix = displayTargetAuthor ? `回复 @${displayTargetAuthor}：` : '';
            const compSummary = `在笔记《${parentNote.title}》（本地存档笔记时间：${savedNotePubTime}）下检测到 @${displayCommentAuthor} 新评论：「${replyPrefix}${truncateText(
              c.content,
              80
            )}」 | 评论时间：${commentTimeStr}（距原笔记发布已间隔 ${formatDurationMinutes(
              afterNoteMinutes
            )}）`;

            pushComparison({
              dateKey,
              compareType: 'COMMENT_APPEARED',
              noteId: note.noteId,
              commentId: c.commentId,
              noteTitle: parentNote.title,
              authorNickname: displayCommentAuthor,
              localSavedContent: `${replyPrefix}${c.content}`,
              newContentIfEdited: null,
              localPhotoPaths: commentPhotos,
              notePublishTime: savedNotePubTime,
              commentPublishTime: commentTimeStr,
              firstCapturedTime: formatDateTime(runNow),
              lastSeenAliveTime: null,
              detectedChangeTime: formatDateTime(runNow),
              estimatedActionTimeText: `评论出现于原笔记发布后 ${formatDurationMinutes(
                afterNoteMinutes
              )}（本地捕获时刻 ${formatDateTime(runNow)}）`,
              survivalMinutes: afterNoteMinutes,
              summaryText: compSummary,
            });

            pushEvent({
              eventType: 'NEW_COMMENT',
              title: `【新增评论】《${truncateText(parentNote.title, 20)}》-${displayCommentAuthor}`,
              body: compSummary,
              noteId: note.noteId,
              commentId: c.commentId,
              level: 'timeSensitive',
              shouldPush: true,
              triggersBurst: true,
              isActivity: true,
              afterSnapshot: {
                nickname: displayCommentAuthor,
                userRedId: resolvedUserRedId,
                content: c.content,
                commentTime: commentTimeStr,
                noteSavedPublishTime: savedNotePubTime,
              },
            });
          }
        } else {
          // 已存在的评论：更新最后存活时间、次日0点精确时间与小红书号
          db.upsertComment({
            ...existingComment,
            userId: c.userId || existingComment.userId,
            userRedId: resolvedUserRedId || existingComment.userRedId,
            userXsecToken: c.userXsecToken || existingComment.userXsecToken,
            nickname: c.nickname || existingComment.nickname,
            targetUserId: c.targetUserId || existingComment.targetUserId,
            targetRedId: resolvedTargetRedId || existingComment.targetRedId,
            content: c.content || existingComment.content,
            localPhotoPaths:
              commentPhotos.length > 0 ? commentPhotos : existingComment.localPhotoPaths,
            createdAt: c.createdAt ?? existingComment.createdAt,
            latestRenderedTimeText: cTime.cleanRendered || existingComment.latestRenderedTimeText,
            verifiedCreatedMs: cTime.verifiedMs,
            verifiedTimeText: cTime.verifiedText,
            ipLocation: c.ipLocation || existingComment.ipLocation,
            likeCountRaw: c.likeCountRaw || existingComment.likeCountRaw,
            status: 'ACTIVE',
            lastSeenAt: runNow,
            deletedDetectedAt: null,
            estimatedDeleteWindow: null,
          });
        }
      }

      // 检查已删除的评论（仅当本篇笔记评论列表完整抓取时比对，严防漏页误报）
      if (!isBaselineRun && noteCommentsBundle.isComplete) {
        const storedComments = db.getCommentsByNote(note.noteId);
        for (const oldC of storedComments) {
          if (oldC.status === 'ACTIVE' && !seenCommentIds.has(oldC.commentId)) {
            const delWindow = estimateDeletionWindow(oldC.lastSeenAt, runNow);
            const cBaseMs =
              oldC.verifiedCreatedMs ??
              oldC.createdAt ??
              new Date(oldC.firstSeenAt).getTime();
            const midMs = new Date(delWindow.midpointIso).getTime();
            const survivalMins = Math.max(0, Math.round((midMs - cBaseMs) / 60_000));
            const savedCommentTime = formatStoredCommentPublishTime(oldC);
            const oldAuthorDisplay = formatNicknameWithRedId(
              oldC.nickname,
              oldC.userRedId || db.getCachedRedId(oldC.userId)
            );

            db.upsertComment({
              ...oldC,
              status: 'DELETED',
              deletedDetectedAt: runNow,
              estimatedDeleteWindow: delWindow.windowText,
            });

            const delSummary = `笔记《${parentNote.title}》（笔记时间：${savedNotePubTime}）下 @${oldAuthorDisplay} 的评论已被删除！原评论时间：${savedCommentTime} | 大概删除时间：${
              delWindow.windowText
            }（存活约 ${formatDurationMinutes(survivalMins)}） | 本地备份评论原文：「${oldC.content}」`;

            pushComparison({
              dateKey,
              compareType: 'COMMENT_DELETED',
              noteId: note.noteId,
              commentId: oldC.commentId,
              noteTitle: parentNote.title,
              authorNickname: oldAuthorDisplay,
              localSavedContent: oldC.content,
              newContentIfEdited: null,
              localPhotoPaths: oldC.localPhotoPaths,
              notePublishTime: savedNotePubTime,
              commentPublishTime: savedCommentTime,
              firstCapturedTime: formatDateTime(oldC.firstSeenAt),
              lastSeenAliveTime: formatDateTime(oldC.lastSeenAt),
              detectedChangeTime: formatDateTime(runNow),
              estimatedActionTimeText: delWindow.windowText,
              survivalMinutes: survivalMins,
              summaryText: delSummary,
            });

            pushEvent({
              eventType: 'COMMENT_DELETED',
              title: `【删除评论】《${truncateText(parentNote.title, 20)}》-${oldAuthorDisplay}`,
              body: delSummary,
              noteId: note.noteId,
              commentId: oldC.commentId,
              level: 'critical',
              shouldPush: true,
              triggersBurst: true,
              isActivity: true,
              beforeSnapshot: {
                nickname: oldAuthorDisplay,
                userRedId: oldC.userRedId,
                content: oldC.content,
                commentTime: savedCommentTime,
                estimatedDeleteWindow: delWindow.windowText,
              },
            });
          }
        }
      }

      // 将最新带小红书号的完整评论列表同步写入该笔记本地文件夹的 笔记图文信息备份.json
      backfilledNoteIds.add(note.noteId);
    }
  }

  // 4. 检测删除笔记（推算删除笔记的大概时间，并与本地保存的笔记时间、图文照片进行完整对比）
  if (!isBaselineRun) {
    const confirmedUnavailable = new Set(collectResult.confirmedUnavailableNoteIds || []);
    const allStoredNotes = db.getAllNotes(profile.userId);

    for (const oldNote of allStoredNotes) {
      if (oldNote.status === 'DELETED') continue;
      if (seenNoteIds.has(oldNote.noteId)) continue;

      const isConfirmedGone =
        confirmedUnavailable.has(oldNote.noteId) ||
        (Boolean(collectResult.isFullCatalogScan) && oldNote.missingStreak + 1 >= 2);

      if (isConfirmedGone) {
        const delWindow = estimateDeletionWindow(oldNote.lastSeenAt, runNow);
        const pubBaseMs =
          oldNote.verifiedPublishMs ??
          oldNote.publishedAt ??
          new Date(oldNote.firstSeenAt).getTime();
        const midDelMs = new Date(delWindow.midpointIso).getTime();
        const survivalMins = Math.max(0, Math.round((midDelMs - pubBaseMs) / 60_000));
        const savedNotePubTime = formatStoredNotePublishTime(oldNote);
        const storedNoteComments = db.getCommentsByNote(oldNote.noteId);

        db.upsertNote({
          ...oldNote,
          status: 'DELETED',
          missingStreak: oldNote.missingStreak + 1,
          deletedDetectedAt: runNow,
          estimatedDeletedAt: delWindow.midpointIso,
          estimatedDeleteWindow: delWindow.windowText,
        });

        const delNoteSummary = `检测到笔记《${oldNote.title}》已被删除或设为私密！\n` +
          `• 本地存档笔记发布时间：${savedNotePubTime}\n` +
          `• 删除笔记的大概时间：${delWindow.windowText}\n` +
          `• 存活时长：约 ${formatDurationMinutes(survivalMins)}\n` +
          `• 本地已完整抢救备份：正文 ${oldNote.desc.length} 字、原图 ${oldNote.localPhotoPaths.length} 张、评论 ${storedNoteComments.length} 条`;

        pushComparison({
          dateKey,
          compareType: 'NOTE_DELETED',
          noteId: oldNote.noteId,
          commentId: null,
          noteTitle: oldNote.title,
          authorNickname: profile.nickname,
          localSavedContent: `【标题】${oldNote.title}\n【正文】${oldNote.desc}\n【本地已存档评论数】${storedNoteComments.length} 条`,
          newContentIfEdited: null,
          localPhotoPaths: oldNote.localPhotoPaths,
          notePublishTime: savedNotePubTime,
          commentPublishTime: null,
          firstCapturedTime: formatDateTime(oldNote.firstSeenAt),
          lastSeenAliveTime: formatDateTime(oldNote.lastSeenAt),
          detectedChangeTime: formatDateTime(runNow),
          estimatedActionTimeText: delWindow.windowText,
          survivalMinutes: survivalMins,
          summaryText: delNoteSummary,
        });

        pushEvent({
          eventType: 'NOTE_DELETED',
          title: `【删除笔记】${displayName}：《${truncateText(oldNote.title, 26)}》`,
          body: delNoteSummary.replace(/\n/g, ' | '),
          noteId: oldNote.noteId,
          level: 'critical',
          shouldPush: true,
          triggersBurst: true,
          isActivity: true,
          beforeSnapshot: {
            title: oldNote.title,
            desc: oldNote.desc,
            notePublishTime: savedNotePubTime,
            lastSeenAt: oldNote.lastSeenAt,
            estimatedDeleteWindow: delWindow.windowText,
            localPhotoPaths: oldNote.localPhotoPaths,
          },
        });
      } else if (collectResult.isFullCatalogScan) {
        // 首次缺席但详情未确认 404：标记为疑似消失（保持 lastSeenAt 不变以保证删除时间区间准确），触发 5 分钟高频复核
        db.upsertNote({
          ...oldNote,
          status: 'SUSPECTED_DELETED',
          missingStreak: oldNote.missingStreak + 1,
        });
        pushEvent({
          eventType: 'NOTE_SUSPECTED',
          title: `【疑似隐藏/删除待二次确认】《${truncateText(oldNote.title, 26)}》`,
          body: `全量主页目录未见该笔记，将在下一轮高频巡视二次核验（上次确认存活：${formatDateTime(
            oldNote.lastSeenAt
          )}）`,
          noteId: oldNote.noteId,
          level: 'active',
          shouldPush: false,
          triggersBurst: true,
          isActivity: true,
        });
      }
    }
  }

  // 同步刷新补齐了评论小红书号的本地 笔记图文信息备份.json 文件
  for (const nid of backfilledNoteIds) {
    const storedN = db.getNote(nid);
    if (!storedN) continue;
    const storedComms = db.getCommentsByNote(nid);
    await archiveNotePhotosAndMeta(
      {
        noteId: storedN.noteId,
        xsecToken: storedN.xsecToken,
        title: storedN.title,
        desc: storedN.desc,
        noteType: storedN.noteType,
        publishedAt: storedN.publishedAt,
        updatedAt: storedN.updatedAt,
        renderedTimeText: storedN.latestRenderedTimeText || storedN.firstRenderedTimeText,
        ipLocation: storedN.ipLocation,
        likedRaw: storedN.likedRaw,
        likedNum: storedN.likedNum,
        collectedRaw: storedN.collectedRaw,
        collectedNum: storedN.collectedNum,
        commentRaw: storedN.commentRaw,
        commentNum: storedN.commentNum,
        coverUrl: storedN.coverUrl,
        imageUrls: storedN.imageUrls,
        detailLoaded: true,
      },
      {
        skipDownload: true,
        verifiedTimeText: storedN.verifiedTimeText || undefined,
        lastEditedTimeText: storedN.lastEditedTimeText || undefined,
        editCount: storedN.editCount,
        revisions: db.getNoteRevisions(nid),
        firstSeenAt: storedN.firstSeenAt,
        comments: storedComms.map((sc) => ({
          commentId: sc.commentId,
          noteId: sc.noteId,
          parentId: sc.parentId,
          userId: sc.userId,
          userRedId: sc.userRedId,
          nickname: sc.nickname,
          userAvatar: sc.userAvatar,
          targetRedId: sc.targetRedId,
          targetNickname: sc.targetNickname,
          content: sc.content,
          createdAt: sc.createdAt,
          renderedTimeText: sc.latestRenderedTimeText || sc.firstRenderedTimeText,
          ipLocation: sc.ipLocation,
          likeCountRaw: sc.likeCountRaw,
        })),
      }
    );
  }

  // 5. 若为首次全量建档，标记基线完成并写入建档完成事件
  if (isBaselineRun) {
    db.markBaselineCompleted(profile.userId, runNow);
    const stats = db.getArchiveStats();
    pushEvent({
      eventType: 'BASELINE_READY',
      title: `【首次全量存档完成】${displayName}`,
      body: `已全量备份账号现有 ${incomingNotes.length} 篇笔记（含全部高清照片、原始发布时间）、${stats.totalComments} 条历史评论及初始 IP 属地基线（${
        cleanCurrentIp || '未显示'
      }）到本地 storage 仓库。后续任何删帖、改文、新评论、删评论、换头像与 IP 属地变化均将自动记录对比！`,
      level: 'timeSensitive',
      shouldPush: true,
      triggersBurst: false,
      isActivity: false,
    });
  }

  return {
    isBaselineRun,
    events: emittedEvents,
    comparisons: emittedComparisons,
    notesProcessed: incomingNotes.length,
    commentsProcessed: totalCommentsProcessed,
  };
}
