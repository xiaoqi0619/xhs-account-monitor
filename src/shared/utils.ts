import fs from 'node:fs';
import {
  ensureAllDirectories,
  EXAMPLE_CONFIG_PATH,
  LOCAL_CONFIG_PATH,
} from './paths.ts';
import type { AppConfig } from './types.ts';

function detectChromePath(): string {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
      : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

export const DEFAULT_CONFIG: AppConfig = {
  targetProfileUrl: '',
  targetRemark: '',
  barkKey: '',
  barkServerUrl: 'https://api.day.app',
  barkGroup: '小红书监控',
  qqMailUser: '',
  qqMailAuthCode: '',
  lightCheckMinMinutes: 15,
  lightCheckMaxMinutes: 20,
  fullScanMinMinutes: 50,
  fullScanMaxMinutes: 55,
  burstMinMinutes: 5,
  burstMaxMinutes: 10,
  burstQuietChecksToRecover: 2,
  burstExtraRecentNotes: 4,
  fetchCommentUserRedId: true,
  maxCommentUserQueriesPerRun: 5,
  randomJitterSeconds: 20,
  notifyOnLikeChange: true,
  likeChangeTriggersBurst: true,
  nextDaySummaryTime: '00:02',
  timeDiffReviewThresholdMinutes: 40,
  pushDailyReportToBark: true,
  port: 3000,
  chromeExecutablePath: detectChromePath(),
  headless: true,
};

export function normalizeBarkInput(
  rawKeyOrUrl: string,
  defaultServer = 'https://api.day.app'
): { serverUrl: string; deviceKey: string } {
  const trimmed = (rawKeyOrUrl || '').trim();
  if (!trimmed || trimmed.includes('在此填入')) {
    return { serverUrl: defaultServer.replace(/\/+$/, ''), deviceKey: '' };
  }

  // 兼容用户直接粘贴整行 curl 命令（如：curl -X GET "https://api.day.app/xxx/..."）
  const urlInTextMatch = trimmed.match(/https?:\/\/[^\s"'<>]+/i);
  const candidate = urlInTextMatch ? urlInTextMatch[0] : trimmed;

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const u = new URL(candidate);
      const segments = u.pathname.split('/').filter(Boolean);
      const keySeg = segments[0] || '';
      if (/^(YOUR_KEY|YOUR_BARK_KEY|KEY|push|register)$/i.test(keySeg)) {
        return { serverUrl: `${u.protocol}//${u.host}`, deviceKey: '' };
      }
      return {
        serverUrl: `${u.protocol}//${u.host}`,
        deviceKey: keySeg,
      };
    } catch {
      return { serverUrl: defaultServer.replace(/\/+$/, ''), deviceKey: '' };
    }
  }

  if (/^(YOUR_KEY|YOUR_BARK_KEY)$/i.test(trimmed)) {
    return { serverUrl: defaultServer.replace(/\/+$/, ''), deviceKey: '' };
  }

  return {
    serverUrl: (defaultServer || 'https://api.day.app').replace(/\/+$/, ''),
    deviceKey: trimmed.replace(/^\/+|\/+$/g, ''),
  };
}

function normalizeTimeHHMM(val: string | undefined, fallback = '00:02'): string {
  const m = String(val || '').trim().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return fallback;
  const hh = Math.min(23, Math.max(0, Number(m[1])));
  const mm = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function normalizeQqMailAddress(raw: string | undefined): string {
  const cleaned = String(raw || '').trim();
  if (!cleaned || cleaned.includes('在此填入')) return '';
  if (/^\d{5,13}$/.test(cleaned)) return `${cleaned}@qq.com`;
  return cleaned;
}

export function normalizeQqMailAuthCode(raw: string | undefined): string {
  const cleaned = String(raw || '')
    .replace(/\s+/g, '')
    .trim();
  if (!cleaned || cleaned.includes('在此填入')) return '';
  return cleaned;
}

export function loadConfig(): AppConfig {
  ensureAllDirectories();
  if (!fs.existsSync(LOCAL_CONFIG_PATH)) {
    fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    if (!fs.existsSync(EXAMPLE_CONFIG_PATH)) {
      fs.writeFileSync(EXAMPLE_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8');
    }
    return { ...DEFAULT_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(LOCAL_CONFIG_PATH, 'utf-8')) as Record<string, unknown>;
    const cleanRaw: Partial<AppConfig> = {};
    for (const key of Object.keys(DEFAULT_CONFIG) as Array<keyof AppConfig>) {
      if (raw[key] !== undefined) {
        (cleanRaw as Record<string, unknown>)[key] = raw[key];
      }
    }
    const merged: AppConfig = {
      ...DEFAULT_CONFIG,
      ...cleanRaw,
      nextDaySummaryTime: normalizeTimeHHMM(cleanRaw.nextDaySummaryTime, '00:02'),
    };
    merged.lightCheckMinMinutes = Math.max(1, Number(merged.lightCheckMinMinutes) || 15);
    merged.lightCheckMaxMinutes = Math.max(
      merged.lightCheckMinMinutes,
      Number(merged.lightCheckMaxMinutes) || Math.max(merged.lightCheckMinMinutes, 20)
    );
    merged.fullScanMinMinutes = Math.max(5, Number(merged.fullScanMinMinutes) || 50);
    merged.fullScanMaxMinutes = Math.max(
      merged.fullScanMinMinutes,
      Number(merged.fullScanMaxMinutes) || Math.max(merged.fullScanMinMinutes, 55)
    );
    merged.burstMinMinutes = Math.max(1, Number(merged.burstMinMinutes) || 5);
    merged.burstMaxMinutes = Math.max(
      merged.burstMinMinutes,
      Number(merged.burstMaxMinutes) || Math.max(merged.burstMinMinutes, 10)
    );
    merged.burstQuietChecksToRecover = Math.max(1, Number(merged.burstQuietChecksToRecover) || 2);
    merged.burstExtraRecentNotes = Math.max(0, Math.min(20, Number(merged.burstExtraRecentNotes ?? 4)));
    merged.fetchCommentUserRedId = true;
    merged.qqMailUser = normalizeQqMailAddress(merged.qqMailUser);
    merged.qqMailAuthCode = normalizeQqMailAuthCode(merged.qqMailAuthCode);
    merged.maxCommentUserQueriesPerRun = Math.max(
      0,
      Math.min(30, Number(merged.maxCommentUserQueriesPerRun ?? 5))
    );
    if (merged.targetProfileUrl.includes('在此填入')) {
      merged.targetProfileUrl = '';
    }
    if (!merged.chromeExecutablePath || !fs.existsSync(merged.chromeExecutablePath)) {
      merged.chromeExecutablePath = detectChromePath();
    }
    const parsedBark = normalizeBarkInput(merged.barkKey, merged.barkServerUrl);
    merged.barkKey = parsedBark.deviceKey;
    merged.barkServerUrl = parsedBark.serverUrl;
    return merged;
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(partial: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    ...current,
    ...partial,
  };
  const parsedBark = normalizeBarkInput(next.barkKey, next.barkServerUrl);
  next.barkKey = parsedBark.deviceKey;
  next.barkServerUrl = parsedBark.serverUrl;
  next.lightCheckMinMinutes = Math.max(1, Number(next.lightCheckMinMinutes) || 15);
  next.lightCheckMaxMinutes = Math.max(
    next.lightCheckMinMinutes,
    Number(next.lightCheckMaxMinutes) || next.lightCheckMinMinutes
  );
  next.fullScanMinMinutes = Math.max(5, Number(next.fullScanMinMinutes) || 50);
  next.fullScanMaxMinutes = Math.max(
    next.fullScanMinMinutes,
    Number(next.fullScanMaxMinutes) || next.fullScanMinMinutes
  );
  next.burstMinMinutes = Math.max(1, Number(next.burstMinMinutes) || 5);
  next.burstMaxMinutes = Math.max(
    next.burstMinMinutes,
    Number(next.burstMaxMinutes) || next.burstMinMinutes
  );
  next.burstQuietChecksToRecover = Math.max(1, Number(next.burstQuietChecksToRecover) || 2);
  next.burstExtraRecentNotes = Math.max(0, Math.min(20, Number(next.burstExtraRecentNotes ?? 4)));
  next.fetchCommentUserRedId = true;
  next.qqMailUser = normalizeQqMailAddress(next.qqMailUser);
  next.qqMailAuthCode = normalizeQqMailAuthCode(next.qqMailAuthCode);
  next.maxCommentUserQueriesPerRun = Math.max(
    0,
    Math.min(30, Number(next.maxCommentUserQueriesPerRun ?? 5))
  );
  next.timeDiffReviewThresholdMinutes = Math.max(
    5,
    Number(next.timeDiffReviewThresholdMinutes) || 40
  );
  next.nextDaySummaryTime = normalizeTimeHHMM(next.nextDaySummaryTime, '00:02');

  ensureAllDirectories();
  fs.writeFileSync(LOCAL_CONFIG_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}

export function extractUserIdFromProfileUrl(profileUrl: string): string | null {
  if (!profileUrl) return null;
  const match = profileUrl.match(/\/user\/profile\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : null;
}

export function parseXhsCount(val: unknown): { raw: string; num: number } {
  if (val === null || val === undefined) return { raw: '0', num: 0 };
  if (typeof val === 'number' && Number.isFinite(val)) {
    const n = Math.max(0, Math.round(val));
    return { raw: String(n), num: n };
  }
  const s = String(val).trim();
  if (!s || /^(赞|点赞|收藏|评论|分享|抢首评|-)$/.test(s)) {
    return { raw: '0', num: 0 };
  }
  const clean = s.replace(/,/g, '').replace(/\+/g, '');
  const wanMatch = clean.match(/^(\d+(?:\.\d+)?)\s*[wW万]$/);
  if (wanMatch) {
    return { raw: s, num: Math.round(parseFloat(wanMatch[1]) * 10_000) };
  }
  const yiMatch = clean.match(/^(\d+(?:\.\d+)?)\s*亿$/);
  if (yiMatch) {
    return { raw: s, num: Math.round(parseFloat(yiMatch[1]) * 100_000_000) };
  }
  const numVal = Number(clean);
  if (Number.isFinite(numVal)) {
    const rounded = Math.max(0, Math.round(numVal));
    return { raw: String(rounded), num: rounded };
  }
  return { raw: s, num: 0 };
}

/**
 * 解析小红书页面展示的日期时间文本
 * 重点适配跨过0点后展示的「昨天 HH:mm」、「今天 HH:mm」、「前天 HH:mm」、「MM-DD HH:mm」、「X分钟前/小时前/天前」
 */
export function parseXhsRenderedTimeText(
  rawText: string,
  referenceNowMs = Date.now()
): {
  parsedMs: number | null;
  hasExactClock: boolean;
  isEditedText: boolean;
  cleanTimeText: string;
} {
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!raw) {
    return { parsedMs: null, hasExactClock: false, isEditedText: false, cleanTimeText: '' };
  }
  const isEditedText = raw.includes('编辑于') || raw.includes('修改于');
  // 去掉尾部可能携带的 IP 属地文本（如 "昨天 21:36 广东" 或 "11-24 上海"）
  const withoutEdited = raw.replace(/^(编辑于|修改于)\s*/, '').trim();
  const ref = new Date(referenceNowMs);

  // 1. 匹配：刚刚
  if (/^刚刚(?:\s|$)/.test(withoutEdited)) {
    return {
      parsedMs: referenceNowMs,
      hasExactClock: false,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}刚刚`,
    };
  }

  // 2. 匹配：昨天 21:36 / 今天 09:15 / 前天 18:02
  const relDayMatch = withoutEdited.match(/(今天|昨天|前天)\s*(\d{1,2}):(\d{2})/);
  if (relDayMatch) {
    const word = relDayMatch[1];
    const hh = Number(relDayMatch[2]);
    const mm = Number(relDayMatch[3]);
    const dayOffset = word === '今天' ? 0 : word === '昨天' ? -1 : -2;
    const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + dayOffset, hh, mm, 0, 0);
    return {
      parsedMs: d.getTime(),
      hasExactClock: true,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${word} ${String(hh).padStart(2, '0')}:${String(
        mm
      ).padStart(2, '0')}`,
    };
  }

  // 3. 匹配：2026-11-25 21:36 或 2026-11-25
  const fullDateMatch = withoutEdited.match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (fullDateMatch) {
    const y = Number(fullDateMatch[1]);
    const mo = Number(fullDateMatch[2]) - 1;
    const da = Number(fullDateMatch[3]);
    const hasClock = Boolean(fullDateMatch[4] && fullDateMatch[5]);
    const hh = fullDateMatch[4] ? Number(fullDateMatch[4]) : 0;
    const mm = fullDateMatch[5] ? Number(fullDateMatch[5]) : 0;
    const d = new Date(y, mo, da, hh, mm, 0, 0);
    return {
      parsedMs: d.getTime(),
      hasExactClock: hasClock,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${fullDateMatch[0]}`,
    };
  }

  // 4. 匹配：11-25 21:36 或 11-25（注意过了两天后小红书只显示 MM-DD 无时分）
  const mdMatch = withoutEdited.match(/(?:^|\s)(\d{1,2})-(\d{1,2})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (mdMatch) {
    const mo = Number(mdMatch[1]) - 1;
    const da = Number(mdMatch[2]);
    const hasClock = Boolean(mdMatch[3] && mdMatch[4]);
    const hh = mdMatch[3] ? Number(mdMatch[3]) : 0;
    const mm = mdMatch[4] ? Number(mdMatch[4]) : 0;
    let y = ref.getFullYear();
    const candidate = new Date(y, mo, da, hh, mm, 0, 0);
    if (candidate.getTime() > referenceNowMs + 86400_000 * 2) {
      y -= 1;
    }
    const d = new Date(y, mo, da, hh, mm, 0, 0);
    return {
      parsedMs: d.getTime(),
      hasExactClock: hasClock,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${mdMatch[0].trim()}`,
    };
  }

  // 5. 匹配：X分钟前 / X小时前 / X天前
  const minAgo = withoutEdited.match(/(\d+)\s*分钟前/);
  if (minAgo) {
    return {
      parsedMs: referenceNowMs - Number(minAgo[1]) * 60_000,
      hasExactClock: false,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${minAgo[1]}分钟前`,
    };
  }
  const hourAgo = withoutEdited.match(/(\d+)\s*小时前/);
  if (hourAgo) {
    return {
      parsedMs: referenceNowMs - Number(hourAgo[1]) * 3600_000,
      hasExactClock: false,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${hourAgo[1]}小时前`,
    };
  }
  const dayAgo = withoutEdited.match(/(\d+)\s*天前/);
  if (dayAgo) {
    return {
      parsedMs: referenceNowMs - Number(dayAgo[1]) * 86400_000,
      hasExactClock: false,
      isEditedText,
      cleanTimeText: `${isEditedText ? '编辑于 ' : ''}${dayAgo[1]}天前`,
    };
  }

  return { parsedMs: null, hasExactClock: false, isEditedText, cleanTimeText: withoutEdited };
}

export function formatDateTime(tsOrIso?: number | string | Date | null): string {
  if (tsOrIso === null || tsOrIso === undefined || tsOrIso === '') return '未知时间';
  const d = tsOrIso instanceof Date ? tsOrIso : new Date(tsOrIso);
  if (Number.isNaN(d.getTime())) return '未知时间';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function formatDurationMinutes(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined || !Number.isFinite(minutes)) return '未知时长';
  const abs = Math.abs(Math.round(minutes));
  if (abs < 60) return `${abs}分钟`;
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  if (days > 0) {
    return `${days}天${hours > 0 ? `${hours}小时` : ''}${mins > 0 ? `${mins}分` : ''}`;
  }
  return `${hours}小时${mins > 0 ? `${mins}分` : ''}`;
}

/**
 * 根据最后一次确认存活时间与本次发现消失时间，推算删除的大概时间与区间
 */
export function estimateDeletionWindow(
  lastSeenIso: string,
  detectedIso: string
): {
  midpointIso: string;
  windowText: string;
  halfSpanMinutes: number;
} {
  const t1 = new Date(lastSeenIso).getTime();
  const t2 = new Date(detectedIso).getTime();
  if (Number.isNaN(t1) || Number.isNaN(t2) || t2 <= t1) {
    return {
      midpointIso: detectedIso,
      windowText: `约 ${formatDateTime(detectedIso)}`,
      halfSpanMinutes: 0,
    };
  }
  const midMs = Math.round((t1 + t2) / 2);
  const halfSpanMinutes = Math.max(1, Math.round((t2 - t1) / 120_000));
  const midIso = new Date(midMs).toISOString();
  const sameDay = getLocalDateKey(t1) === getLocalDateKey(t2);
  const endDisplay = sameDay ? formatDateTime(t2).slice(11) : formatDateTime(t2);
  const windowText = `约 ${formatDateTime(midMs)}（删除区间：${formatDateTime(
    t1
  )} ~ ${endDisplay}，误差 ±${halfSpanMinutes} 分钟）`;
  return { midpointIso: midIso, windowText, halfSpanMinutes };
}

export function getLocalDateKey(tsOrIso?: number | string | Date | null): string {
  const d = tsOrIso ? (tsOrIso instanceof Date ? tsOrIso : new Date(tsOrIso)) : new Date();
  const valid = Number.isNaN(d.getTime()) ? new Date() : d;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${valid.getFullYear()}-${pad(valid.getMonth() + 1)}-${pad(valid.getDate())}`;
}

export function getYesterdayDateKey(now = new Date()): string {
  const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0, 0);
  return getLocalDateKey(y);
}

export function getLocalDayBoundsIso(dateKey: string): {
  startIso: string;
  endIso: string;
  startMs: number;
  endMs: number;
} {
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const monthIdx = m ? Number(m[2]) - 1 : now.getMonth();
  const day = m ? Number(m[3]) : now.getDate();

  const start = new Date(year, monthIdx, day, 0, 0, 0, 0);
  const end = new Date(year, monthIdx, day, 23, 59, 59, 999);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function formatDiffDelta(
  oldNum: number,
  newNum: number,
  oldRaw: string,
  newRaw: string
): string {
  const diff = newNum - oldNum;
  if (diff > 0) return `${oldRaw} -> ${newRaw} (+${diff})`;
  if (diff < 0) return `${oldRaw} -> ${newRaw} (${diff})`;
  return `${oldRaw} -> ${newRaw}`;
}

export function formatSignedInt(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function truncateText(text: string, maxLen = 100): string {
  const normalized = (text || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '（无文字内容）';
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen)}…` : normalized;
}

/**
 * 提取小红书图片 CDN URL 的唯一资源标识（忽略动态时间戳签名与 !nd_dft / !nc_n_webp_mw_1 等尺寸后缀）
 * 用于防止主页缩略封面与详情页高清首图重复保存两次，以及精准识别头像更换
 */
export function extractXhsImageKey(rawUrl: string): string {
  const s = String(rawUrl || '').trim();
  if (!s) return '';
  const withoutQuery = s.split('?')[0].split('#')[0];
  const withoutStyle = withoutQuery.split('!')[0];
  const parts = withoutStyle.split('/').filter(Boolean);
  return parts[parts.length - 1] || withoutStyle;
}

function scoreXhsImageQuality(url: string): number {
  if (url.includes('!nd_dft_')) return 30;
  if (!url.includes('!nc_n_') && !url.includes('!nd_prv_')) return 20;
  return 10;
}

/**
 * 按小红书底层图片资源 Key 去重，且同一张图优先保留详情页高清大图 URL（丢弃低清卡片封面缩略图）
 */
export function dedupeXhsImageUrls(urls: Array<string | undefined | null>): string[] {
  const valid = urls
    .map((u) => String(u || '').trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const bestByKey = new Map<string, string>();
  const orderedKeys: string[] = [];

  for (const url of valid) {
    const key = extractXhsImageKey(url) || url;
    const prev = bestByKey.get(key);
    if (!prev) {
      orderedKeys.push(key);
      bestByKey.set(key, url);
    } else if (scoreXhsImageQuality(url) > scoreXhsImageQuality(prev)) {
      bestByKey.set(key, url);
    }
  }

  return orderedKeys.map((k) => bestByKey.get(k)!);
}

/**
 * 将评论者名称与小红书号格式化为「名称（小红书号）」
 */
export function formatNicknameWithRedId(nickname: string, redId?: string | null): string {
  const cleanName = (nickname || '未知用户').trim();
  const cleanRedId = (redId || '').trim();
  if (!cleanRedId || cleanRedId === 'UNKNOWN') {
    return cleanName;
  }
  if (cleanName.includes(`（${cleanRedId}）`) || cleanName.includes(`(${cleanRedId})`)) {
    return cleanName;
  }
  return `${cleanName}（${cleanRedId}）`;
}

/**
 * 清洗小红书 IP 属地文本（去除「IP属地：」「属地：」等前缀与多余空白）
 */
export function normalizeIpLocation(raw: unknown): string {
  const s = String(raw || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:IP\s*属地|IP归属地|属地|IP)[：:\s]+/i, '')
    .trim();
  if (!s || /^(-|无|未知)$/.test(s)) return '';
  return s;
}

/**
 * 从小红书页面展示的时间文本尾部兜底提取 IP 属地（如「昨天 21:36 广东」「04-20 上海」「编辑于 6天前 浙江」）
 */
export function extractIpFromRenderedTimeText(rawText?: string | null): string {
  const raw = String(rawText || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const withoutEdited = raw.replace(/^(编辑于|修改于)\s*/, '').trim();
  const patterns = [
    /^刚刚(?:\s+(.+))?$/,
    /^(?:今天|昨天|前天)\s*\d{1,2}:\d{2}(?:\s+(.+))?$/,
    /^\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?(?:\s+(.+))?$/,
    /^\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2})?(?:\s+(.+))?$/,
    /^\d{1,2}:\d{2}(?:\s+(.+))?$/,
    /^\d+\s*(?:分钟前|小时前|天前)(?:\s+(.+))?$/,
  ];
  for (const re of patterns) {
    const m = withoutEdited.match(re);
    if (m && m[1]) {
      const candidate = normalizeIpLocation(m[1]);
      if (candidate && !/^[\d:\-\s]+$/.test(candidate) && candidate.length <= 24) {
        return candidate;
      }
    }
  }
  return '';
}

/**
 * 清洗账号名字
 */
export function normalizeProfileNickname(raw: unknown): string {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 清洗小红书性别字段：统一为「男」「女」或空字符串（未设置/隐藏）
 */
export function normalizeProfileGender(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (raw === 1 || raw === '1') return '女';
  if (raw === 0 || raw === '0') return '男';
  const s = String(raw).trim().toLowerCase();
  if (!s || s === '2' || s === 'unknown' || s === '未知' || s === '保密' || s === '未设置' || s === '-') {
    return '';
  }
  if (s.includes('female') || s === '女' || s === 'f') return '女';
  if (s.includes('male') || s === '男' || s === 'm') return '男';
  return '';
}

const DEFAULT_EMPTY_BIO_RE =
  /^(?:还没有简介|暂时还没有简介|暂无简介|还没有填写简介|这个人很懒[，,\s]*什么都没留下|ta还没有简介)$/i;

/**
 * 清洗个性签名：小红书未设置签名时页面常展示「还没有简介」，统一归一化为空白字符串 ""
 */
export function normalizeProfileBio(raw: unknown): string {
  const s = String(raw || '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!s || DEFAULT_EMPTY_BIO_RE.test(s)) return '';
  return s;
}
