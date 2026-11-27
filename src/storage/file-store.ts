import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  AVATAR_PHOTOS_DIR,
  COMMENT_PHOTOS_DIR,
  ensureAllDirectories,
  LOGS_DIR,
  NOTE_PHOTOS_DIR,
  PHOTOS_ROOT,
  REPORTS_DIR,
} from '../shared/paths.ts';
import type {
  AvatarHistoryItem,
  CommentSnapshot,
  DailyAnalyticsReport,
  NoteRevisionItem,
  NoteSnapshot,
} from '../shared/types.ts';
import {
  dedupeXhsImageUrls,
  extractXhsImageKey,
  formatDateTime,
  formatNicknameWithRedId,
  getLocalDateKey,
} from '../shared/utils.ts';

const IMAGE_FETCH_HEADERS = {
  Referer: 'https://www.xiaohongshu.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

interface AvatarArchiveResult {
  localPath: string | null;
  avatarKey: string;
  sha256: string;
  changed: boolean;
}

/**
 * 保存账号头像到本地分类目录 storage/photos/avatars/
 * 支持识别头像更换：若头像未变则直接复用已有文件；若更换新头像则按哈希独立保存新文件（绝不覆盖旧头像！）
 */
export async function archiveUserAvatar(
  userId: string,
  avatarUrl: string,
  latestRecord?: AvatarHistoryItem | null
): Promise<AvatarArchiveResult> {
  const avatarKey = extractXhsImageKey(avatarUrl);
  if (!userId || !/^https?:\/\//i.test(avatarUrl)) {
    return {
      localPath: latestRecord?.localPath || null,
      avatarKey,
      sha256: latestRecord?.sha256 || '',
      changed: false,
    };
  }
  ensureAllDirectories();

  // 若图片资源 Key 与上次归档完全一致且本地文件存在，无需重复下载
  if (latestRecord && latestRecord.avatarKey && latestRecord.avatarKey === avatarKey) {
    const relDisk = latestRecord.localPath.replace(/^\/photos\/+/, '');
    const diskPath = path.join(PHOTOS_ROOT, relDisk);
    if (fs.existsSync(diskPath) && fs.statSync(diskPath).size > 200) {
      return {
        localPath: latestRecord.localPath,
        avatarKey,
        sha256: latestRecord.sha256,
        changed: false,
      };
    }
  }

  const safeUser = userId.replace(/[^a-zA-Z0-9_-]/g, '');

  try {
    const res = await fetch(avatarUrl, {
      headers: IMAGE_FETCH_HEADERS,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > 200) {
        const sha256 = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 12);

        // 二次校验文件内容哈希：若像素内容完全相同，不视为换头像
        if (latestRecord && latestRecord.sha256 === sha256) {
          const relDisk = latestRecord.localPath.replace(/^\/photos\/+/, '');
          const diskPath = path.join(PHOTOS_ROOT, relDisk);
          if (fs.existsSync(diskPath)) {
            return {
              localPath: latestRecord.localPath,
              avatarKey: avatarKey || latestRecord.avatarKey,
              sha256,
              changed: false,
            };
          }
        }

        const dateCompact = getLocalDateKey().replace(/-/g, '');
        const fileName = `${safeUser}_${dateCompact}_${sha256}.webp`;
        const fullPath = path.join(AVATAR_PHOTOS_DIR, fileName);
        const webRoute = `/photos/avatars/${fileName}`;
        fs.writeFileSync(fullPath, buf);

        return {
          localPath: webRoute,
          avatarKey,
          sha256,
          changed: Boolean(latestRecord),
        };
      }
    }
  } catch {
    // 忽略单次头像下载超时
  }

  return {
    localPath: latestRecord?.localPath || null,
    avatarKey: avatarKey || latestRecord?.avatarKey || '',
    sha256: latestRecord?.sha256 || '',
    changed: false,
  };
}

/**
 * 将单篇笔记的封面与全部高清照片按笔记分目录永久保存到 storage/photos/notes/<noteId>/
 * 同时在同文件夹内写入一份 笔记图文信息备份.json（含评论快照与本地锁定的发布时间）
 */
export async function archiveNotePhotosAndMeta(
  note: NoteSnapshot,
  opts?: {
    skipDownload?: boolean;
    verifiedTimeText?: string;
    lastEditedTimeText?: string;
    editCount?: number;
    revisions?: NoteRevisionItem[];
    firstSeenAt?: string;
    comments?: CommentSnapshot[];
  }
): Promise<string[]> {
  ensureAllDirectories();
  const safeNoteId = note.noteId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeNoteId) return [];

  const targetDir = path.join(NOTE_PHOTOS_DIR, safeNoteId);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // 优先保留详情页高清图 URL，并按小红书底层图片资源 Key 去重，彻底避免封面缩略图与首图重复保存两次
  const allUrls = dedupeXhsImageUrls([...(note.imageUrls || []), note.coverUrl]).slice(0, 30);

  const savedWebRoutes: string[] = [];
  const seenBufferHashes = new Set<string>();

  if (!opts?.skipDownload) {
    let photoIdx = 0;
    for (let i = 0; i < allUrls.length; i++) {
      const url = allUrls[i];
      const nextIndex = photoIdx + 1;
      const fileName = `photo_${String(nextIndex).padStart(2, '0')}.webp`;
      const fullPath = path.join(targetDir, fileName);
      const webRoute = `/photos/notes/${safeNoteId}/${fileName}`;

      if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 200) {
        const existingHash = crypto
          .createHash('sha256')
          .update(fs.readFileSync(fullPath))
          .digest('hex');
        seenBufferHashes.add(existingHash);
        savedWebRoutes.push(webRoute);
        photoIdx++;
        continue;
      }

      try {
        const res = await fetch(url, {
          headers: IMAGE_FETCH_HEADERS,
          signal: AbortSignal.timeout(12_000),
        });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.byteLength > 200) {
            const bufHash = crypto.createHash('sha256').update(buf).digest('hex');
            if (seenBufferHashes.has(bufHash)) {
              continue;
            }
            seenBufferHashes.add(bufHash);
            fs.writeFileSync(fullPath, buf);
            savedWebRoutes.push(webRoute);
            photoIdx++;
          }
        }
      } catch {
        // 单张图片超时不影响整体保存
      }
    }
  } else {
    // 读取已有本地图片列表
    try {
      const existing = fs
        .readdirSync(targetDir)
        .filter((f) => /^photo_\d+\.(webp|jpg|jpeg|png)$/i.test(f))
        .sort();
      for (const f of existing) {
        savedWebRoutes.push(`/photos/notes/${safeNoteId}/${f}`);
      }
    } catch {
      // ignore
    }
  }

  // 在该笔记的照片文件夹内同步更新文字与评论元数据备份文件
  try {
    const metaPath = path.join(targetDir, '笔记图文信息备份.json');
    let prevComments: unknown[] | undefined;
    let prevRevisions: unknown[] | undefined;
    if (fs.existsSync(metaPath)) {
      try {
        const oldMeta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        if (!opts?.comments && Array.isArray(oldMeta.commentsBackup)) {
          prevComments = oldMeta.commentsBackup;
        }
        if (!opts?.revisions && Array.isArray(oldMeta.editHistory)) {
          prevRevisions = oldMeta.editHistory;
        }
      } catch {
        // ignore
      }
    }

    const metaContent = {
      noteId: note.noteId,
      title: note.title,
      desc: note.desc,
      noteType: note.noteType,
      publishedAt: note.publishedAt ? formatDateTime(note.publishedAt) : null,
      verifiedPublishTime: opts?.verifiedTimeText || (note.publishedAt ? formatDateTime(note.publishedAt) : null),
      lastEditedAt: opts?.lastEditedTimeText || null,
      editCount: opts?.editCount ?? (opts?.revisions?.length || (opts?.lastEditedTimeText ? 1 : 0)),
      renderedTimeText: note.renderedTimeText,
      firstCapturedAt: opts?.firstSeenAt ? formatDateTime(opts.firstSeenAt) : formatDateTime(new Date()),
      ipLocation: note.ipLocation,
      likedCount: note.likedRaw,
      collectedCount: note.collectedRaw,
      commentCount: note.commentRaw,
      savedPhotosCount: savedWebRoutes.length,
      savedPhotoRoutes: savedWebRoutes,
      editHistory: opts?.revisions
        ? opts.revisions.map((rev) => ({
            editedAt: rev.editedTimeText || (rev.editedAtMs ? formatDateTime(rev.editedAtMs) : null),
            renderedTimeText: rev.renderedTimeText,
            detectedAt: formatDateTime(rev.changedAt),
            estimatedEditWindow: rev.estimatedEditWindow,
            oldTitle: rev.oldTitle,
            newTitle: rev.newTitle,
            oldDesc: rev.oldDesc,
            newDesc: rev.newDesc,
          }))
        : prevRevisions || [],
      commentsBackup: opts?.comments
        ? opts.comments.map((c) => ({
            commentId: c.commentId,
            parentId: c.parentId,
            userId: c.userId,
            userRedId: c.userRedId || '',
            nickname: formatNicknameWithRedId(c.nickname, c.userRedId),
            rawNickname: c.nickname,
            targetNickname: c.targetNickname
              ? formatNicknameWithRedId(c.targetNickname, c.targetRedId)
              : '',
            content: c.content,
            createdAt: c.createdAt ? formatDateTime(c.createdAt) : null,
            renderedTimeText: c.renderedTimeText,
            ipLocation: c.ipLocation,
            likeCount: c.likeCountRaw,
          }))
        : prevComments || [],
      lastBackupAt: formatDateTime(new Date()),
    };
    fs.writeFileSync(metaPath, JSON.stringify(metaContent, null, 2), 'utf-8');
  } catch {
    // ignore
  }

  return savedWebRoutes;
}

/**
 * 保存评论区附带的图片到 storage/photos/comments/
 */
export async function archiveCommentPhotos(
  noteId: string,
  commentId: string,
  pictureUrls?: string[],
  skipDownload = false
): Promise<string[]> {
  if (!pictureUrls || pictureUrls.length === 0) return [];
  ensureAllDirectories();
  const safeNote = noteId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeComment = commentId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeNote || !safeComment) return [];

  const validUrls = pictureUrls.filter((u) => /^https?:\/\//i.test(u)).slice(0, 9);
  const savedRoutes: string[] = [];

  for (let i = 0; i < validUrls.length; i++) {
    const fileName = `${safeNote}_${safeComment}_${String(i + 1).padStart(2, '0')}.webp`;
    const fullPath = path.join(COMMENT_PHOTOS_DIR, fileName);
    const webRoute = `/photos/comments/${fileName}`;

    if (fs.existsSync(fullPath) && fs.statSync(fullPath).size > 200) {
      savedRoutes.push(webRoute);
      continue;
    }
    if (skipDownload) continue;

    try {
      const res = await fetch(validUrls[i], {
        headers: IMAGE_FETCH_HEADERS,
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.byteLength > 200) {
          fs.writeFileSync(fullPath, buf);
          savedRoutes.push(webRoute);
        }
      }
    } catch {
      // ignore timeout
    }
  }
  return savedRoutes;
}

/**
 * 写入本地每日事件流水日志 storage/logs/events-YYYY-MM-DD.jsonl
 */
export function appendEventLogFile(dateKey: string, record: Record<string, unknown>): void {
  try {
    ensureAllDirectories();
    const safeDate = dateKey.replace(/[^0-9-]/g, '') || getLocalDateKey();
    const filePath = path.join(LOGS_DIR, `events-${safeDate}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[FileStore] 写入事件日志文件失败:', err);
  }
}

/**
 * 写入本地删帖/删评/新增评论/改文专项对比记录文件 storage/logs/comparisons-YYYY-MM-DD.jsonl
 */
export function appendComparisonLogFile(dateKey: string, record: Record<string, unknown>): void {
  try {
    ensureAllDirectories();
    const safeDate = dateKey.replace(/[^0-9-]/g, '') || getLocalDateKey();
    const filePath = path.join(LOGS_DIR, `comparisons-${safeDate}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[FileStore] 写入对比日志文件失败:', err);
  }
}

/**
 * 写入本地 IP 属地检测与变更流水文件 storage/logs/ip-changes-YYYY-MM-DD.jsonl
 */
export function appendIpChangeLogFile(dateKey: string, record: Record<string, unknown>): void {
  try {
    ensureAllDirectories();
    const safeDate = dateKey.replace(/[^0-9-]/g, '') || getLocalDateKey();
    const filePath = path.join(LOGS_DIR, `ip-changes-${safeDate}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[FileStore] 写入 IP 变更日志文件失败:', err);
  }
}

/**
 * 写入本地账号资料（名字/性别/个性签名）变更流水文件 storage/logs/profile-changes-YYYY-MM-DD.jsonl
 */
export function appendProfileChangeLogFile(dateKey: string, record: Record<string, unknown>): void {
  try {
    ensureAllDirectories();
    const safeDate = dateKey.replace(/[^0-9-]/g, '') || getLocalDateKey();
    const filePath = path.join(LOGS_DIR, `profile-changes-${safeDate}.jsonl`);
    fs.appendFileSync(filePath, JSON.stringify(record) + '\n', 'utf-8');
  } catch (err) {
    console.error('[FileStore] 写入资料变更日志文件失败:', err);
  }
}

/**
 * 保存次日0点汇总与时间对照报告文件到 storage/reports/
 */
export function writeDailyReportFiles(
  dateKey: string,
  report: DailyAnalyticsReport,
  markdownContent: string
): string {
  ensureAllDirectories();
  const safeDate = dateKey.replace(/[^0-9-]/g, '') || getLocalDateKey();
  const mdPath = path.join(REPORTS_DIR, `daily-report-${safeDate}.md`);
  const jsonPath = path.join(REPORTS_DIR, `daily-report-${safeDate}.json`);
  fs.writeFileSync(mdPath, markdownContent, 'utf-8');
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({ ...report, markdownReportPath: mdPath }, null, 2),
    'utf-8'
  );
  return mdPath;
}
