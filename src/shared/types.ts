export interface AppConfig {
  /** 要监控的目标小红书个人主页完整链接 */
  targetProfileUrl: string;
  /** 目标备注名称（可选，留空自动使用昵称） */
  targetRemark: string;
  /** Bark Key 或完整链接 */
  barkKey: string;
  /** Bark 服务器地址，默认 https://api.day.app */
  barkServerUrl: string;
  /** Bark 通知分组名 */
  barkGroup: string;
  /** QQ 邮箱地址（发件并接收提醒，支持填 QQ 号自动补全 @qq.com） */
  qqMailUser: string;
  /** QQ 邮箱 16 位 SMTP 授权码 */
  qqMailAuthCode: string;
  /** 轻量主页模式间隔下限（分钟），默认 15 分钟 */
  lightCheckMinMinutes: number;
  /** 轻量主页模式间隔上限（分钟），默认 20 分钟 */
  lightCheckMaxMinutes: number;
  /** 定期全部笔记检查间隔下限（分钟），默认 50 分钟 */
  fullScanMinMinutes: number;
  /** 定期全部笔记检查间隔上限（分钟），默认 55 分钟 */
  fullScanMaxMinutes: number;
  /** 高频监控间隔下限（分钟），默认 5 分钟 */
  burstMinMinutes: number;
  /** 高频监控间隔上限（分钟），默认 10 分钟 */
  burstMaxMinutes: number;
  /** 高频监控连续无动静多少轮后恢复常态，默认 2 轮 */
  burstQuietChecksToRecover: number;
  /** 高频监控期间除变动帖外额外检查的最新笔记篇数，默认 4 篇（建议 3-5 篇） */
  burstExtraRecentNotes: number;
  /** 是否对全新评论者访问主页补充小红书号（本地库已有记录绝不重复访问） */
  fetchCommentUserRedId: boolean;
  /** 单轮最多查询多少个全新评论者的小红书号，默认 5 个 */
  maxCommentUserQueriesPerRun: number;
  /** 每次调度附加的自然随机浮动秒数上限 */
  randomJitterSeconds: number;
  /** 点赞/收藏变动时是否推送 Bark */
  notifyOnLikeChange: boolean;
  /** 点赞/收藏变动是否触发 5 分钟高频巡视 */
  likeChangeTriggersBurst: boolean;
  /**
   * 次日0点自动复核前一天具体时间并生成昨日汇总报告的时刻（HH:mm，默认 "00:02"）
   * 跨过 0 点后小红书会将前一天内容刷新为具体「昨天 HH:mm」时间，此时抓取并与当天记录时间对照最佳
   */
  nextDaySummaryTime: string;
  /** 当天本地记录捕获时间与小红书实际发布时间相差超过多少分钟时，标记为「需人工复查」，默认 40 分钟 */
  timeDiffReviewThresholdMinutes: number;
  /** 次日0点汇总报告生成后是否同步推送到手机 Bark */
  pushDailyReportToBark: boolean;
  /** 本地 Web 控制台端口，默认 3000 */
  port: number;
  /** 本机 Chrome 可执行文件路径 */
  chromeExecutablePath: string;
  /** 是否无头运行（建议保持 false 降低风控） */
  headless: boolean;
}

export interface ProfileSnapshot {
  userId: string;
  redId: string;
  nickname: string;
  gender: string;
  avatar: string;
  desc: string;
  ipLocation: string;
  followsRaw: string;
  followsNum: number;
  fansRaw: string;
  fansNum: number;
  interactionRaw: string;
  interactionNum: number;
}

export interface NoteSnapshot {
  noteId: string;
  xsecToken: string;
  title: string;
  desc: string;
  noteType: string;
  /** 接口返回或解析出的发布毫秒时间戳 */
  publishedAt: number | null;
  /** 接口返回或解析出的最后编辑毫秒时间戳 */
  updatedAt: number | null;
  /** 页面实际展示的时间文本（如 "3小时前" / "昨天 21:36" / "编辑于 昨天 22:10" / "11-20"） */
  renderedTimeText: string;
  ipLocation: string;
  likedRaw: string;
  likedNum: number;
  collectedRaw: string;
  collectedNum: number;
  commentRaw: string;
  commentNum: number;
  coverUrl: string;
  imageUrls: string[];
  detailLoaded: boolean;
}

export interface CommentSnapshot {
  commentId: string;
  noteId: string;
  parentId: string | null;
  userId: string;
  userRedId?: string;
  userXsecToken?: string;
  nickname: string;
  userAvatar: string;
  targetUserId?: string;
  targetRedId?: string;
  targetNickname: string;
  content: string;
  pictureUrls?: string[];
  createdAt: number | null;
  /** 页面展示的评论时间文本（如 "10分钟前" / "昨天 21:40" / "11-22"） */
  renderedTimeText: string;
  ipLocation: string;
  likeCountRaw: string;
}

export interface NoteCommentsResult {
  noteId: string;
  comments: CommentSnapshot[];
  isComplete: boolean;
}

export type CollectMode =
  | 'BASELINE'
  | 'PROFILE_LIGHT'
  | 'BURST_CHECK'
  | 'FULL_SCAN'
  | 'MIDNIGHT_RECONCILE';

export interface CollectOptions {
  mode: CollectMode;
  knownActiveNoteIds?: string[];
  /** 本地库中已知存活笔记的标题与点赞数，供轻量主页模式精准定位变动帖 */
  knownNoteSnapshots?: Record<string, { title: string; likedNum: number }>;
  /** 本地库最新记录的账号总获赞与收藏数（用于判断无单帖点赞变化时的隐藏变动） */
  knownProfileInteractionNum?: number | null;
  /** 优先需要检查详情的笔记 ID（例如高频期的变动帖、疑似删除帖、次日复核帖） */
  priorityInspectNoteIds?: string[];
  /** 高频模式下除变动帖外额外检查的最新笔记篇数 */
  burstExtraRecentNotesCount?: number;
  /** 本地库 user_red_id_cache 全量映射（含已标记 UNKNOWN），命中后绝不再访问对方主页 */
  knownUserRedIds?: Record<string, string>;
  onProgress?: (msg: string) => void;
}

export interface CollectResult {
  status: 'OK' | 'NEEDS_AUTH_OR_VERIFY' | 'ERROR';
  reason?: string;
  isFullCatalogScan?: boolean;
  profile?: ProfileSnapshot;
  notes?: NoteSnapshot[];
  confirmedUnavailableNoteIds?: string[];
  noteComments?: Map<string, NoteCommentsResult>;
  /** 本轮解析到的评论者 userId -> 小红书号(redId) 映射 */
  resolvedUserRedIds?: Record<string, string>;
}

export type EventType =
  | 'BASELINE_READY'
  | 'AVATAR_CHANGED'
  | 'IP_CHANGED'
  | 'NICKNAME_CHANGED'
  | 'GENDER_CHANGED'
  | 'BIO_CHANGED'
  | 'FOLLOWS_CHANGED'
  | 'FANS_CHANGED'
  | 'INTERACTION_CHANGED'
  | 'NEW_NOTE'
  | 'NOTE_UPDATED'
  | 'NOTE_SUSPECTED'
  | 'NOTE_DELETED'
  | 'NOTE_RESTORED'
  | 'NOTE_LIKE_CHANGED'
  | 'NEW_COMMENT'
  | 'COMMENT_DELETED'
  | 'DAILY_REPORT'
  | 'TIME_REVIEW_ALERT'
  | 'SYSTEM_ALERT';

export interface MonitorEvent {
  id?: number;
  eventType: EventType;
  title: string;
  body: string;
  noteId?: string;
  commentId?: string;
  level: 'active' | 'timeSensitive' | 'critical';
  shouldPush: boolean;
  triggersBurst: boolean;
  isActivity: boolean;
  beforeSnapshot?: Record<string, unknown>;
  afterSnapshot?: Record<string, unknown>;
  pushed?: boolean;
  pushError?: string;
  createdAt: string;
}

export type CompareType =
  | 'NOTE_DELETED'
  | 'NOTE_EDITED'
  | 'COMMENT_APPEARED'
  | 'COMMENT_DELETED'
  | 'AVATAR_CHANGED'
  | 'IP_CHANGED'
  | 'NICKNAME_CHANGED'
  | 'GENDER_CHANGED'
  | 'BIO_CHANGED';

export type ProfileFieldKey = 'NICKNAME' | 'GENDER' | 'BIO';

export interface ProfileFieldHistoryItem {
  id?: number;
  userId: string;
  field: ProfileFieldKey;
  oldValue: string | null;
  newValue: string;
  estimatedChangeWindow?: string | null;
  dateKey?: string;
  capturedAt: string;
}

export type IpHistorySource = 'PROFILE' | 'NOTE';

export interface IpHistoryItem {
  id?: number;
  userId: string;
  ipLocation: string;
  previousIp: string | null;
  source?: IpHistorySource;
  noteId?: string | null;
  estimatedChangeWindow?: string | null;
  dateKey?: string;
  capturedAt: string;
}

export interface AvatarHistoryItem {
  id?: number;
  userId: string;
  avatarKey: string;
  sha256: string;
  remoteUrl: string;
  localPath: string;
  capturedAt: string;
}

export interface ComparisonRecord {
  id?: number;
  dateKey: string;
  compareType: CompareType;
  noteId: string;
  commentId: string | null;
  noteTitle: string;
  authorNickname: string;
  /** 本地保存的原文内容（被删笔记全文 / 修改前全文 / 新增评论正文 / 被删评论正文） */
  localSavedContent: string;
  /** 若为修改笔记，修改后的新内容 */
  newContentIfEdited: string | null;
  /** 本地永久备份的图片路径 */
  localPhotoPaths: string[];
  /** 本地存档的笔记发布时间（含精确时间/次日复核时间/页面原始时间） */
  notePublishTime: string;
  /** 评论时间（新增评论或被删评论的时间，笔记事件为 null） */
  commentPublishTime: string | null;
  /** 本地首次捕获入库时间 */
  firstCapturedTime: string;
  /** 最后一次确认仍存活的时间（用于推算删除时间区间起点） */
  lastSeenAliveTime: string | null;
  /** 本次发现变动/删除/出现的时间 */
  detectedChangeTime: string;
  /** 删除笔记/评论的大概时间区间推算，或新评论距原笔记发布的间隔描述 */
  estimatedActionTimeText: string;
  /** 存活分钟数（删除类事件）或评论距笔记发布间隔分钟数（新评事件） */
  survivalMinutes: number | null;
  /** 人类可读的完整对比结论 */
  summaryText: string;
}

export type ReconciliationStatus =
  | 'MATCHED'
  | 'NEEDS_REVIEW'
  | 'DELETED_BEFORE_MIDNIGHT'
  | 'REVIEWED_OK';

export interface TimeReconciliationItem {
  id?: number;
  targetDateKey: string;
  itemType: 'NOTE' | 'COMMENT';
  targetId: string;
  noteId: string;
  titleOrExcerpt: string;
  authorNickname: string;
  /** 当天监控首次记录到本地的时间（ISO） */
  localRecordedAt: string;
  /** 当天首次捕获时平台返回的时间文本（如 "15分钟前"）及当天推算值 */
  sameDayPlatformTimeText: string;
  /** 当天首次捕获时推算或接口返回的毫秒时间戳 */
  sameDayEstimatedMs: number | null;
  /** 次日0点复核时平台展示的具体时间文本（如 "昨天 21:36 -> 2026-11-25 21:36:00"） */
  nextDayVerifiedTimeText: string;
  /** 次日复核确定的精确平台发布毫秒时间戳 */
  verifiedPlatformMs: number | null;
  /** 当天本地记录时间与次日复核精确发布时间的延迟差（分钟：localRecordedAt - verifiedPlatformMs） */
  captureDelayMinutes: number | null;
  /** 当天推算时间与次日复核精确时间的误差（分钟） */
  estimateErrorMinutes: number | null;
  /** 综合评估偏差分钟数（绝对值） */
  diffMinutes: number | null;
  status: ReconciliationStatus;
  anomalyReason: string;
  reviewNote: string;
  checkedAt: string;
  reviewedAt: string | null;
}

export interface NoteRevisionItem {
  id?: number;
  noteId: string;
  oldTitle: string;
  newTitle: string;
  oldDesc: string;
  newDesc: string;
  oldImages: string[];
  newImages: string[];
  editedAtMs: number | null;
  editedTimeText: string;
  renderedTimeText: string;
  estimatedEditWindow: string | null;
  changedAt: string;
}

export interface StoredNoteRow {
  noteId: string;
  userId: string;
  xsecToken: string;
  title: string;
  desc: string;
  noteType: string;
  publishedAt: number | null;
  updatedAt: number | null;
  lastEditedAtMs: number | null;
  lastEditedTimeText: string;
  editCount: number;
  firstRenderedTimeText: string;
  latestRenderedTimeText: string;
  verifiedPublishMs: number | null;
  verifiedTimeText: string;
  ipLocation: string;
  likedRaw: string;
  likedNum: number;
  collectedRaw: string;
  collectedNum: number;
  commentRaw: string;
  commentNum: number;
  coverUrl: string;
  imageUrls: string[];
  localPhotoPaths: string[];
  status: 'ACTIVE' | 'SUSPECTED_DELETED' | 'DELETED';
  missingStreak: number;
  isBaseline: boolean;
  firstSeenAt: string;
  firstSeenDateKey: string;
  lastSeenAt: string;
  deletedDetectedAt: string | null;
  estimatedDeletedAt: string | null;
  estimatedDeleteWindow: string | null;
}

export interface StoredCommentRow {
  commentId: string;
  noteId: string;
  parentId: string | null;
  userId: string;
  userRedId: string;
  userXsecToken: string;
  nickname: string;
  userAvatar: string;
  targetUserId: string;
  targetRedId: string;
  targetNickname: string;
  content: string;
  pictureUrls: string[];
  localPhotoPaths: string[];
  createdAt: number | null;
  firstRenderedTimeText: string;
  latestRenderedTimeText: string;
  verifiedCreatedMs: number | null;
  verifiedTimeText: string;
  ipLocation: string;
  likeCountRaw: string;
  status: 'ACTIVE' | 'DELETED';
  isBaseline: boolean;
  firstSeenAt: string;
  firstSeenDateKey: string;
  lastSeenAt: string;
  deletedDetectedAt: string | null;
  estimatedDeleteWindow: string | null;
}

export interface DailyAnalyticsReport {
  dateKey: string;
  generatedAt: string;
  isNextDayVerified: boolean;
  account: {
    userId: string;
    nickname: string;
    redId: string;
    followsStart: number;
    followsEnd: number;
    followsNet: number;
    followsChangeEvents: number;
    fansStart: number;
    fansEnd: number;
    fansNet: number;
    fansChangeEvents: number;
    interactionStart: number;
    interactionEnd: number;
    interactionNet: number;
    ipLocationStart?: string;
    ipLocationEnd?: string;
    ipChangeEvents?: number;
  };
  counts: {
    patrolRuns: number;
    totalActivityEvents: number;
    newNotes: number;
    updatedNotes: number;
    deletedNotes: number;
    newComments: number;
    deletedComments: number;
    likeChangeEvents: number;
    ipChanges?: number;
    profileFieldChanges?: number;
    timeCheckTotal: number;
    timeCheckMatched: number;
    timeCheckNeedsReview: number;
  };
  hourlyActivity: number[];
  peakHoursText: string;
  insights: string[];
  timeReconciliations: TimeReconciliationItem[];
  comparisonRecords: ComparisonRecord[];
  noteLeaderboard: Array<{
    noteId: string;
    title: string;
    status: string;
    publishTimeText: string;
    likedDelta: number;
    collectedDelta: number;
    newComments: number;
    deletedComments: number;
    currentLikes: string;
    currentCollects: string;
  }>;
  summaryText: string;
  markdownReportPath: string;
}

export type SchedulerMode =
  | 'IDLE'
  | 'NORMAL'
  | 'BURST'
  | 'RUNNING'
  | 'PAUSED_MANUAL'
  | 'PAUSED_AUTH';

export interface RuntimeStatus {
  mode: SchedulerMode;
  previousModeBeforeRun: 'NORMAL' | 'BURST';
  burstRemaining: number;
  isRunningNow: boolean;
  progressText: string;
  isBaselineDone: boolean;
  baselineCompletedAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  nextRunAt: string | null;
  nextRunKind: CollectMode | null;
  nextFullScanAt: string | null;
  nextRunDelayMs: number | null;
  serverNow: string;
  nextMidnightSummaryTime: string;
  lastReconciledDate: string | null;
  lastError: string | null;
  totalRuns: number;
  lastChangesCount: number;
}
