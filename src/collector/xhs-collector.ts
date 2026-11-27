import { chromium, type BrowserContext, type Page, type Response } from 'playwright-core';
import { BROWSER_PROFILE_DIR, ensureAllDirectories } from '../shared/paths.ts';
import type {
  AppConfig,
  CollectOptions,
  CollectResult,
  CommentSnapshot,
  NoteCommentsResult,
  NoteSnapshot,
  ProfileSnapshot,
} from '../shared/types.ts';
import {
  dedupeXhsImageUrls,
  extractIpFromRenderedTimeText,
  extractUserIdFromProfileUrl,
  normalizeIpLocation,
  normalizeProfileBio,
  normalizeProfileGender,
  normalizeProfileNickname,
  parseXhsCount,
} from '../shared/utils.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const randomBetween = (min: number, max: number) =>
  Math.floor(Math.random() * (max - min + 1)) + min;

/** 全局浏览器互斥锁，防止巡视与手动扫码登录同时争抢同一个持久化 Profile 目录 */
let browserBusy = false;

/**
 * 分层模式下的精准选帖逻辑：
 * - BASELINE / FULL_SCAN：检查主页全部笔记
 * - MIDNIGHT_RECONCILE：仅检查次日需复核的目标笔记
 * - PROFILE_LIGHT：默认只刷主页 1 页（0 篇详情）；若主页发现新笔记或某篇标题/点赞变化，仅进变动帖；
 *   若总赞藏变化但各篇点赞均未变（疑似收藏变化），转入全部笔记检查
 * - BURST_CHECK：检查「变动帖 + 除开变动帖外最新 N 篇（默认 4 篇）」
 */
export function selectNotesToInspect(params: {
  mode: CollectOptions['mode'];
  catalogNotes: NoteSnapshot[];
  knownNoteSnapshots?: Record<string, { title: string; likedNum: number }>;
  knownProfileInteractionNum?: number | null;
  currentProfileInteractionNum?: number;
  priorityInspectNoteIds?: string[];
  burstExtraRecentNotesCount?: number;
}): { inspectIds: Set<string>; detectedChangedIds: string[]; escalatedToFull: boolean } {
  const {
    mode,
    catalogNotes,
    knownNoteSnapshots,
    knownProfileInteractionNum,
    currentProfileInteractionNum,
    priorityInspectNoteIds,
    burstExtraRecentNotesCount = 4,
  } = params;

  const catalogIdSet = new Set(catalogNotes.map((n) => n.noteId));
  const changedIds = new Set<string>();

  for (const id of priorityInspectNoteIds || []) {
    if (catalogIdSet.has(id)) changedIds.add(id);
  }

  if (knownNoteSnapshots && Object.keys(knownNoteSnapshots).length > 0) {
    for (const n of catalogNotes) {
      const prev = knownNoteSnapshots[n.noteId];
      if (!prev) {
        changedIds.add(n.noteId);
        continue;
      }
      const titleChanged =
        Boolean(n.title) && Boolean(prev.title) && n.title.trim() !== prev.title.trim();
      const likeChanged = n.likedNum !== prev.likedNum;
      if (titleChanged || likeChanged) {
        changedIds.add(n.noteId);
      }
    }
  }

  if (mode === 'BASELINE' || mode === 'FULL_SCAN') {
    return {
      inspectIds: new Set(catalogNotes.map((n) => n.noteId)),
      detectedChangedIds: Array.from(changedIds),
      escalatedToFull: false,
    };
  }

  if (mode === 'MIDNIGHT_RECONCILE') {
    if (priorityInspectNoteIds && priorityInspectNoteIds.length > 0) {
      return {
        inspectIds: new Set(priorityInspectNoteIds.filter((id) => catalogIdSet.has(id))),
        detectedChangedIds: Array.from(changedIds),
        escalatedToFull: false,
      };
    }
    return {
      inspectIds: new Set(catalogNotes.map((n) => n.noteId)),
      detectedChangedIds: Array.from(changedIds),
      escalatedToFull: false,
    };
  }

  if (mode === 'PROFILE_LIGHT') {
    const interactionChanged =
      knownProfileInteractionNum !== null &&
      knownProfileInteractionNum !== undefined &&
      currentProfileInteractionNum !== undefined &&
      currentProfileInteractionNum !== knownProfileInteractionNum;

    if (interactionChanged && changedIds.size === 0) {
      // 主页总赞藏变了但各卡片点赞都没变（可能是收藏数或隐藏变动），本轮自动升级检查全部笔记
      return {
        inspectIds: new Set(catalogNotes.map((n) => n.noteId)),
        detectedChangedIds: [],
        escalatedToFull: true,
      };
    }

    return {
      inspectIds: new Set(changedIds),
      detectedChangedIds: Array.from(changedIds),
      escalatedToFull: false,
    };
  }

  // BURST_CHECK：变动帖 + 除开变动帖外最新 N 篇（默认 3~5 篇）
  const inspectIds = new Set<string>(changedIds);
  const extraLimit = Math.max(0, burstExtraRecentNotesCount);
  let addedExtra = 0;
  for (const n of catalogNotes) {
    if (addedExtra >= extraLimit) break;
    if (!inspectIds.has(n.noteId)) {
      inspectIds.add(n.noteId);
      addedExtra++;
    }
  }
  return {
    inspectIds,
    detectedChangedIds: Array.from(changedIds),
    escalatedToFull: false,
  };
}

/**
 * 校验本地缓存，只挑选本轮评论中「本地库完全没有小红书号（且未标记 UNKNOWN）」的新评论者
 */
export function selectNewCommentUsersForRedId(params: {
  noteComments: Map<string, NoteCommentsResult>;
  knownUserRedIds: Record<string, string>;
  enabled: boolean;
  maxPerRun: number;
}): Array<[string, string]> {
  if (!params.enabled || params.maxPerRun <= 0) return [];
  const pending = new Map<string, string>();
  for (const [, bundle] of params.noteComments) {
    for (const c of bundle.comments) {
      if (!c.userId) continue;
      if (c.userRedId) {
        params.knownUserRedIds[c.userId] = c.userRedId;
        continue;
      }
      // 本地库已有小红书号或已标记 UNKNOWN，绝不重复访问对方主页
      if (params.knownUserRedIds[c.userId]) continue;
      const prevTok = pending.get(c.userId) || '';
      pending.set(c.userId, c.userXsecToken || prevTok);
    }
  }
  return Array.from(pending.entries()).slice(0, params.maxPerRun);
}

function normalizeUrl(u: unknown): string {
  const s = String(u || '').trim();
  if (!s) return '';
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('http://')) return s.replace(/^http:\/\//i, 'https://');
  return s;
}

function parseTimestampMs(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 秒级时间戳转毫秒
  return n < 10_000_000_000 ? Math.round(n * 1000) : Math.round(n);
}

function parseApiCommentItem(
  raw: Record<string, unknown>,
  fallbackNoteId: string,
  parentId: string | null = null
): { root: CommentSnapshot | null; subs: CommentSnapshot[] } {
  const commentId = String(raw.id || raw.comment_id || '').trim();
  if (!commentId) return { root: null, subs: [] };

  const noteId = String(raw.note_id || fallbackNoteId || '').trim();
  const userInfo = (raw.user_info || raw.userInfo || {}) as Record<string, unknown>;
  const targetComment = (raw.target_comment || raw.targetComment || {}) as Record<string, unknown>;
  const targetUser = (targetComment.user_info || targetComment.userInfo || {}) as Record<
    string,
    unknown
  >;

  const picturesRaw = Array.isArray(raw.pictures) ? raw.pictures : [];
  const pictureUrls: string[] = [];
  for (const p of picturesRaw) {
    if (p && typeof p === 'object') {
      const po = p as Record<string, unknown>;
      const u = normalizeUrl(
        po.url_default ||
          po.urlDefault ||
          (Array.isArray(po.info_list) && (po.info_list[0] as Record<string, unknown>)?.url) ||
          po.url
      );
      if (u) pictureUrls.push(u);
    }
  }

  const root: CommentSnapshot = {
    commentId,
    noteId,
    parentId,
    userId: String(userInfo.user_id || userInfo.userId || ''),
    userRedId: String(userInfo.red_id || userInfo.redId || ''),
    userXsecToken: String(userInfo.xsec_token || userInfo.xsecToken || ''),
    nickname: String(userInfo.nickname || '小红书用户'),
    userAvatar: normalizeUrl(userInfo.image || userInfo.avatar || ''),
    targetUserId: String(targetUser.user_id || targetUser.userId || ''),
    targetRedId: String(targetUser.red_id || targetUser.redId || ''),
    targetNickname: String(targetUser.nickname || ''),
    content: String(raw.content || '').trim(),
    pictureUrls,
    createdAt: parseTimestampMs(raw.create_time ?? raw.createTime ?? raw.time),
    renderedTimeText: '',
    ipLocation: normalizeIpLocation(raw.ip_location || raw.ipLocation || ''),
    likeCountRaw: parseXhsCount(raw.like_count ?? raw.likeCount ?? 0).raw,
  };

  const subs: CommentSnapshot[] = [];
  const rawSubs = Array.isArray(raw.sub_comments)
    ? raw.sub_comments
    : Array.isArray(raw.subComments)
    ? raw.subComments
    : [];
  for (const sub of rawSubs) {
    if (sub && typeof sub === 'object') {
      const parsedSub = parseApiCommentItem(sub as Record<string, unknown>, noteId, commentId);
      if (parsedSub.root) subs.push(parsedSub.root);
    }
  }

  return { root, subs };
}

export class XhsCollector {
  private config: AppConfig;

  constructor(config: AppConfig) {
    this.config = config;
  }

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  private async launchContext(forceHeaded = false): Promise<BrowserContext> {
    ensureAllDirectories();
    const useHeadless = forceHeaded ? false : Boolean(this.config.headless);
    const launchArgs = [
      '--disable-blink-features=AutomationControlled',
      '--no-default-browser-check',
      '--no-first-run',
      '--window-size=1366,880',
    ];
    if (useHeadless) {
      launchArgs.unshift('--headless=new');
    }

    const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      executablePath: this.config.chromeExecutablePath,
      headless: useHeadless,
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 880 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      args: launchArgs,
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      const w = window as unknown as Record<string, any>;
      if (!w.chrome) {
        w.chrome = { runtime: {} };
      }
    });

    return context;
  }

  /**
   * 打开可视化浏览器供用户扫码登录小红书，不主动破解任何验证码，人工完成后自动落盘登录态
   */
  async openLoginSession(
    maxWaitMinutes = 5,
    onProgress?: (msg: string) => void
  ): Promise<{ ok: boolean; message: string }> {
    if (browserBusy) {
      return { ok: false, message: '当前浏览器正在执行采集任务，请稍候再试' };
    }
    browserBusy = true;
    let context: BrowserContext | null = null;

    try {
      onProgress?.('正在启动 Chrome 浏览器打开小红书登录页...');
      context = await this.launchContext(true);
      const page = context.pages()[0] || (await context.newPage());
      const targetUrl = this.config.targetProfileUrl || 'https://www.xiaohongshu.com/explore';
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });

      onProgress?.(
        '请在弹出的 Chrome 窗口中扫码登录小红书；登录成功后请直接关闭该浏览器窗口即可完成保存...'
      );

      const deadline = Date.now() + maxWaitMinutes * 60_000;
      let loggedInDetected = false;
      let notifiedSuccess = false;

      while (Date.now() < deadline) {
        if (context.pages().length === 0 || page.isClosed()) {
          break;
        }
        try {
          const check = await page.evaluate(() => {
            const unwrap = (v: any): any => {
              if (!v || typeof v !== 'object') return v;
              if ('_rawValue' in v) return v._rawValue;
              if ('_value' in v) return v._value;
              return v;
            };
            const w = window as unknown as Record<string, any>;
            const userState = unwrap(w.__INITIAL_STATE__?.user) || {};
            const loggedInFlag = unwrap(userState.loggedIn);
            const info = unwrap(userState.userInfo) || {};
            const hasRealIdentity = Boolean(info && info.redId && !info.guest);
            const loginModal = document.querySelector('.login-container, .login-modal');
            const sideProfileLink = document.querySelector(
              '.user.side-bar-component, a[href*="/user/profile/"] .channel'
            );
            return {
              loggedIn:
                (loggedInFlag === true || (hasRealIdentity && Boolean(sideProfileLink))) &&
                !loginModal,
              nickname: String(info?.nickname || ''),
            };
          });

          if (check.loggedIn) {
            loggedInDetected = true;
            if (!notifiedSuccess) {
              notifiedSuccess = true;
              onProgress?.(
                `已检测到账号${check.nickname ? `「${check.nickname}」` : ''}登录成功！现在可以直接关闭弹出的浏览器窗口以保存会话。`
              );
            }
          }
        } catch {
          // 页面跳转期间忽略单次检测异常
        }
        await sleep(1500);
      }

      await context.close().catch(() => {});
      context = null;
      return {
        ok: true,
        message: loggedInDetected
          ? '登录状态已成功保存至本地 storage/browser-profile'
          : '浏览器已关闭，当前会话缓存已保存',
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      browserBusy = false;
    }
  }

  /**
   * 核心采集方法：
   * - BASELINE（首次运行）：全量下拉加载目标主页所有历史笔记 + 逐篇进入详情抓取高清多图、正文、全量评论与回复
   * - PATROL（常规/高频巡视）：主页巡检 + 新增/变动/近期前 N 篇详情与评论检查 + 消失笔记精准验删
   * - FULL_AUDIT（全量对账）：全量下拉全部笔记目录 + 校验删帖与旧帖新评
   * - MIDNIGHT_RECONCILE（次日0点复核）：专门刷新前一天发布的笔记与活跃评论，提取「昨天 HH:mm」精确时间
   */
  async collect(options: CollectOptions): Promise<CollectResult> {
    if (!this.config.targetProfileUrl) {
      return { status: 'ERROR', reason: '尚未配置目标小红书主页链接 (targetProfileUrl)' };
    }
    if (browserBusy) {
      return { status: 'ERROR', reason: '浏览器正在被占用（可能正在扫码登录或上一轮未结束）' };
    }

    browserBusy = true;
    let context: BrowserContext | null = null;

    try {
      options.onProgress?.(`正在启动浏览器（模式：${options.mode}）...`);
      context = await this.launchContext(false);
      const page = context.pages()[0] || (await context.newPage());

      // 网络拦截缓存池（严格限定仅收集被监控目标账号本人的笔记）
      const expectedTargetUid = extractUserIdFromProfileUrl(this.config.targetProfileUrl);
      let catalogPhaseFinished = false;
      const apiNotesMap = new Map<string, NoteSnapshot>();
      const apiNoteDetailMap = new Map<string, Partial<NoteSnapshot>>();
      const apiCommentsByNote = new Map<string, Map<string, CommentSnapshot>>();
      const rootCommentHasMoreMap = new Map<string, boolean>();
      let userPostedHasMore = true;

      const ensureCommentBucket = (noteId: string): Map<string, CommentSnapshot> => {
        let bucket = apiCommentsByNote.get(noteId);
        if (!bucket) {
          bucket = new Map();
          apiCommentsByNote.set(noteId, bucket);
        }
        return bucket;
      };

      const onResponse = async (res: Response) => {
        const url = res.url();
        if (!url.includes('/api/sns/web/')) return;
        if (res.status() !== 200) return;

        try {
          if (url.includes('/api/sns/web/v1/user_posted')) {
            // 主页目录扫描阶段结束后（如后续进入评论者主页提取小红书号时），绝不拦截保存他人笔记！
            if (catalogPhaseFinished) return;
            if (expectedTargetUid) {
              try {
                const uObj = new URL(url);
                const reqUid = uObj.searchParams.get('user_id') || '';
                if (reqUid && reqUid !== expectedTargetUid) return;
              } catch {
                // ignore
              }
            }

            const json = (await res.json()) as {
              success?: boolean;
              data?: { has_more?: boolean; notes?: Array<Record<string, any>> };
            };
            if (json?.data) {
              if (typeof json.data.has_more === 'boolean') {
                userPostedHasMore = json.data.has_more;
              }
              for (const item of json.data.notes || []) {
                const authorUid = String(item.user?.user_id || item.user?.userId || '').trim();
                if (expectedTargetUid && authorUid && authorUid !== expectedTargetUid) {
                  continue;
                }
                const noteId = String(item.note_id || item.id || '').trim();
                if (!noteId) continue;
                const liked = parseXhsCount(item.interact_info?.liked_count ?? 0);
                const coverUrl = normalizeUrl(
                  item.cover?.url_default ||
                    item.cover?.info_list?.[0]?.url ||
                    item.cover?.url ||
                    ''
                );
                const prev = apiNotesMap.get(noteId);
                apiNotesMap.set(noteId, {
                  noteId,
                  xsecToken: String(item.xsec_token || prev?.xsecToken || ''),
                  title: String(item.display_title || item.title || prev?.title || '').trim(),
                  desc: prev?.desc || '',
                  noteType: String(item.type || prev?.noteType || 'normal'),
                  publishedAt: prev?.publishedAt ?? parseTimestampMs(item.time),
                  updatedAt: prev?.updatedAt ?? parseTimestampMs(item.last_update_time),
                  renderedTimeText: prev?.renderedTimeText || '',
                  ipLocation: prev?.ipLocation || '',
                  likedRaw: liked.raw,
                  likedNum: liked.num,
                  collectedRaw: prev?.collectedRaw || '0',
                  collectedNum: prev?.collectedNum || 0,
                  commentRaw: prev?.commentRaw || '0',
                  commentNum: prev?.commentNum || 0,
                  coverUrl: coverUrl || prev?.coverUrl || '',
                  imageUrls: prev?.imageUrls || (coverUrl ? [coverUrl] : []),
                  detailLoaded: prev?.detailLoaded || false,
                });
              }
            }
          } else if (url.includes('/api/sns/web/v1/feed')) {
            const json = (await res.json()) as {
              data?: { items?: Array<{ id?: string; note_card?: Record<string, any> }> };
            };
            for (const item of json?.data?.items || []) {
              const card = item.note_card;
              const noteId = String(card?.note_id || item.id || '').trim();
              if (!noteId || !card) continue;

              const liked = parseXhsCount(card.interact_info?.liked_count ?? 0);
              const collected = parseXhsCount(card.interact_info?.collected_count ?? 0);
              const commentCnt = parseXhsCount(card.interact_info?.comment_count ?? 0);

              const imgs: string[] = [];
              for (const img of card.image_list || []) {
                const u = normalizeUrl(
                  img.url_default || img.info_list?.[0]?.url || img.url || ''
                );
                if (u) imgs.push(u);
              }

              apiNoteDetailMap.set(noteId, {
                noteId,
                title: String(card.title || '').trim(),
                desc: String(card.desc || '').trim(),
                noteType: String(card.type || 'normal'),
                publishedAt: parseTimestampMs(card.time),
                updatedAt: parseTimestampMs(card.last_update_time),
                ipLocation: normalizeIpLocation(card.ip_location || card.ipLocation || ''),
                likedRaw: liked.raw,
                likedNum: liked.num,
                collectedRaw: collected.raw,
                collectedNum: collected.num,
                commentRaw: commentCnt.raw,
                commentNum: commentCnt.num,
                coverUrl: imgs[0] || '',
                imageUrls: imgs,
                detailLoaded: true,
              });
            }
          } else if (
            url.includes('/api/sns/web/v2/comment/page') ||
            url.includes('/api/sns/web/v2/comment/sub/page')
          ) {
            const uObj = new URL(url);
            const queryNoteId = uObj.searchParams.get('note_id') || '';
            const queryRootId = uObj.searchParams.get('root_comment_id') || null;
            const json = (await res.json()) as {
              data?: { has_more?: boolean; comments?: Array<Record<string, unknown>> };
            };
            if (url.includes('/api/sns/web/v2/comment/page') && queryNoteId) {
              rootCommentHasMoreMap.set(queryNoteId, Boolean(json?.data?.has_more));
            }
            for (const rawC of json?.data?.comments || []) {
              const parsed = parseApiCommentItem(
                rawC,
                queryNoteId,
                url.includes('/sub/page') ? queryRootId : null
              );
              if (parsed.root && parsed.root.noteId) {
                const bucket = ensureCommentBucket(parsed.root.noteId);
                bucket.set(parsed.root.commentId, parsed.root);
                for (const sub of parsed.subs) {
                  bucket.set(sub.commentId, sub);
                }
              }
            }
          }
        } catch {
          // 忽略非 JSON 或局部解析错误
        }
      };

      page.on('response', onResponse);

      // 1. 访问目标用户个人主页
      options.onProgress?.('正在打开目标小红书主页...');
      await page.goto(this.config.targetProfileUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45_000,
      });
      await sleep(randomBetween(2200, 3400));

      // 2. 检测是否遇到登录弹窗或安全验证拦截（绝不自动绕过验证码，立即挂起通知人工处理）
      const authGate = await this.checkAuthOrCaptchaGate(page);
      if (authGate.blocked) {
        return {
          status: 'NEEDS_AUTH_OR_VERIFY',
          reason: authGate.reason,
        };
      }

      // 3. 提取账号主页资料与首屏笔记
      const initialProfileAndNotes = await this.extractProfileAndInitialNotes(page);
      if (!initialProfileAndNotes.profile || !initialProfileAndNotes.profile.userId) {
        const fallbackId = extractUserIdFromProfileUrl(this.config.targetProfileUrl);
        if (!fallbackId) {
          return {
            status: 'NEEDS_AUTH_OR_VERIFY',
            reason: '未能解析到目标账号资料，可能登录态已失效或触发访问限制，请扫码登录后重试',
          };
        }
      }

      for (const n of initialProfileAndNotes.notes) {
        if (!apiNotesMap.has(n.noteId)) {
          apiNotesMap.set(n.noteId, n);
        } else {
          const existing = apiNotesMap.get(n.noteId)!;
          if (!existing.xsecToken && n.xsecToken) existing.xsecToken = n.xsecToken;
          if (!existing.title && n.title) existing.title = n.title;
          if (!existing.coverUrl && n.coverUrl) existing.coverUrl = n.coverUrl;
        }
      }
      if (typeof initialProfileAndNotes.hasMore === 'boolean') {
        userPostedHasMore = initialProfileAndNotes.hasMore;
      }

      // 4. 下拉加载作品目录：始终完整下拉到底部，确保每轮扫描账号全部笔记！
      const needFullScroll = !(
        options.mode === 'MIDNIGHT_RECONCILE' && Boolean(options.priorityInspectNoteIds?.length)
      );
      const maxScrollSteps = needFullScroll ? 180 : 6;
      let unchangedRounds = 0;
      let prevCount = apiNotesMap.size;

      for (let step = 0; step < maxScrollSteps; step++) {
        if (!userPostedHasMore && step >= 1) break;

        await page.evaluate(() => {
          window.scrollBy({ top: Math.floor(window.innerHeight * 0.88), behavior: 'smooth' });
        });
        await sleep(randomBetween(950, 1650));

        // 同步扫描 DOM 中的笔记卡片补充 xsecToken 与基础信息
        const domCards = await this.extractVisibleNoteCardsFromDom(page);
        for (const c of domCards) {
          const prev = apiNotesMap.get(c.noteId);
          if (!prev) {
            apiNotesMap.set(c.noteId, c);
          } else {
            if (!prev.xsecToken && c.xsecToken) prev.xsecToken = c.xsecToken;
            if (!prev.title && c.title) prev.title = c.title;
            if (!prev.coverUrl && c.coverUrl) prev.coverUrl = c.coverUrl;
          }
        }

        const reachedBottom = await page.evaluate(() => {
          const endEl = document.querySelector('.feeds-end, .no-more, [class*="end-container"]');
          const atBottom =
            window.innerHeight + window.scrollY >= document.body.scrollHeight - 120;
          return Boolean(endEl) || atBottom;
        });

        if (apiNotesMap.size === prevCount) {
          unchangedRounds++;
        } else {
          unchangedRounds = 0;
          prevCount = apiNotesMap.size;
          options.onProgress?.(`已加载主页笔记 ${apiNotesMap.size} 篇...`);
        }

        if (!userPostedHasMore || (reachedBottom && unchangedRounds >= 2) || unchangedRounds >= 4) {
          break;
        }
      }

      const isFullCatalogScan =
        !userPostedHasMore ||
        (needFullScroll && unchangedRounds >= 2) ||
        apiNotesMap.size === 0;

      // 锁定目标账号本人的主页作品集合，后续访问任何评论者主页都不会污染此列表
      catalogPhaseFinished = true;
      const catalogNotes = Array.from(apiNotesMap.values());
      const targetNoteIdSet = new Set(catalogNotes.map((n) => n.noteId));

      // 5. 按三态分层规则选出本轮需要进详情页检查的笔记列表
      const selection = selectNotesToInspect({
        mode: options.mode,
        catalogNotes,
        knownNoteSnapshots: options.knownNoteSnapshots,
        knownProfileInteractionNum: options.knownProfileInteractionNum,
        currentProfileInteractionNum: initialProfileAndNotes.profile?.interactionNum,
        priorityInspectNoteIds: options.priorityInspectNoteIds,
        burstExtraRecentNotesCount:
          options.burstExtraRecentNotesCount ?? this.config.burstExtraRecentNotes,
      });
      const inspectIds = selection.inspectIds;

      // 6. 逐篇访问选中的笔记详情（轻量主页无变动时为 0 篇，只刷主页 1 页即结束）
      const noteComments = new Map<string, NoteCommentsResult>();
      const confirmedUnavailableNoteIds: string[] = [];
      let idx = 0;
      const totalToInspect = Array.from(inspectIds).filter((id) => apiNotesMap.has(id)).length;

      if (totalToInspect === 0) {
        options.onProgress?.('主页无新变动，本轮仅检查主页 1 页完成');
      }

      for (const note of catalogNotes) {
        if (!inspectIds.has(note.noteId)) continue;
        idx++;
        options.onProgress?.(
          `正在检查笔记 (${idx}/${totalToInspect})：《${note.title || note.noteId}》`
        );

        const detailRes = await this.inspectSingleNote(
          page,
          note,
          apiNoteDetailMap,
          apiCommentsByNote,
          rootCommentHasMoreMap,
          options.mode === 'BASELINE' ||
            options.mode === 'FULL_SCAN' ||
            options.mode === 'MIDNIGHT_RECONCILE'
        );

        if (detailRes.authBlocked) {
          return {
            status: 'NEEDS_AUTH_OR_VERIFY',
            reason: detailRes.reason || '访问笔记详情时触发登录或安全验证，请人工确认后继续',
          };
        }

        if (detailRes.unavailable) {
          confirmedUnavailableNoteIds.push(note.noteId);
          continue;
        }

        if (detailRes.updatedNote) {
          apiNotesMap.set(note.noteId, detailRes.updatedNote);
        }
        if (detailRes.commentsResult) {
          noteComments.set(note.noteId, detailRes.commentsResult);
        }

        if (idx < totalToInspect) {
          await sleep(randomBetween(2600, 4800));
        }
      }

      // 深度采集目标笔记结束后立即卸载网络响应监听器，彻底隔离后续访问评论者主页只读小红书号的操作
      page.off('response', onResponse);

      // 7. 先用本地库 user_red_id_cache 全量校验：已有小红书号（含 UNKNOWN）绝不再进对方主页，仅对全新评论者按需查询
      const cachedRedIds: Record<string, string> = { ...(options.knownUserRedIds || {}) };
      const resolvedUserRedIds: Record<string, string> = {};
      const authorProfile = initialProfileAndNotes.profile;
      if (authorProfile?.userId && authorProfile.redId) {
        cachedRedIds[authorProfile.userId] = authorProfile.redId;
        resolvedUserRedIds[authorProfile.userId] = authorProfile.redId;
      }

      const usersToQuery = selectNewCommentUsersForRedId({
        noteComments,
        knownUserRedIds: cachedRedIds,
        enabled: this.config.fetchCommentUserRedId !== false,
        maxPerRun: this.config.maxCommentUserQueriesPerRun ?? 5,
      });

      for (let i = 0; i < usersToQuery.length; i++) {
        const [uid, tok] = usersToQuery[i];
        options.onProgress?.(
          `正在补充新评论者的小红书号 (${i + 1}/${usersToQuery.length})...`
        );
        const redRes = await this.fetchCommentUserRedId(page, uid, tok);
        if (redRes.authBlocked) break;
        if (redRes.redId) {
          cachedRedIds[uid] = redRes.redId;
          resolvedUserRedIds[uid] = redRes.redId;
        } else if (redRes.notFound) {
          cachedRedIds[uid] = 'UNKNOWN';
          resolvedUserRedIds[uid] = 'UNKNOWN';
        }
        if (i < usersToQuery.length - 1) {
          await sleep(randomBetween(2000, 3600));
        }
      }

      // 将本地缓存与本轮新查到的小红书号统一回填到本轮抓取的评论快照中
      for (const [, bundle] of noteComments) {
        for (const c of bundle.comments) {
          if (c.userId && cachedRedIds[c.userId] && cachedRedIds[c.userId] !== 'UNKNOWN') {
            c.userRedId = cachedRedIds[c.userId];
          }
          if (
            c.targetUserId &&
            cachedRedIds[c.targetUserId] &&
            cachedRedIds[c.targetUserId] !== 'UNKNOWN'
          ) {
            c.targetRedId = cachedRedIds[c.targetUserId];
          }
        }
      }

      // 8. 针对主页目录中消失的本地已知存活笔记，逐一核验是否确实已被删除/隐藏
      if (options.mode !== 'BASELINE' && options.knownActiveNoteIds?.length) {
        const missingIds = options.knownActiveNoteIds.filter((id) => !apiNotesMap.has(id));
        for (const missingId of missingIds) {
          options.onProgress?.(`正在核验消失笔记状态 (${missingId})...`);
          const check = await this.verifyMissingNoteUnavailable(page, missingId);
          if (check === 'UNAVAILABLE') {
            confirmedUnavailableNoteIds.push(missingId);
          }
          await sleep(randomBetween(1800, 3200));
        }
      }

      const finalNotes = catalogNotes
        .map((n) => apiNotesMap.get(n.noteId) || n)
        .filter(
          (n) => targetNoteIdSet.has(n.noteId) && !confirmedUnavailableNoteIds.includes(n.noteId)
        );

      return {
        status: 'OK',
        isFullCatalogScan,
        profile: initialProfileAndNotes.profile!,
        notes: finalNotes,
        confirmedUnavailableNoteIds,
        noteComments,
        resolvedUserRedIds,
      };
    } catch (err) {
      return {
        status: 'ERROR',
        reason: err instanceof Error ? err.message : String(err),
      };
    } finally {
      if (context) {
        await context.close().catch(() => {});
      }
      browserBusy = false;
    }
  }

  private async checkAuthOrCaptchaGate(
    page: Page
  ): Promise<{ blocked: boolean; reason?: string }> {
    const url = page.url();
    if (url.includes('/website-login/captcha') || url.includes('/captcha')) {
      return {
        blocked: true,
        reason: '检测到小红书安全滑块/验证码页面，系统遵循安全规范不自动破解，请打开扫码登录窗口人工完成后恢复',
      };
    }

    const domCheck = await page.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      if (
        bodyText.includes('请完成下方验证后继续') ||
        bodyText.includes('安全限制') ||
        bodyText.includes('访问频次异常')
      ) {
        return { blocked: true, reason: '页面提示访问受限或需要完成人工安全验证' };
      }
      const userNameEl = document.querySelector('.user-name, .user-nickname');
      const loginModal = document.querySelector('.login-container, .login-modal');
      if (loginModal && !userNameEl) {
        return { blocked: true, reason: '检测到小红书登录拦截弹窗，请先扫码登录账号' };
      }
      return { blocked: false };
    });

    return domCheck;
  }

  private async extractProfileAndInitialNotes(page: Page): Promise<{
    profile: ProfileSnapshot | null;
    notes: NoteSnapshot[];
    hasMore?: boolean;
  }> {
    const raw = await page.evaluate((profileUrl: string) => {
      const unwrap = (v: any): any => {
        if (!v || typeof v !== 'object') return v;
        if ('_rawValue' in v) return v._rawValue;
        if ('_value' in v) return v._value;
        return v;
      };

      const w = window as unknown as Record<string, any>;
      const state = w.__INITIAL_STATE__ || {};
      const userState = unwrap(state.user) || {};
      const pageData = unwrap(userState.userPageData) || {};
      const basicInfo = unwrap(pageData.basicInfo) || {};
      const interactions = unwrap(pageData.interactions) || [];

      const urlMatch = profileUrl.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
      const fallbackUid = urlMatch ? urlMatch[1] : '';

      let followsRaw = '0';
      let fansRaw = '0';
      let interactionRaw = '0';

      if (Array.isArray(interactions)) {
        for (const item of interactions) {
          const t = item?.type;
          const cnt = String(item?.count ?? '0');
          if (t === 'follows') followsRaw = cnt;
          else if (t === 'fans') fansRaw = cnt;
          else if (t === 'interaction') interactionRaw = cnt;
        }
      }

      // DOM 兜底读取主页资料
      const domNickname =
        document.querySelector('.user-name')?.textContent?.trim() || '';
      const domRedId =
        document
          .querySelector('.user-redId')
          ?.textContent?.replace(/小红书号[：:\s]*/g, '')
          .trim() || '';
      let domIp =
        document
          .querySelector('.user-IP, [class*="user-IP"], [class*="ip-location"]')
          ?.textContent?.replace(/IP\s*属地[：:\s]*/gi, '')
          .trim() || '';
      if (!domIp) {
        const infoText =
          document.querySelector('.user-info, .info-part, .basic-info')?.textContent || '';
        const ipMatch = infoText.match(/IP\s*属地[：:\s]*([^\s|·\n]+)/i);
        if (ipMatch && ipMatch[1]) {
          domIp = ipMatch[1].trim();
        }
      }
      const domDesc =
        document.querySelector('.user-desc')?.textContent?.trim() || '';
      const domAvatar =
        (document.querySelector('.avatar-wrapper img, .user-image') as HTMLImageElement | null)
          ?.src || '';

      // 提取性别：优先检查 DOM 性别图标与 userPageData.tags（最明确），其次回退 basicInfo.gender
      let domGender = '';
      const genderNodes = Array.from(
        document.querySelectorAll('.user-tags .gender, .user-tags svg use, .user-tags img, [class*="gender"]')
      );
      for (const el of genderNodes) {
        const ref = (
          (el.getAttribute('xlink:href') || '') +
          ' ' +
          (el.getAttribute('href') || '') +
          ' ' +
          (el.getAttribute('src') || '') +
          ' ' +
          (el.getAttribute('class') || '') +
          ' ' +
          (el.textContent || '')
        ).toLowerCase();
        if (ref.includes('female') || ref.includes('女')) {
          domGender = '女';
          break;
        }
        if (ref.includes('male') || ref.includes('男')) {
          domGender = '男';
          break;
        }
      }

      let tagGender = '';
      const tags = unwrap(pageData.tags) || unwrap(basicInfo.tags) || [];
      if (Array.isArray(tags)) {
        for (const t of tags) {
          const iconStr = String(t?.icon || '').toLowerCase();
          const nameStr = String(t?.name || '').trim().toLowerCase();
          if (iconStr.includes('female') || nameStr === '女' || nameStr === 'female') {
            tagGender = '女';
            break;
          }
          if (iconStr.includes('male') || nameStr === '男' || nameStr === 'male') {
            tagGender = '男';
            break;
          }
        }
      }

      if (followsRaw === '0' && fansRaw === '0') {
        const dataItems = Array.from(document.querySelectorAll('.user-interactions > div'));
        for (const el of dataItems) {
          const txt = el.textContent || '';
          const countEl = el.querySelector('.count')?.textContent?.trim() || '0';
          if (txt.includes('关注')) followsRaw = countEl;
          else if (txt.includes('粉丝')) fansRaw = countEl;
          else if (txt.includes('获赞')) interactionRaw = countEl;
        }
      }

      // 提取 __INITIAL_STATE__.user.notes 中的首屏笔记
      const rawNotesRoot = unwrap(userState.notes);
      const flatStateNotes: any[] = Array.isArray(rawNotesRoot)
        ? rawNotesRoot.flatMap((g: any) => (Array.isArray(unwrap(g)) ? unwrap(g) : [unwrap(g)]))
        : [];

      const extractedNotes: Array<{
        noteId: string;
        xsecToken: string;
        title: string;
        noteType: string;
        coverUrl: string;
        likedRaw: string;
      }> = [];

      for (const entry of flatStateNotes) {
        const card = entry?.noteCard || entry;
        const id = String(entry?.id || card?.noteId || card?.note_id || '').trim();
        if (!id) continue;
        extractedNotes.push({
          noteId: id,
          xsecToken: String(entry?.xsecToken || card?.xsecToken || card?.xsec_token || ''),
          title: String(card?.displayTitle || card?.display_title || card?.title || '').trim(),
          noteType: String(card?.type || 'normal'),
          coverUrl: String(
            card?.cover?.urlDefault ||
              card?.cover?.url_default ||
              card?.cover?.infoList?.[0]?.url ||
              ''
          ),
          likedRaw: String(
            card?.interactInfo?.likedCount ?? card?.interact_info?.liked_count ?? '0'
          ),
        });
      }

      return {
        userId: String(basicInfo.userId || basicInfo.user_id || fallbackUid || ''),
        redId: String(basicInfo.redId || basicInfo.red_id || domRedId || ''),
        nickname: String(basicInfo.nickname || domNickname || '未知用户'),
        gender: domGender || tagGender || (basicInfo.gender ?? ''),
        avatar: String(basicInfo.imageb || basicInfo.images || domAvatar || ''),
        desc:
          basicInfo.desc !== undefined && basicInfo.desc !== null
            ? String(basicInfo.desc)
            : domDesc,
        ipLocation: String(basicInfo.ipLocation || basicInfo.ip_location || domIp || ''),
        followsRaw,
        fansRaw,
        interactionRaw,
        extractedNotes,
      };
    }, this.config.targetProfileUrl);

    const domCards = await this.extractVisibleNoteCardsFromDom(page);
    const mergedMap = new Map<string, NoteSnapshot>();

    for (const item of raw.extractedNotes) {
      const liked = parseXhsCount(item.likedRaw);
      const cover = normalizeUrl(item.coverUrl);
      mergedMap.set(item.noteId, {
        noteId: item.noteId,
        xsecToken: item.xsecToken,
        title: item.title,
        desc: '',
        noteType: item.noteType,
        publishedAt: null,
        updatedAt: null,
        renderedTimeText: '',
        ipLocation: '',
        likedRaw: liked.raw,
        likedNum: liked.num,
        collectedRaw: '0',
        collectedNum: 0,
        commentRaw: '0',
        commentNum: 0,
        coverUrl: cover,
        imageUrls: cover ? [cover] : [],
        detailLoaded: false,
      });
    }

    for (const dc of domCards) {
      const existing = mergedMap.get(dc.noteId);
      if (!existing) {
        mergedMap.set(dc.noteId, dc);
      } else {
        if (!existing.xsecToken && dc.xsecToken) existing.xsecToken = dc.xsecToken;
        if (!existing.title && dc.title) existing.title = dc.title;
        if (!existing.coverUrl && dc.coverUrl) existing.coverUrl = dc.coverUrl;
      }
    }

    const follows = parseXhsCount(raw.followsRaw);
    const fans = parseXhsCount(raw.fansRaw);
    const inter = parseXhsCount(raw.interactionRaw);

    const profile: ProfileSnapshot | null = raw.userId
      ? {
          userId: raw.userId,
          redId: raw.redId,
          nickname: normalizeProfileNickname(raw.nickname) || '未知用户',
          gender: normalizeProfileGender(raw.gender),
          avatar: normalizeUrl(raw.avatar),
          desc: normalizeProfileBio(raw.desc),
          ipLocation: normalizeIpLocation(raw.ipLocation),
          followsRaw: follows.raw,
          followsNum: follows.num,
          fansRaw: fans.raw,
          fansNum: fans.num,
          interactionRaw: inter.raw,
          interactionNum: inter.num,
        }
      : null;

    return {
      profile,
      notes: Array.from(mergedMap.values()),
    };
  }

  private async extractVisibleNoteCardsFromDom(page: Page): Promise<NoteSnapshot[]> {
    const rawCards = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('section.note-item'));
      const out: Array<{
        noteId: string;
        xsecToken: string;
        title: string;
        coverUrl: string;
        likedRaw: string;
        isVideo: boolean;
      }> = [];

      for (const sec of items) {
        const anchors = Array.from(sec.querySelectorAll('a[href]')) as HTMLAnchorElement[];
        let noteId = '';
        let xsecToken = '';

        for (const a of anchors) {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/(?:explore|user\/profile\/[^/]+)\/([a-zA-Z0-9]{16,32})/);
          if (m) {
            noteId = m[1];
            const qIdx = href.indexOf('?');
            if (qIdx >= 0) {
              const sp = new URLSearchParams(href.slice(qIdx + 1));
              xsecToken = sp.get('xsec_token') || xsecToken;
            }
          }
        }
        if (!noteId) continue;

        const title = sec.querySelector('.title span, .title')?.textContent?.trim() || '';
        const imgEl = sec.querySelector('img') as HTMLImageElement | null;
        const coverUrl = imgEl?.src || '';
        const likedRaw = sec.querySelector('.like-wrapper .count')?.textContent?.trim() || '0';
        const isVideo = Boolean(sec.querySelector('.play-icon'));

        out.push({ noteId, xsecToken, title, coverUrl, likedRaw, isVideo });
      }
      return out;
    });

    return rawCards.map((c) => {
      const liked = parseXhsCount(c.likedRaw);
      const cover = normalizeUrl(c.coverUrl);
      return {
        noteId: c.noteId,
        xsecToken: c.xsecToken,
        title: c.title,
        desc: '',
        noteType: c.isVideo ? 'video' : 'normal',
        publishedAt: null,
        updatedAt: null,
        renderedTimeText: '',
        ipLocation: '',
        likedRaw: liked.raw,
        likedNum: liked.num,
        collectedRaw: '0',
        collectedNum: 0,
        commentRaw: '0',
        commentNum: 0,
        coverUrl: cover,
        imageUrls: cover ? [cover] : [],
        detailLoaded: false,
      };
    });
  }

  private async inspectSingleNote(
    page: Page,
    baseNote: NoteSnapshot,
    apiNoteDetailMap: Map<string, Partial<NoteSnapshot>>,
    apiCommentsByNote: Map<string, Map<string, CommentSnapshot>>,
    rootCommentHasMoreMap: Map<string, boolean>,
    deepScrollAllComments: boolean
  ): Promise<{
    authBlocked?: boolean;
    unavailable?: boolean;
    reason?: string;
    updatedNote?: NoteSnapshot;
    commentsResult?: NoteCommentsResult;
  }> {
    const tokenPart = baseNote.xsecToken
      ? `?xsec_token=${encodeURIComponent(baseNote.xsecToken)}&xsec_source=pc_user`
      : '';
    const detailUrl = `https://www.xiaohongshu.com/explore/${baseNote.noteId}${tokenPart}`;

    await page.goto(detailUrl, { waitUntil: 'domcontentloaded', timeout: 35_000 });
    await sleep(randomBetween(1600, 2600));

    const gate = await this.checkAuthOrCaptchaGate(page);
    if (gate.blocked) {
      return { authBlocked: true, reason: gate.reason };
    }

    // 检查是否已删除或不可见
    const curUrl = page.url();
    if (curUrl.includes('/404')) {
      return { unavailable: true };
    }

    const domDetail = await page.evaluate((noteId: string) => {
      const unwrap = (v: any): any => {
        if (!v || typeof v !== 'object') return v;
        if ('_rawValue' in v) return v._rawValue;
        if ('_value' in v) return v._value;
        return v;
      };

      const bodyTxt = document.body?.innerText || '';
      if (
        bodyTxt.includes('当前笔记暂时无法浏览') ||
        bodyTxt.includes('笔记不见了') ||
        bodyTxt.includes('该内容已删除')
      ) {
        return { unavailable: true };
      }

      const w = window as unknown as Record<string, any>;
      const noteMap = unwrap(w.__INITIAL_STATE__?.note?.noteDetailMap) || {};
      const detailEntry = unwrap(noteMap[noteId]) || {};
      const stateNote = unwrap(detailEntry.note) || {};

      const domTitle =
        document.querySelector('#detail-title, .note-content .title')?.textContent?.trim() || '';
      const domDesc =
        document.querySelector('#detail-desc, .note-content .desc')?.textContent?.trim() || '';
      const domDateText =
        document
          .querySelector('.bottom-container .date, .note-content .date')
          ?.textContent?.replace(/\s+/g, ' ')
          .trim() || '';
      const domNoteIp =
        document
          .querySelector('.bottom-container .ip, .note-content .ip, [class*="ip-location"]')
          ?.textContent?.replace(/IP\s*属地[：:\s]*/gi, '')
          .trim() || '';

      const domLike =
        document
          .querySelector('.interact-container .like-wrapper .count')
          ?.textContent?.trim() || '';
      const domCollect =
        document
          .querySelector('.interact-container .collect-wrapper .count')
          ?.textContent?.trim() || '';
      const domComment =
        document
          .querySelector('.interact-container .chat-wrapper .count')
          ?.textContent?.trim() || '';

      const stateImgs: string[] = [];
      for (const img of stateNote.imageList || []) {
        const u = img?.urlDefault || img?.url_default || img?.infoList?.[0]?.url || img?.url || '';
        if (u) stateImgs.push(String(u));
      }
      if (stateImgs.length === 0) {
        const slideImgs = Array.from(
          document.querySelectorAll('.swiper-slide:not(.swiper-slide-duplicate) img, .media-container img')
        ) as HTMLImageElement[];
        for (const el of slideImgs) {
          if (el.src) stateImgs.push(el.src);
        }
      }

      return {
        unavailable: false,
        title: String(stateNote.title || domTitle || '').trim(),
        desc: String(stateNote.desc || domDesc || '').trim(),
        noteType: String(stateNote.type || ''),
        time: stateNote.time ?? null,
        lastUpdateTime: stateNote.lastUpdateTime ?? stateNote.last_update_time ?? null,
        ipLocation: String(stateNote.ipLocation || stateNote.ip_location || domNoteIp || ''),
        renderedTimeText: domDateText,
        likedRaw: String(stateNote.interactInfo?.likedCount ?? domLike ?? ''),
        collectedRaw: String(stateNote.interactInfo?.collectedCount ?? domCollect ?? ''),
        commentRaw: String(stateNote.interactInfo?.commentCount ?? domComment ?? ''),
        imageUrls: stateImgs,
      };
    }, baseNote.noteId);

    if (domDetail.unavailable) {
      return { unavailable: true };
    }

    // 滚动评论区并展开「展开 X 条回复」子评论
    const maxCommentScrolls = deepScrollAllComments ? 35 : 8;
    for (let s = 0; s < maxCommentScrolls; s++) {
      const scrollState = await page.evaluate(() => {
        const scroller =
          (document.querySelector('.note-scroller, .interaction-container') as HTMLElement | null) ||
          document.scrollingElement ||
          document.documentElement;
        scroller.scrollTop += 750;

        // 自动点击可见的「展开更多回复」按钮（每次最多点3个，避免过快）
        const showMoreBtns = Array.from(
          document.querySelectorAll('.show-more, [class*="show-more"]')
        ) as HTMLElement[];
        let clicked = 0;
        for (const btn of showMoreBtns) {
          const txt = btn.textContent || '';
          if ((txt.includes('展开') && txt.includes('回复')) || txt.includes('展开更多')) {
            btn.click();
            clicked++;
            if (clicked >= 3) break;
          }
        }

        const endMarker = document.querySelector('.end-container, .no-comments-text');
        return { clicked, hasEndMarker: Boolean(endMarker) };
      });

      await sleep(randomBetween(700, 1200));

      const apiHasMore = rootCommentHasMoreMap.get(baseNote.noteId);
      if (scrollState.hasEndMarker && scrollState.clicked === 0) break;
      if (apiHasMore === false && scrollState.clicked === 0 && s >= 1) break;
    }

    // 从 DOM 补充每条评论的页面渲染时间文本（如「昨天 21:40」/「12分钟前」）与主页链接中的 xsec_token
    const domComments = await page.evaluate((noteId: string) => {
      const items = Array.from(document.querySelectorAll('.comment-item'));
      const list: Array<{
        commentId: string;
        parentId: string | null;
        userId: string;
        userXsecToken: string;
        nickname: string;
        userAvatar: string;
        content: string;
        renderedTimeText: string;
        ipLocation: string;
        likeCountRaw: string;
      }> = [];

      for (const el of items) {
        const rawId = el.getAttribute('id') || '';
        const commentId = rawId.replace(/^comment-/, '').trim();
        if (!commentId) continue;

        const isSub = el.classList.contains('comment-item-sub');
        let parentId: string | null = null;
        if (isSub) {
          const parentContainer = el.closest('.parent-comment');
          const rootEl = parentContainer?.querySelector('.comment-item:not(.comment-item-sub)');
          if (rootEl) {
            parentId = (rootEl.getAttribute('id') || '').replace(/^comment-/, '').trim() || null;
          }
        }

        let userId = '';
        let userXsecToken = '';
        const userAnchor = el.querySelector(
          '.avatar a[href*="/user/profile/"], .author a[href*="/user/profile/"]'
        ) as HTMLAnchorElement | null;
        if (userAnchor) {
          const href = userAnchor.getAttribute('href') || '';
          const m = href.match(/\/user\/profile\/([a-zA-Z0-9]+)/);
          if (m) userId = m[1];
          const qIdx = href.indexOf('?');
          if (qIdx >= 0) {
            const sp = new URLSearchParams(href.slice(qIdx + 1));
            userXsecToken = sp.get('xsec_token') || '';
          }
        }

        const nickname = el.querySelector('.author .name, .name')?.textContent?.trim() || '用户';
        const avatarEl = el.querySelector('.avatar img') as HTMLImageElement | null;
        const content = el.querySelector('.content, .note-text')?.textContent?.trim() || '';
        const dateSpans = Array.from(el.querySelectorAll('.date span'));
        const renderedTimeText =
          dateSpans[0]?.textContent?.trim() ||
          el.querySelector('.date')?.textContent?.trim() ||
          '';
        const ipLocation = dateSpans[1]?.textContent?.trim() || '';
        const likeCountRaw = el.querySelector('.like .count')?.textContent?.trim() || '0';

        list.push({
          commentId,
          parentId,
          userId,
          userXsecToken,
          nickname,
          userAvatar: avatarEl?.src || '',
          content,
          renderedTimeText,
          ipLocation,
          likeCountRaw,
        });
      }

      const hasEndMarker = Boolean(
        document.querySelector('.end-container, .no-comments-text, .no-comments')
      );
      return { noteId, list, hasEndMarker };
    }, baseNote.noteId);

    // 合并网络 API 拦截评论与 DOM 渲染时间文本
    const bucket = apiCommentsByNote.get(baseNote.noteId) || new Map<string, CommentSnapshot>();
    for (const dc of domComments.list) {
      const normalizedDomIp = normalizeIpLocation(
        dc.ipLocation || extractIpFromRenderedTimeText(dc.renderedTimeText)
      );
      const existing = bucket.get(dc.commentId);
      if (existing) {
        if (dc.renderedTimeText) existing.renderedTimeText = dc.renderedTimeText;
        if (!existing.ipLocation && normalizedDomIp) existing.ipLocation = normalizedDomIp;
        if (!existing.userId && dc.userId) existing.userId = dc.userId;
        if (!existing.userXsecToken && dc.userXsecToken) existing.userXsecToken = dc.userXsecToken;
      } else {
        bucket.set(dc.commentId, {
          commentId: dc.commentId,
          noteId: baseNote.noteId,
          parentId: dc.parentId,
          userId: dc.userId,
          userXsecToken: dc.userXsecToken,
          nickname: dc.nickname,
          userAvatar: normalizeUrl(dc.userAvatar),
          targetNickname: '',
          content: dc.content,
          pictureUrls: [],
          createdAt: null,
          renderedTimeText: dc.renderedTimeText,
          ipLocation: normalizedDomIp,
          likeCountRaw: parseXhsCount(dc.likeCountRaw).raw,
        });
      }
    }

    const apiDetail = apiNoteDetailMap.get(baseNote.noteId);
    const liked = parseXhsCount(apiDetail?.likedRaw ?? domDetail.likedRaw ?? baseNote.likedRaw);
    const collected = parseXhsCount(
      apiDetail?.collectedRaw ?? domDetail.collectedRaw ?? baseNote.collectedRaw
    );
    const commentCnt = parseXhsCount(
      apiDetail?.commentRaw ?? domDetail.commentRaw ?? baseNote.commentRaw
    );

    const mergedImages = dedupeXhsImageUrls([
      ...(apiDetail?.imageUrls || []),
      ...(domDetail.imageUrls || []).map(normalizeUrl),
      baseNote.coverUrl,
    ]);

    const updatedNote: NoteSnapshot = {
      noteId: baseNote.noteId,
      xsecToken: baseNote.xsecToken,
      title: apiDetail?.title || domDetail.title || baseNote.title,
      desc: apiDetail?.desc ?? domDetail.desc ?? baseNote.desc,
      noteType: apiDetail?.noteType || domDetail.noteType || baseNote.noteType || 'normal',
      publishedAt: apiDetail?.publishedAt ?? parseTimestampMs(domDetail.time) ?? baseNote.publishedAt,
      updatedAt:
        apiDetail?.updatedAt ?? parseTimestampMs(domDetail.lastUpdateTime) ?? baseNote.updatedAt,
      renderedTimeText: domDetail.renderedTimeText || baseNote.renderedTimeText,
      ipLocation: normalizeIpLocation(
        apiDetail?.ipLocation ||
          domDetail.ipLocation ||
          extractIpFromRenderedTimeText(domDetail.renderedTimeText || '') ||
          baseNote.ipLocation
      ),
      likedRaw: liked.raw,
      likedNum: liked.num,
      collectedRaw: collected.raw,
      collectedNum: collected.num,
      commentRaw: commentCnt.raw,
      commentNum: commentCnt.num,
      coverUrl: mergedImages[0] || baseNote.coverUrl,
      imageUrls: mergedImages,
      detailLoaded: true,
    };

    const apiRootHasMore = rootCommentHasMoreMap.get(baseNote.noteId);
    const isComplete =
      updatedNote.commentNum === 0 ||
      domComments.hasEndMarker ||
      apiRootHasMore === false ||
      bucket.size >= updatedNote.commentNum;

    return {
      updatedNote,
      commentsResult: {
        noteId: baseNote.noteId,
        comments: Array.from(bucket.values()),
        isComplete,
      },
    };
  }

  private async fetchCommentUserRedId(
    page: Page,
    userId: string,
    xsecToken?: string
  ): Promise<{ redId?: string; authBlocked?: boolean; notFound?: boolean }> {
    try {
      const query = xsecToken
        ? `?xsec_token=${encodeURIComponent(xsecToken)}&xsec_source=pc_comment`
        : '';
      await page.goto(`https://www.xiaohongshu.com/user/profile/${userId}${query}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await sleep(randomBetween(900, 1400));

      const gate = await this.checkAuthOrCaptchaGate(page);
      if (gate.blocked) {
        return { authBlocked: true };
      }
      if (page.url().includes('/404')) {
        return { notFound: true };
      }

      const info = await page.evaluate(() => {
        const unwrap = (v: any): any => {
          if (!v || typeof v !== 'object') return v;
          if ('_rawValue' in v) return v._rawValue;
          if ('_value' in v) return v._value;
          return v;
        };
        const w = window as unknown as Record<string, any>;
        const basicInfo = unwrap(unwrap(w.__INITIAL_STATE__?.user)?.userPageData)?.basicInfo || {};
        const stateRedId = String(basicInfo.redId || basicInfo.red_id || '').trim();
        const domRedId =
          document
            .querySelector('.user-redId')
            ?.textContent?.replace(/小红书号[：:\s]*/g, '')
            .trim() || '';
        const bodyTxt = document.body?.innerText || '';
        const deactivated = bodyTxt.includes('该用户已注销') || bodyTxt.includes('账号已注销');
        return {
          redId: stateRedId || domRedId,
          deactivated,
        };
      });

      if (info.redId) {
        return { redId: info.redId };
      }
      if (info.deactivated) {
        return { notFound: true };
      }
      return {};
    } catch {
      return {};
    }
  }

  private async verifyMissingNoteUnavailable(
    page: Page,
    noteId: string
  ): Promise<'UNAVAILABLE' | 'ALIVE' | 'UNKNOWN'> {
    try {
      await page.goto(`https://www.xiaohongshu.com/explore/${noteId}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      await sleep(1200);
      if (page.url().includes('/404')) return 'UNAVAILABLE';
      const unavailable = await page.evaluate(() => {
        const txt = document.body?.innerText || '';
        return (
          txt.includes('当前笔记暂时无法浏览') ||
          txt.includes('笔记不见了') ||
          txt.includes('该内容已删除') ||
          txt.includes('暂时无法浏览')
        );
      });
      return unavailable ? 'UNAVAILABLE' : 'ALIVE';
    } catch {
      return 'UNKNOWN';
    }
  }
}
