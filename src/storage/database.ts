import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_FILE_PATH, ensureAllDirectories, PHOTOS_ROOT } from '../shared/paths.ts';
import type {
  AvatarHistoryItem,
  ComparisonRecord,
  DailyAnalyticsReport,
  IpHistoryItem,
  IpHistorySource,
  MonitorEvent,
  NoteRevisionItem,
  ProfileFieldHistoryItem,
  ProfileFieldKey,
  ProfileSnapshot,
  ReconciliationStatus,
  StoredCommentRow,
  StoredNoteRow,
  TimeReconciliationItem,
} from '../shared/types.ts';
import {
  estimateDeletionWindow,
  extractXhsImageKey,
  formatDateTime,
  getLocalDateKey,
  getLocalDayBoundsIso,
  normalizeIpLocation,
  normalizeProfileBio,
  normalizeProfileGender,
  normalizeProfileNickname,
  nowIso,
} from '../shared/utils.ts';

export class MonitorDatabase {
  private db: DatabaseSync;

  constructor(dbFilePath = DB_FILE_PATH) {
    if (dbFilePath !== ':memory:') {
      ensureAllDirectories();
    }
    this.db = new DatabaseSync(dbFilePath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS profile_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        red_id TEXT NOT NULL,
        nickname TEXT NOT NULL,
        gender TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL,
        local_avatar_path TEXT,
        desc TEXT NOT NULL,
        ip_location TEXT NOT NULL,
        follows_raw TEXT NOT NULL,
        follows_num INTEGER NOT NULL,
        fans_raw TEXT NOT NULL,
        fans_num INTEGER NOT NULL,
        interaction_raw TEXT NOT NULL,
        interaction_num INTEGER NOT NULL,
        date_key TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profile_date ON profile_snapshots(user_id, date_key, captured_at);

      CREATE TABLE IF NOT EXISTS notes (
        note_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        xsec_token TEXT NOT NULL DEFAULT '',
        title TEXT NOT NULL DEFAULT '',
        desc TEXT NOT NULL DEFAULT '',
        note_type TEXT NOT NULL DEFAULT 'normal',
        published_at INTEGER,
        updated_at INTEGER,
        last_edited_at_ms INTEGER,
        last_edited_time_text TEXT NOT NULL DEFAULT '',
        edit_count INTEGER NOT NULL DEFAULT 0,
        first_rendered_time_text TEXT NOT NULL DEFAULT '',
        latest_rendered_time_text TEXT NOT NULL DEFAULT '',
        verified_publish_ms INTEGER,
        verified_time_text TEXT NOT NULL DEFAULT '',
        ip_location TEXT NOT NULL DEFAULT '',
        liked_raw TEXT NOT NULL DEFAULT '0',
        liked_num INTEGER NOT NULL DEFAULT 0,
        collected_raw TEXT NOT NULL DEFAULT '0',
        collected_num INTEGER NOT NULL DEFAULT 0,
        comment_raw TEXT NOT NULL DEFAULT '0',
        comment_num INTEGER NOT NULL DEFAULT 0,
        cover_url TEXT NOT NULL DEFAULT '',
        image_urls_json TEXT NOT NULL DEFAULT '[]',
        local_photo_paths_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        missing_streak INTEGER NOT NULL DEFAULT 0,
        is_baseline INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        first_seen_date_key TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        deleted_detected_at TEXT,
        estimated_deleted_at TEXT,
        estimated_delete_window TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notes_user_status ON notes(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_notes_first_date ON notes(first_seen_date_key);

      CREATE TABLE IF NOT EXISTS note_metric_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id TEXT NOT NULL,
        date_key TEXT NOT NULL,
        liked_num INTEGER NOT NULL,
        collected_num INTEGER NOT NULL,
        comment_num INTEGER NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_metrics_date ON note_metric_points(date_key, note_id);

      CREATE TABLE IF NOT EXISTS note_revisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        note_id TEXT NOT NULL,
        old_title TEXT NOT NULL,
        new_title TEXT NOT NULL,
        old_desc TEXT NOT NULL,
        new_desc TEXT NOT NULL,
        old_images_json TEXT NOT NULL,
        new_images_json TEXT NOT NULL,
        edited_at_ms INTEGER,
        edited_time_text TEXT NOT NULL DEFAULT '',
        rendered_time_text TEXT NOT NULL DEFAULT '',
        estimated_edit_window TEXT,
        changed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON note_revisions(note_id, id DESC);

      CREATE TABLE IF NOT EXISTS comments (
        comment_id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        parent_id TEXT,
        user_id TEXT NOT NULL DEFAULT '',
        user_red_id TEXT NOT NULL DEFAULT '',
        user_xsec_token TEXT NOT NULL DEFAULT '',
        nickname TEXT NOT NULL DEFAULT '',
        user_avatar TEXT NOT NULL DEFAULT '',
        target_user_id TEXT NOT NULL DEFAULT '',
        target_red_id TEXT NOT NULL DEFAULT '',
        target_nickname TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        picture_urls_json TEXT NOT NULL DEFAULT '[]',
        local_photo_paths_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER,
        first_rendered_time_text TEXT NOT NULL DEFAULT '',
        latest_rendered_time_text TEXT NOT NULL DEFAULT '',
        verified_created_ms INTEGER,
        verified_time_text TEXT NOT NULL DEFAULT '',
        ip_location TEXT NOT NULL DEFAULT '',
        like_count_raw TEXT NOT NULL DEFAULT '0',
        status TEXT NOT NULL DEFAULT 'ACTIVE',
        is_baseline INTEGER NOT NULL DEFAULT 0,
        first_seen_at TEXT NOT NULL,
        first_seen_date_key TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        deleted_detected_at TEXT,
        estimated_delete_window TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, status);
      CREATE INDEX IF NOT EXISTS idx_comments_first_date ON comments(first_seen_date_key);

      CREATE TABLE IF NOT EXISTS user_red_id_cache (
        user_id TEXT PRIMARY KEY,
        red_id TEXT NOT NULL,
        nickname TEXT NOT NULL DEFAULT '',
        xsec_token TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS avatar_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        avatar_key TEXT NOT NULL,
        sha256 TEXT NOT NULL,
        remote_url TEXT NOT NULL,
        local_path TEXT NOT NULL,
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_avatar_history_user ON avatar_history(user_id, id DESC);

      CREATE TABLE IF NOT EXISTS ip_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        ip_location TEXT NOT NULL,
        previous_ip TEXT,
        source TEXT NOT NULL DEFAULT 'PROFILE',
        note_id TEXT,
        estimated_change_window TEXT,
        date_key TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ip_history_user ON ip_history(user_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_ip_history_date ON ip_history(date_key, id DESC);

      CREATE TABLE IF NOT EXISTS profile_field_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        field TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT NOT NULL,
        estimated_change_window TEXT,
        date_key TEXT NOT NULL DEFAULT '',
        captured_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profile_field_history_user ON profile_field_history(user_id, field, id DESC);
      CREATE INDEX IF NOT EXISTS idx_profile_field_history_date ON profile_field_history(date_key, id DESC);

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        note_id TEXT,
        comment_id TEXT,
        level TEXT NOT NULL DEFAULT 'active',
        should_push INTEGER NOT NULL DEFAULT 0,
        triggers_burst INTEGER NOT NULL DEFAULT 0,
        is_activity INTEGER NOT NULL DEFAULT 1,
        before_json TEXT,
        after_json TEXT,
        pushed INTEGER NOT NULL DEFAULT 0,
        push_error TEXT,
        date_key TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_date ON events(date_key, created_at DESC);

      CREATE TABLE IF NOT EXISTS comparison_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        date_key TEXT NOT NULL,
        compare_type TEXT NOT NULL,
        note_id TEXT NOT NULL,
        comment_id TEXT,
        note_title TEXT NOT NULL,
        author_nickname TEXT NOT NULL,
        local_saved_content TEXT NOT NULL,
        new_content_if_edited TEXT,
        local_photo_paths_json TEXT NOT NULL DEFAULT '[]',
        note_publish_time TEXT NOT NULL,
        comment_publish_time TEXT,
        first_captured_time TEXT NOT NULL,
        last_seen_alive_time TEXT,
        detected_change_time TEXT NOT NULL,
        estimated_action_time_text TEXT NOT NULL,
        survival_minutes INTEGER,
        summary_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_comparisons_date ON comparison_records(date_key, id DESC);

      CREATE TABLE IF NOT EXISTS time_reconciliations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        target_date_key TEXT NOT NULL,
        item_type TEXT NOT NULL,
        target_id TEXT NOT NULL,
        note_id TEXT NOT NULL,
        title_or_excerpt TEXT NOT NULL,
        author_nickname TEXT NOT NULL,
        local_recorded_at TEXT NOT NULL,
        same_day_platform_time_text TEXT NOT NULL,
        same_day_estimated_ms INTEGER,
        next_day_verified_time_text TEXT NOT NULL,
        verified_platform_ms INTEGER,
        capture_delay_minutes INTEGER,
        estimate_error_minutes INTEGER,
        diff_minutes INTEGER,
        status TEXT NOT NULL,
        anomaly_reason TEXT NOT NULL DEFAULT '',
        review_note TEXT NOT NULL DEFAULT '',
        checked_at TEXT NOT NULL,
        reviewed_at TEXT,
        UNIQUE(target_date_key, item_type, target_id)
      );
      CREATE INDEX IF NOT EXISTS idx_reconcile_date ON time_reconciliations(target_date_key, status);

      CREATE TABLE IF NOT EXISTS daily_reports (
        user_id TEXT NOT NULL DEFAULT '',
        date_key TEXT NOT NULL,
        generated_at TEXT NOT NULL,
        is_next_day_verified INTEGER NOT NULL DEFAULT 1,
        markdown_path TEXT NOT NULL,
        report_json TEXT NOT NULL,
        PRIMARY KEY (user_id, date_key)
      );

      CREATE TABLE IF NOT EXISTS patrol_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL DEFAULT '',
        run_type TEXT NOT NULL,
        status TEXT NOT NULL,
        notes_scanned INTEGER NOT NULL DEFAULT 0,
        comments_scanned INTEGER NOT NULL DEFAULT 0,
        events_count INTEGER NOT NULL DEFAULT 0,
        error_msg TEXT,
        date_key TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_patrol_date ON patrol_runs(date_key);
    `);

    // 兼容升级已有数据库：为旧版 profile_snapshots 表平滑补充 gender 字段，并清洗默认空白签名占位词
    const profCols = new Set(
      (this.db.prepare('PRAGMA table_info(profile_snapshots)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!profCols.has('gender')) {
      this.db.exec("ALTER TABLE profile_snapshots ADD COLUMN gender TEXT NOT NULL DEFAULT '';");
    }
    this.db.exec(
      "UPDATE profile_snapshots SET desc = '' WHERE TRIM(desc) IN ('还没有简介', '暂时还没有简介', '暂无简介', '还没有填写简介', '这个人很懒，什么都没留下');"
    );

    // 兼容升级已有数据库：为旧版 notes 表平滑补充笔记编辑时间字段，并自动回填历史已编辑笔记的精确编辑时间
    const noteCols = new Set(
      (this.db.prepare('PRAGMA table_info(notes)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const addNoteCol = (col: string, def: string) => {
      if (!noteCols.has(col)) {
        this.db.exec(`ALTER TABLE notes ADD COLUMN ${col} ${def};`);
      }
    };
    addNoteCol('last_edited_at_ms', 'INTEGER');
    addNoteCol('last_edited_time_text', "TEXT NOT NULL DEFAULT ''");
    addNoteCol('edit_count', 'INTEGER NOT NULL DEFAULT 0');

    // 兼容升级已有数据库：为旧版 note_revisions 表平滑补充平台编辑时间与变更区间字段
    const revCols = new Set(
      (this.db.prepare('PRAGMA table_info(note_revisions)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const addRevCol = (col: string, def: string) => {
      if (!revCols.has(col)) {
        this.db.exec(`ALTER TABLE note_revisions ADD COLUMN ${col} ${def};`);
      }
    };
    addRevCol('edited_at_ms', 'INTEGER');
    addRevCol('edited_time_text', "TEXT NOT NULL DEFAULT ''");
    addRevCol('rendered_time_text', "TEXT NOT NULL DEFAULT ''");
    addRevCol('estimated_edit_window', 'TEXT');
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_note_revisions_note ON note_revisions(note_id, id DESC);');

    // 回填本地库中已存在、且平台明确带有编辑时间（updated_at 晚于 published_at >= 5秒 或页面标注「编辑于」）的笔记
    const editedBackfillRows = this.db
      .prepare(
        `SELECT note_id, published_at, updated_at, latest_rendered_time_text, edit_count
         FROM notes
         WHERE (last_edited_time_text = '' OR last_edited_time_text IS NULL)
           AND (
             (updated_at IS NOT NULL AND published_at IS NOT NULL AND (updated_at - published_at) >= 5000)
             OR latest_rendered_time_text LIKE '编辑于%'
             OR latest_rendered_time_text LIKE '修改于%'
           )`
      )
      .all() as Array<{
      note_id: string;
      published_at: number | null;
      updated_at: number | null;
      latest_rendered_time_text: string;
      edit_count: number;
    }>;
    for (const r of editedBackfillRows) {
      const hasExactUpd =
        r.updated_at !== null &&
        (r.published_at === null || Number(r.updated_at) - Number(r.published_at) >= 5000);
      const editMs = hasExactUpd ? Number(r.updated_at) : null;
      const editText = editMs
        ? formatDateTime(editMs)
        : String(r.latest_rendered_time_text || '').trim();
      if (editText) {
        this.db
          .prepare(
            `UPDATE notes
             SET last_edited_at_ms = COALESCE(last_edited_at_ms, ?),
                 last_edited_time_text = ?,
                 edit_count = CASE WHEN edit_count < 1 THEN 1 ELSE edit_count END
             WHERE note_id = ?`
          )
          .run(editMs, editText, String(r.note_id));
      }
    }

    // 兼容升级已有数据库：为旧版 comments 表平滑补充小红书号字段并自动回填已知账号小红书号
    const commentCols = new Set(
      (this.db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const addCommentCol = (col: string, def: string) => {
      if (!commentCols.has(col)) {
        this.db.exec(`ALTER TABLE comments ADD COLUMN ${col} ${def};`);
      }
    };
    addCommentCol('user_red_id', "TEXT NOT NULL DEFAULT ''");
    addCommentCol('user_xsec_token', "TEXT NOT NULL DEFAULT ''");
    addCommentCol('target_user_id', "TEXT NOT NULL DEFAULT ''");
    addCommentCol('target_red_id', "TEXT NOT NULL DEFAULT ''");

    // 将历史已抓取的主页账号小红书号同步至缓存表并回填到已有评论（例如作者本人的评论）
    this.db.exec(`
      INSERT OR IGNORE INTO user_red_id_cache (user_id, red_id, nickname, xsec_token, updated_at)
      SELECT user_id, red_id, nickname, '', captured_at
      FROM profile_snapshots
      WHERE user_id != '' AND red_id != ''
      ORDER BY id DESC;

      UPDATE comments
      SET user_red_id = (
        SELECT c.red_id FROM user_red_id_cache c
        WHERE c.user_id = comments.user_id AND c.red_id != '' AND c.red_id != 'UNKNOWN'
      )
      WHERE user_id != '' AND (user_red_id = '' OR user_red_id IS NULL)
        AND EXISTS (
          SELECT 1 FROM user_red_id_cache c
          WHERE c.user_id = comments.user_id AND c.red_id != '' AND c.red_id != 'UNKNOWN'
        );
    `);

    // 若已有历史 profile_snapshots 且 avatar_history 为空，自动将当前已保存的头像迁移为第1条头像基线
    const avatarCnt = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM avatar_history').get() as { cnt: number }
    ).cnt;
    if (avatarCnt === 0) {
      const firstProf = this.db
        .prepare(
          "SELECT user_id, avatar, local_avatar_path, captured_at FROM profile_snapshots WHERE user_id != '' AND local_avatar_path IS NOT NULL AND local_avatar_path != '' ORDER BY id ASC LIMIT 1"
        )
        .get() as
        | { user_id: string; avatar: string; local_avatar_path: string; captured_at: string }
        | undefined;
      if (firstProf) {
        const relDisk = String(firstProf.local_avatar_path).replace(/^\/photos\/+/, '');
        const diskFile = path.join(PHOTOS_ROOT, relDisk);
        let sha = 'initial';
        if (fs.existsSync(diskFile)) {
          sha = crypto.createHash('sha256').update(fs.readFileSync(diskFile)).digest('hex').slice(0, 12);
        }
        this.insertAvatarRecord({
          userId: String(firstProf.user_id),
          avatarKey: extractXhsImageKey(String(firstProf.avatar)),
          sha256: sha,
          remoteUrl: String(firstProf.avatar),
          localPath: String(firstProf.local_avatar_path),
          capturedAt: String(firstProf.captured_at),
        });
      }
    }

    // 兼容升级已有数据库：为旧版 ip_history 表平滑补充来源、关联笔记、变更区间与日期索引字段
    const ipCols = new Set(
      (this.db.prepare('PRAGMA table_info(ip_history)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    const addIpCol = (col: string, def: string) => {
      if (!ipCols.has(col)) {
        this.db.exec(`ALTER TABLE ip_history ADD COLUMN ${col} ${def};`);
      }
    };
    addIpCol('source', "TEXT NOT NULL DEFAULT 'PROFILE'");
    addIpCol('note_id', 'TEXT');
    addIpCol('estimated_change_window', 'TEXT');
    addIpCol('date_key', "TEXT NOT NULL DEFAULT ''");
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_ip_history_date ON ip_history(date_key, id DESC);');

    const missingDateIpRows = this.db
      .prepare("SELECT id, captured_at FROM ip_history WHERE date_key = '' OR date_key IS NULL")
      .all() as Array<{ id: number; captured_at: string }>;
    for (const r of missingDateIpRows) {
      this.db
        .prepare('UPDATE ip_history SET date_key = ? WHERE id = ?')
        .run(getLocalDateKey(String(r.captured_at)), Number(r.id));
    }

    // 若已有历史 profile_snapshots 且 ip_history 为空，自动按时间顺序回填已知 IP 属地基线与变更轨迹
    const ipCnt = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM ip_history').get() as { cnt: number }
    ).cnt;
    if (ipCnt === 0) {
      const profRows = this.db
        .prepare(
          "SELECT user_id, ip_location, captured_at FROM profile_snapshots WHERE user_id != '' AND ip_location != '' ORDER BY id ASC"
        )
        .all() as Array<{ user_id: string; ip_location: string; captured_at: string }>;
      const lastStateByUser = new Map<string, { ip: string; capturedAt: string }>();
      for (const r of profRows) {
        const uid = String(r.user_id);
        const ip = normalizeIpLocation(r.ip_location);
        if (!ip) continue;
        const capturedAt = String(r.captured_at);
        const prev = lastStateByUser.get(uid);
        if (!prev || prev.ip !== ip) {
          const estWin = prev
            ? estimateDeletionWindow(prev.capturedAt, capturedAt).windowText.replace(
                '删除区间',
                '变更区间'
              )
            : null;
          this.insertIpRecord({
            userId: uid,
            ipLocation: ip,
            previousIp: prev ? prev.ip : null,
            source: 'PROFILE',
            noteId: null,
            estimatedChangeWindow: estWin,
            dateKey: getLocalDateKey(capturedAt),
            capturedAt,
          });
        }
        lastStateByUser.set(uid, { ip, capturedAt });
      }
    }

    // 若已有历史 profile_snapshots 且 profile_field_history 为空，自动按时间顺序回填名字、个性签名（默认空白）及已知性别基线
    const pfCnt = (
      this.db.prepare('SELECT COUNT(*) AS cnt FROM profile_field_history').get() as { cnt: number }
    ).cnt;
    if (pfCnt === 0) {
      const snapRows = this.db
        .prepare(
          "SELECT user_id, nickname, gender, desc, captured_at FROM profile_snapshots WHERE user_id != '' ORDER BY id ASC"
        )
        .all() as Array<{
        user_id: string;
        nickname: string;
        gender: string;
        desc: string;
        captured_at: string;
      }>;
      const lastFieldState = new Map<string, { val: string; capturedAt: string }>();
      for (const r of snapRows) {
        const uid = String(r.user_id);
        const capturedAt = String(r.captured_at);
        const entries: Array<{ field: ProfileFieldKey; val: string; skipIfEmpty: boolean }> = [
          { field: 'NICKNAME', val: normalizeProfileNickname(r.nickname), skipIfEmpty: true },
          { field: 'GENDER', val: normalizeProfileGender(r.gender), skipIfEmpty: true },
          { field: 'BIO', val: normalizeProfileBio(r.desc), skipIfEmpty: false },
        ];
        for (const e of entries) {
          if (e.skipIfEmpty && !e.val) continue;
          const mapKey = `${uid}::${e.field}`;
          const prev = lastFieldState.get(mapKey);
          if (!prev || prev.val !== e.val) {
            const estWin = prev
              ? estimateDeletionWindow(prev.capturedAt, capturedAt).windowText.replace(
                  '删除区间',
                  '变更区间'
                )
              : null;
            this.insertProfileFieldRecord({
              userId: uid,
              field: e.field,
              oldValue: prev ? prev.val : null,
              newValue: e.val,
              estimatedChangeWindow: estWin,
              dateKey: getLocalDateKey(capturedAt),
              capturedAt,
            });
          }
          lastFieldState.set(mapKey, { val: e.val, capturedAt });
        }
      }
    }

    // 兼容升级已有数据库：为多账号隔离平滑补充 user_id 字段并自动归属历史记录（不丢失任何历史数据）
    const ensureUserIdCol = (table: string) => {
      const cols = new Set(
        (this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(
          (c) => c.name
        )
      );
      if (!cols.has('user_id')) {
        this.db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT NOT NULL DEFAULT '';`);
      }
    };
    ensureUserIdCol('events');
    ensureUserIdCol('comparison_records');
    ensureUserIdCol('time_reconciliations');
    ensureUserIdCol('patrol_runs');
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_events_user ON events(user_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_comparisons_user ON comparison_records(user_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_reconcile_user_date ON time_reconciliations(user_id, target_date_key, status);
      CREATE INDEX IF NOT EXISTS idx_patrol_user_date ON patrol_runs(user_id, date_key);
    `);

    // 兼容升级 daily_reports 表为按 (user_id, date_key) 复合主键隔离
    const dailyCols = new Set(
      (this.db.prepare('PRAGMA table_info(daily_reports)').all() as Array<{ name: string }>).map(
        (c) => c.name
      )
    );
    if (!dailyCols.has('user_id')) {
      const oldReports = this.db
        .prepare(
          'SELECT date_key, generated_at, is_next_day_verified, markdown_path, report_json FROM daily_reports'
        )
        .all() as Array<{
        date_key: string;
        generated_at: string;
        is_next_day_verified: number;
        markdown_path: string;
        report_json: string;
      }>;
      this.db.exec(`
        DROP TABLE daily_reports;
        CREATE TABLE daily_reports (
          user_id TEXT NOT NULL DEFAULT '',
          date_key TEXT NOT NULL,
          generated_at TEXT NOT NULL,
          is_next_day_verified INTEGER NOT NULL DEFAULT 1,
          markdown_path TEXT NOT NULL,
          report_json TEXT NOT NULL,
          PRIMARY KEY (user_id, date_key)
        );
      `);
      for (const r of oldReports) {
        let uid = '';
        try {
          const parsed = JSON.parse(String(r.report_json)) as DailyAnalyticsReport;
          uid = parsed?.account?.userId || '';
        } catch {
          // ignore
        }
        this.db
          .prepare(
            `INSERT OR REPLACE INTO daily_reports (user_id, date_key, generated_at, is_next_day_verified, markdown_path, report_json)
             VALUES (?, ?, ?, ?, ?, ?)`
          )
          .run(
            uid,
            String(r.date_key),
            String(r.generated_at),
            Number(r.is_next_day_verified || 0),
            String(r.markdown_path || ''),
            String(r.report_json)
          );
      }
    }

    // 为历史空 user_id 的 events / comparison_records / time_reconciliations / patrol_runs 自动归属原所属账号
    const inferUserId = (noteId: string | null, atIso: string): string => {
      if (noteId) {
        const noteRow = this.db
          .prepare('SELECT user_id FROM notes WHERE note_id = ?')
          .get(noteId) as { user_id: string } | undefined;
        if (noteRow?.user_id) return String(noteRow.user_id);
        const synMatch = noteId.match(/^(?:ip|avatar|profile_(?:nickname|gender|bio))_([a-zA-Z0-9_-]+)$/);
        if (synMatch?.[1]) return synMatch[1];
      }
      const beforeSnap = this.db
        .prepare(
          "SELECT user_id FROM profile_snapshots WHERE user_id != '' AND captured_at <= ? ORDER BY captured_at DESC, id DESC LIMIT 1"
        )
        .get(atIso) as { user_id: string } | undefined;
      if (beforeSnap?.user_id) return String(beforeSnap.user_id);
      const firstSnap = this.db
        .prepare("SELECT user_id FROM profile_snapshots WHERE user_id != '' ORDER BY id ASC LIMIT 1")
        .get() as { user_id: string } | undefined;
      return firstSnap?.user_id ? String(firstSnap.user_id) : '';
    };

    const legacyEvents = this.db
      .prepare("SELECT id, note_id, created_at FROM events WHERE user_id = '' OR user_id IS NULL")
      .all() as Array<{ id: number; note_id: string | null; created_at: string }>;
    for (const ev of legacyEvents) {
      const uid = inferUserId(ev.note_id ? String(ev.note_id) : null, String(ev.created_at));
      if (uid) {
        this.db.prepare('UPDATE events SET user_id = ? WHERE id = ?').run(uid, Number(ev.id));
      }
    }

    const legacyComps = this.db
      .prepare(
        "SELECT id, note_id, created_at FROM comparison_records WHERE user_id = '' OR user_id IS NULL"
      )
      .all() as Array<{ id: number; note_id: string | null; created_at: string }>;
    for (const cp of legacyComps) {
      const uid = inferUserId(cp.note_id ? String(cp.note_id) : null, String(cp.created_at));
      if (uid) {
        this.db
          .prepare('UPDATE comparison_records SET user_id = ? WHERE id = ?')
          .run(uid, Number(cp.id));
      }
    }

    const legacyRecs = this.db
      .prepare(
        "SELECT id, note_id, local_recorded_at FROM time_reconciliations WHERE user_id = '' OR user_id IS NULL"
      )
      .all() as Array<{ id: number; note_id: string | null; local_recorded_at: string }>;
    for (const rc of legacyRecs) {
      const uid = inferUserId(
        rc.note_id ? String(rc.note_id) : null,
        String(rc.local_recorded_at)
      );
      if (uid) {
        this.db
          .prepare('UPDATE time_reconciliations SET user_id = ? WHERE id = ?')
          .run(uid, Number(rc.id));
      }
    }

    const legacyPatrols = this.db
      .prepare("SELECT id, finished_at FROM patrol_runs WHERE user_id = '' OR user_id IS NULL")
      .all() as Array<{ id: number; finished_at: string }>;
    for (const pr of legacyPatrols) {
      const uid = inferUserId(null, String(pr.finished_at));
      if (uid) {
        this.db.prepare('UPDATE patrol_runs SET user_id = ? WHERE id = ?').run(uid, Number(pr.id));
      }
    }

    // 按账号回填独立建档标记 baseline_completed_at:<userId>，防止切回旧账号时误重跑首次建档
    const baselineNoteUsers = this.db
      .prepare(
        "SELECT user_id, MIN(first_seen_at) AS first_at FROM notes WHERE user_id != '' AND is_baseline = 1 GROUP BY user_id"
      )
      .all() as Array<{ user_id: string; first_at: string }>;
    for (const row of baselineNoteUsers) {
      const uid = String(row.user_id);
      if (!this.getMeta(`baseline_completed_at:${uid}`)) {
        this.setMeta(`baseline_completed_at:${uid}`, String(row.first_at || nowIso()));
      }
    }
    const legacyBaseUid = this.getMeta('baseline_user_id');
    if (legacyBaseUid && !this.getMeta(`baseline_completed_at:${legacyBaseUid}`)) {
      this.setMeta(
        `baseline_completed_at:${legacyBaseUid}`,
        this.getMeta('baseline_completed_at') || nowIso()
      );
    }
  }

  close(): void {
    this.db.close();
  }

  // ==================== KV Meta ====================
  getMeta(key: string): string | null {
    const row = this.db
      .prepare('SELECT value FROM kv_meta WHERE key = ?')
      .get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO kv_meta (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, nowIso());
  }

  isBaselineCompletedForUser(userId: string | null): boolean {
    if (!userId) return false;
    return (
      Boolean(this.getMeta(`baseline_completed_at:${userId}`)) ||
      this.getMeta('baseline_user_id') === userId
    );
  }

  getBaselineCompletedAt(userId: string | null): string | null {
    if (!userId) return null;
    const perUser = this.getMeta(`baseline_completed_at:${userId}`);
    if (perUser) return perUser;
    if (this.getMeta('baseline_user_id') === userId) {
      return this.getMeta('baseline_completed_at');
    }
    return null;
  }

  markBaselineCompleted(userId: string, atIso = nowIso()): void {
    this.setMeta(`baseline_completed_at:${userId}`, atIso);
    this.setMeta('baseline_user_id', userId);
    this.setMeta('baseline_completed_at', atIso);
  }

  // ==================== Profile & Avatar History ====================
  insertAvatarRecord(item: AvatarHistoryItem): AvatarHistoryItem {
    const res = this.db
      .prepare(
        `INSERT INTO avatar_history (user_id, avatar_key, sha256, remote_url, local_path, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.userId,
        item.avatarKey,
        item.sha256,
        item.remoteUrl,
        item.localPath,
        item.capturedAt
      );
    return { ...item, id: Number(res.lastInsertRowid) };
  }

  getLatestAvatarRecord(userId: string): AvatarHistoryItem | null {
    if (!userId) return null;
    const row = this.db
      .prepare('SELECT * FROM avatar_history WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(userId) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      id: Number(row.id),
      userId: String(row.user_id),
      avatarKey: String(row.avatar_key || ''),
      sha256: String(row.sha256 || ''),
      remoteUrl: String(row.remote_url || ''),
      localPath: String(row.local_path || ''),
      capturedAt: String(row.captured_at),
    };
  }

  getAvatarHistory(userId?: string): AvatarHistoryItem[] {
    const rows = (userId
      ? this.db
          .prepare('SELECT * FROM avatar_history WHERE user_id = ? ORDER BY id DESC LIMIT 50')
          .all(userId)
      : this.db
          .prepare('SELECT * FROM avatar_history ORDER BY id DESC LIMIT 50')
          .all()) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: Number(row.id),
      userId: String(row.user_id),
      avatarKey: String(row.avatar_key || ''),
      sha256: String(row.sha256 || ''),
      remoteUrl: String(row.remote_url || ''),
      localPath: String(row.local_path || ''),
      capturedAt: String(row.captured_at),
    }));
  }

  private mapIpHistoryRow(row: Record<string, unknown>): IpHistoryItem {
    return {
      id: Number(row.id),
      userId: String(row.user_id),
      ipLocation: String(row.ip_location),
      previousIp: row.previous_ip ? String(row.previous_ip) : null,
      source: (String(row.source || 'PROFILE') === 'NOTE' ? 'NOTE' : 'PROFILE') as IpHistorySource,
      noteId: row.note_id ? String(row.note_id) : null,
      estimatedChangeWindow: row.estimated_change_window
        ? String(row.estimated_change_window)
        : null,
      dateKey: row.date_key ? String(row.date_key) : getLocalDateKey(String(row.captured_at)),
      capturedAt: String(row.captured_at),
    };
  }

  insertIpRecord(item: IpHistoryItem): IpHistoryItem {
    const source: IpHistorySource = item.source || 'PROFILE';
    const noteId = item.noteId ?? null;
    const estimatedChangeWindow = item.estimatedChangeWindow ?? null;
    const dateKey = item.dateKey || getLocalDateKey(item.capturedAt);
    const res = this.db
      .prepare(
        `INSERT INTO ip_history (
           user_id, ip_location, previous_ip, source, note_id, estimated_change_window, date_key, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.userId,
        item.ipLocation,
        item.previousIp,
        source,
        noteId,
        estimatedChangeWindow,
        dateKey,
        item.capturedAt
      );
    return {
      ...item,
      id: Number(res.lastInsertRowid),
      source,
      noteId,
      estimatedChangeWindow,
      dateKey,
    };
  }

  getLatestIpRecord(userId: string, source: IpHistorySource = 'PROFILE'): IpHistoryItem | null {
    if (!userId) return null;
    const row = this.db
      .prepare(
        'SELECT * FROM ip_history WHERE user_id = ? AND source = ? ORDER BY id DESC LIMIT 1'
      )
      .get(userId, source) as Record<string, unknown> | undefined;
    if (!row) return null;
    return this.mapIpHistoryRow(row);
  }

  getIpHistory(userId?: string, limit = 100): IpHistoryItem[] {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const rows = (userId
      ? this.db
          .prepare('SELECT * FROM ip_history WHERE user_id = ? ORDER BY id DESC LIMIT ?')
          .all(userId, safeLimit)
      : this.db
          .prepare('SELECT * FROM ip_history ORDER BY id DESC LIMIT ?')
          .all(safeLimit)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapIpHistoryRow(row));
  }

  getIpChangesForDate(dateKey: string, userId?: string): IpHistoryItem[] {
    const rows = (userId
      ? this.db
          .prepare(
            'SELECT * FROM ip_history WHERE date_key = ? AND user_id = ? AND previous_ip IS NOT NULL ORDER BY id ASC'
          )
          .all(dateKey, userId)
      : this.db
          .prepare(
            'SELECT * FROM ip_history WHERE date_key = ? AND previous_ip IS NOT NULL ORDER BY id ASC'
          )
          .all(dateKey)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapIpHistoryRow(row));
  }

  private mapProfileFieldHistoryRow(row: Record<string, unknown>): ProfileFieldHistoryItem {
    return {
      id: Number(row.id),
      userId: String(row.user_id),
      field: String(row.field) as ProfileFieldKey,
      oldValue: row.old_value !== null && row.old_value !== undefined ? String(row.old_value) : null,
      newValue: String(row.new_value ?? ''),
      estimatedChangeWindow: row.estimated_change_window
        ? String(row.estimated_change_window)
        : null,
      dateKey: row.date_key ? String(row.date_key) : getLocalDateKey(String(row.captured_at)),
      capturedAt: String(row.captured_at),
    };
  }

  insertProfileFieldRecord(item: ProfileFieldHistoryItem): ProfileFieldHistoryItem {
    const estimatedChangeWindow = item.estimatedChangeWindow ?? null;
    const dateKey = item.dateKey || getLocalDateKey(item.capturedAt);
    const res = this.db
      .prepare(
        `INSERT INTO profile_field_history (
           user_id, field, old_value, new_value, estimated_change_window, date_key, captured_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        item.userId,
        item.field,
        item.oldValue,
        item.newValue,
        estimatedChangeWindow,
        dateKey,
        item.capturedAt
      );
    return {
      ...item,
      id: Number(res.lastInsertRowid),
      estimatedChangeWindow,
      dateKey,
    };
  }

  getLatestProfileFieldRecord(
    userId: string,
    field: ProfileFieldKey
  ): ProfileFieldHistoryItem | null {
    if (!userId) return null;
    const row = this.db
      .prepare(
        'SELECT * FROM profile_field_history WHERE user_id = ? AND field = ? ORDER BY id DESC LIMIT 1'
      )
      .get(userId, field) as Record<string, unknown> | undefined;
    return row ? this.mapProfileFieldHistoryRow(row) : null;
  }

  getProfileFieldHistory(
    userId?: string,
    field?: ProfileFieldKey,
    limit = 100
  ): ProfileFieldHistoryItem[] {
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (userId) {
      conds.push('user_id = ?');
      params.push(userId);
    }
    if (field) {
      conds.push('field = ?');
      params.push(field);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(safeLimit);
    const rows = this.db
      .prepare(`SELECT * FROM profile_field_history ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapProfileFieldHistoryRow(row));
  }

  getProfileFieldChangesForDate(dateKey: string, userId?: string): ProfileFieldHistoryItem[] {
    const rows = (userId
      ? this.db
          .prepare(
            'SELECT * FROM profile_field_history WHERE date_key = ? AND user_id = ? AND old_value IS NOT NULL ORDER BY id ASC'
          )
          .all(dateKey, userId)
      : this.db
          .prepare(
            'SELECT * FROM profile_field_history WHERE date_key = ? AND old_value IS NOT NULL ORDER BY id ASC'
          )
          .all(dateKey)) as Array<Record<string, unknown>>;
    return rows.map((row) => this.mapProfileFieldHistoryRow(row));
  }

  getLatestProfile(userId?: string): (ProfileSnapshot & { localAvatarPath: string | null; capturedAt: string }) | null {
    const sql = userId
      ? 'SELECT * FROM profile_snapshots WHERE user_id = ? ORDER BY id DESC LIMIT 1'
      : 'SELECT * FROM profile_snapshots ORDER BY id DESC LIMIT 1';
    const row = (userId
      ? this.db.prepare(sql).get(userId)
      : this.db.prepare(sql).get()) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      userId: String(row.user_id),
      redId: String(row.red_id),
      nickname: String(row.nickname),
      gender: String(row.gender || ''),
      avatar: String(row.avatar),
      localAvatarPath: row.local_avatar_path ? String(row.local_avatar_path) : null,
      desc: normalizeProfileBio(row.desc),
      ipLocation: String(row.ip_location),
      followsRaw: String(row.follows_raw),
      followsNum: Number(row.follows_num),
      fansRaw: String(row.fans_raw),
      fansNum: Number(row.fans_num),
      interactionRaw: String(row.interaction_raw),
      interactionNum: Number(row.interaction_num),
      capturedAt: String(row.captured_at),
    };
  }

  insertProfileSnapshot(
    p: ProfileSnapshot,
    localAvatarPath: string | null,
    capturedAt = nowIso()
  ): void {
    const dateKey = getLocalDateKey(capturedAt);
    this.db
      .prepare(
        `INSERT INTO profile_snapshots (
          user_id, red_id, nickname, gender, avatar, local_avatar_path, desc, ip_location,
          follows_raw, follows_num, fans_raw, fans_num, interaction_raw, interaction_num,
          date_key, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        p.userId,
        p.redId,
        p.nickname,
        p.gender || '',
        p.avatar,
        localAvatarPath,
        normalizeProfileBio(p.desc),
        p.ipLocation,
        p.followsRaw,
        p.followsNum,
        p.fansRaw,
        p.fansNum,
        p.interactionRaw,
        p.interactionNum,
        dateKey,
        capturedAt
      );
  }

  getProfileDayBounds(userId: string, dateKey: string): {
    first: ProfileSnapshot | null;
    last: ProfileSnapshot | null;
  } {
    const firstRow = this.db
      .prepare(
        'SELECT * FROM profile_snapshots WHERE user_id = ? AND date_key = ? ORDER BY id ASC LIMIT 1'
      )
      .get(userId, dateKey) as Record<string, unknown> | undefined;
    const lastRow = this.db
      .prepare(
        'SELECT * FROM profile_snapshots WHERE user_id = ? AND date_key = ? ORDER BY id DESC LIMIT 1'
      )
      .get(userId, dateKey) as Record<string, unknown> | undefined;

    const mapRow = (r?: Record<string, unknown>): ProfileSnapshot | null =>
      r
        ? {
            userId: String(r.user_id),
            redId: String(r.red_id),
            nickname: String(r.nickname),
            gender: String(r.gender || ''),
            avatar: String(r.avatar),
            desc: normalizeProfileBio(r.desc),
            ipLocation: String(r.ip_location),
            followsRaw: String(r.follows_raw),
            followsNum: Number(r.follows_num),
            fansRaw: String(r.fans_raw),
            fansNum: Number(r.fans_num),
            interactionRaw: String(r.interaction_raw),
            interactionNum: Number(r.interaction_num),
          }
        : null;

    if (!firstRow) {
      const latestBefore = this.db
        .prepare(
          'SELECT * FROM profile_snapshots WHERE user_id = ? AND date_key <= ? ORDER BY id DESC LIMIT 1'
        )
        .get(userId, dateKey) as Record<string, unknown> | undefined;
      const mapped = mapRow(latestBefore);
      return { first: mapped, last: mapped };
    }

    // 尝试取前一天最后一条作为起始基线，使当日净增更准确
    const prevDayLast = this.db
      .prepare(
        'SELECT * FROM profile_snapshots WHERE user_id = ? AND date_key < ? ORDER BY id DESC LIMIT 1'
      )
      .get(userId, dateKey) as Record<string, unknown> | undefined;

    return {
      first: mapRow(prevDayLast || firstRow),
      last: mapRow(lastRow),
    };
  }

  // ==================== Notes ====================
  private mapNoteRow(r: Record<string, unknown>): StoredNoteRow {
    return {
      noteId: String(r.note_id),
      userId: String(r.user_id),
      xsecToken: String(r.xsec_token || ''),
      title: String(r.title || ''),
      desc: String(r.desc || ''),
      noteType: String(r.note_type || 'normal'),
      publishedAt: r.published_at !== null && r.published_at !== undefined ? Number(r.published_at) : null,
      updatedAt: r.updated_at !== null && r.updated_at !== undefined ? Number(r.updated_at) : null,
      lastEditedAtMs:
        r.last_edited_at_ms !== null && r.last_edited_at_ms !== undefined
          ? Number(r.last_edited_at_ms)
          : null,
      lastEditedTimeText: String(r.last_edited_time_text || ''),
      editCount: Number(r.edit_count || 0),
      firstRenderedTimeText: String(r.first_rendered_time_text || ''),
      latestRenderedTimeText: String(r.latest_rendered_time_text || ''),
      verifiedPublishMs:
        r.verified_publish_ms !== null && r.verified_publish_ms !== undefined
          ? Number(r.verified_publish_ms)
          : null,
      verifiedTimeText: String(r.verified_time_text || ''),
      ipLocation: String(r.ip_location || ''),
      likedRaw: String(r.liked_raw || '0'),
      likedNum: Number(r.liked_num || 0),
      collectedRaw: String(r.collected_raw || '0'),
      collectedNum: Number(r.collected_num || 0),
      commentRaw: String(r.comment_raw || '0'),
      commentNum: Number(r.comment_num || 0),
      coverUrl: String(r.cover_url || ''),
      imageUrls: JSON.parse(String(r.image_urls_json || '[]')),
      localPhotoPaths: JSON.parse(String(r.local_photo_paths_json || '[]')),
      status: String(r.status || 'ACTIVE') as StoredNoteRow['status'],
      missingStreak: Number(r.missing_streak || 0),
      isBaseline: Number(r.is_baseline || 0) === 1,
      firstSeenAt: String(r.first_seen_at),
      firstSeenDateKey: String(r.first_seen_date_key),
      lastSeenAt: String(r.last_seen_at),
      deletedDetectedAt: r.deleted_detected_at ? String(r.deleted_detected_at) : null,
      estimatedDeletedAt: r.estimated_deleted_at ? String(r.estimated_deleted_at) : null,
      estimatedDeleteWindow: r.estimated_delete_window ? String(r.estimated_delete_window) : null,
    };
  }

  getNote(noteId: string): StoredNoteRow | null {
    const row = this.db
      .prepare('SELECT * FROM notes WHERE note_id = ?')
      .get(noteId) as Record<string, unknown> | undefined;
    return row ? this.mapNoteRow(row) : null;
  }

  getAllNotes(userId?: string): StoredNoteRow[] {
    const rows = (userId
      ? this.db
          .prepare('SELECT * FROM notes WHERE user_id = ? ORDER BY COALESCE(verified_publish_ms, published_at, 0) DESC, first_seen_at DESC')
          .all(userId)
      : this.db
          .prepare('SELECT * FROM notes ORDER BY COALESCE(verified_publish_ms, published_at, 0) DESC, first_seen_at DESC')
          .all()) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapNoteRow(r));
  }

  getNotesByFirstSeenDate(
    dateKey: string,
    includeBaseline = false,
    userId?: string
  ): StoredNoteRow[] {
    const conds = ['first_seen_date_key = ?'];
    const params: Array<string | number> = [dateKey];
    if (!includeBaseline) conds.push('is_baseline = 0');
    if (userId) {
      conds.push('user_id = ?');
      params.push(userId);
    }
    const rows = this.db
      .prepare(`SELECT * FROM notes WHERE ${conds.join(' AND ')} ORDER BY first_seen_at ASC`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapNoteRow(r));
  }

  upsertNote(note: StoredNoteRow): void {
    this.db
      .prepare(
        `INSERT INTO notes (
          note_id, user_id, xsec_token, title, desc, note_type,
          published_at, updated_at, last_edited_at_ms, last_edited_time_text, edit_count,
          first_rendered_time_text, latest_rendered_time_text,
          verified_publish_ms, verified_time_text, ip_location,
          liked_raw, liked_num, collected_raw, collected_num, comment_raw, comment_num,
          cover_url, image_urls_json, local_photo_paths_json,
          status, missing_streak, is_baseline,
          first_seen_at, first_seen_date_key, last_seen_at,
          deleted_detected_at, estimated_deleted_at, estimated_delete_window
        ) VALUES (
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?
        )
        ON CONFLICT(note_id) DO UPDATE SET
          xsec_token = CASE WHEN excluded.xsec_token != '' THEN excluded.xsec_token ELSE notes.xsec_token END,
          title = excluded.title,
          desc = excluded.desc,
          note_type = excluded.note_type,
          published_at = COALESCE(excluded.published_at, notes.published_at),
          updated_at = COALESCE(excluded.updated_at, notes.updated_at),
          last_edited_at_ms = COALESCE(excluded.last_edited_at_ms, notes.last_edited_at_ms),
          last_edited_time_text = CASE WHEN excluded.last_edited_time_text != '' THEN excluded.last_edited_time_text ELSE notes.last_edited_time_text END,
          edit_count = MAX(excluded.edit_count, notes.edit_count),
          latest_rendered_time_text = CASE WHEN excluded.latest_rendered_time_text != '' THEN excluded.latest_rendered_time_text ELSE notes.latest_rendered_time_text END,
          verified_publish_ms = COALESCE(excluded.verified_publish_ms, notes.verified_publish_ms),
          verified_time_text = CASE WHEN excluded.verified_time_text != '' THEN excluded.verified_time_text ELSE notes.verified_time_text END,
          ip_location = CASE WHEN excluded.ip_location != '' THEN excluded.ip_location ELSE notes.ip_location END,
          liked_raw = excluded.liked_raw,
          liked_num = excluded.liked_num,
          collected_raw = excluded.collected_raw,
          collected_num = excluded.collected_num,
          comment_raw = excluded.comment_raw,
          comment_num = excluded.comment_num,
          cover_url = CASE WHEN excluded.cover_url != '' THEN excluded.cover_url ELSE notes.cover_url END,
          image_urls_json = excluded.image_urls_json,
          local_photo_paths_json = excluded.local_photo_paths_json,
          status = excluded.status,
          missing_streak = excluded.missing_streak,
          last_seen_at = excluded.last_seen_at,
          deleted_detected_at = excluded.deleted_detected_at,
          estimated_deleted_at = excluded.estimated_deleted_at,
          estimated_delete_window = excluded.estimated_delete_window`
      )
      .run(
        note.noteId,
        note.userId,
        note.xsecToken,
        note.title,
        note.desc,
        note.noteType,
        note.publishedAt,
        note.updatedAt,
        note.lastEditedAtMs,
        note.lastEditedTimeText,
        note.editCount,
        note.firstRenderedTimeText,
        note.latestRenderedTimeText,
        note.verifiedPublishMs,
        note.verifiedTimeText,
        note.ipLocation,
        note.likedRaw,
        note.likedNum,
        note.collectedRaw,
        note.collectedNum,
        note.commentRaw,
        note.commentNum,
        note.coverUrl,
        JSON.stringify(note.imageUrls),
        JSON.stringify(note.localPhotoPaths),
        note.status,
        note.missingStreak,
        note.isBaseline ? 1 : 0,
        note.firstSeenAt,
        note.firstSeenDateKey,
        note.lastSeenAt,
        note.deletedDetectedAt,
        note.estimatedDeletedAt,
        note.estimatedDeleteWindow
      );
  }

  recordNoteMetricPoint(
    noteId: string,
    likedNum: number,
    collectedNum: number,
    commentNum: number,
    capturedAt = nowIso()
  ): void {
    this.db
      .prepare(
        `INSERT INTO note_metric_points (note_id, date_key, liked_num, collected_num, comment_num, captured_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(noteId, getLocalDateKey(capturedAt), likedNum, collectedNum, commentNum, capturedAt);
  }

  getNoteMetricDeltaForDate(
    noteId: string,
    dateKey: string
  ): { likedDelta: number; collectedDelta: number } {
    const first = this.db
      .prepare(
        'SELECT liked_num, collected_num FROM note_metric_points WHERE note_id = ? AND date_key <= ? ORDER BY CASE WHEN date_key < ? THEN 0 ELSE 1 END ASC, id DESC LIMIT 1'
      )
      .get(noteId, dateKey, dateKey) as { liked_num: number; collected_num: number } | undefined;
    const firstInDay = this.db
      .prepare(
        'SELECT liked_num, collected_num FROM note_metric_points WHERE note_id = ? AND date_key = ? ORDER BY id ASC LIMIT 1'
      )
      .get(noteId, dateKey) as { liked_num: number; collected_num: number } | undefined;
    const lastInDay = this.db
      .prepare(
        'SELECT liked_num, collected_num FROM note_metric_points WHERE note_id = ? AND date_key = ? ORDER BY id DESC LIMIT 1'
      )
      .get(noteId, dateKey) as { liked_num: number; collected_num: number } | undefined;

    const baseline = first || firstInDay;
    if (!baseline || !lastInDay) return { likedDelta: 0, collectedDelta: 0 };
    return {
      likedDelta: lastInDay.liked_num - baseline.liked_num,
      collectedDelta: lastInDay.collected_num - baseline.collected_num,
    };
  }

  insertNoteRevision(params: {
    noteId: string;
    oldTitle: string;
    newTitle: string;
    oldDesc: string;
    newDesc: string;
    oldImages: string[];
    newImages: string[];
    editedAtMs?: number | null;
    editedTimeText?: string;
    renderedTimeText?: string;
    estimatedEditWindow?: string | null;
    changedAt: string;
  }): NoteRevisionItem {
    const editedAtMs = params.editedAtMs ?? null;
    const editedTimeText = params.editedTimeText || '';
    const renderedTimeText = params.renderedTimeText || '';
    const estimatedEditWindow = params.estimatedEditWindow ?? null;
    const res = this.db
      .prepare(
        `INSERT INTO note_revisions (
          note_id, old_title, new_title, old_desc, new_desc, old_images_json, new_images_json,
          edited_at_ms, edited_time_text, rendered_time_text, estimated_edit_window, changed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.noteId,
        params.oldTitle,
        params.newTitle,
        params.oldDesc,
        params.newDesc,
        JSON.stringify(params.oldImages),
        JSON.stringify(params.newImages),
        editedAtMs,
        editedTimeText,
        renderedTimeText,
        estimatedEditWindow,
        params.changedAt
      );
    return {
      id: Number(res.lastInsertRowid),
      noteId: params.noteId,
      oldTitle: params.oldTitle,
      newTitle: params.newTitle,
      oldDesc: params.oldDesc,
      newDesc: params.newDesc,
      oldImages: params.oldImages,
      newImages: params.newImages,
      editedAtMs,
      editedTimeText,
      renderedTimeText,
      estimatedEditWindow,
      changedAt: params.changedAt,
    };
  }

  getNoteRevisions(noteId: string): NoteRevisionItem[] {
    const rows = this.db
      .prepare('SELECT * FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT 50')
      .all(noteId) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      noteId: String(r.note_id),
      oldTitle: String(r.old_title || ''),
      newTitle: String(r.new_title || ''),
      oldDesc: String(r.old_desc || ''),
      newDesc: String(r.new_desc || ''),
      oldImages: JSON.parse(String(r.old_images_json || '[]')),
      newImages: JSON.parse(String(r.new_images_json || '[]')),
      editedAtMs:
        r.edited_at_ms !== null && r.edited_at_ms !== undefined ? Number(r.edited_at_ms) : null,
      editedTimeText: String(r.edited_time_text || ''),
      renderedTimeText: String(r.rendered_time_text || ''),
      estimatedEditWindow: r.estimated_edit_window ? String(r.estimated_edit_window) : null,
      changedAt: String(r.changed_at),
    }));
  }

  updateLatestRevisionEditTime(
    noteId: string,
    editedAtMs: number,
    editedTimeText: string,
    renderedTimeText: string
  ): void {
    const latest = this.db
      .prepare('SELECT id FROM note_revisions WHERE note_id = ? ORDER BY id DESC LIMIT 1')
      .get(noteId) as { id: number } | undefined;
    if (!latest) return;
    this.db
      .prepare(
        `UPDATE note_revisions
         SET edited_at_ms = ?,
             edited_time_text = ?,
             rendered_time_text = CASE WHEN ? != '' THEN ? ELSE rendered_time_text END
         WHERE id = ?`
      )
      .run(editedAtMs, editedTimeText, renderedTimeText, renderedTimeText, Number(latest.id));
  }

  getEditedNoteIdsForDate(dateKey: string, userId?: string): string[] {
    const { startIso, endIso } = getLocalDayBoundsIso(dateKey);
    const rows = (userId
      ? this.db
          .prepare(
            `SELECT DISTINCT r.note_id
             FROM note_revisions r
             INNER JOIN notes n ON r.note_id = n.note_id
             WHERE r.changed_at >= ? AND r.changed_at <= ? AND n.user_id = ?`
          )
          .all(startIso, endIso, userId)
      : this.db
          .prepare(
            `SELECT DISTINCT note_id FROM note_revisions
             WHERE changed_at >= ? AND changed_at <= ?`
          )
          .all(startIso, endIso)) as Array<{ note_id: string }>;
    return rows.map((r) => String(r.note_id));
  }

  // ==================== Comments & User RedId Cache ====================
  upsertUserRedId(userId: string, redId: string, nickname = '', xsecToken = ''): string[] {
    const uid = (userId || '').trim();
    const rid = (redId || '').trim();
    if (!uid || !rid) return [];

    this.db
      .prepare(
        `INSERT INTO user_red_id_cache (user_id, red_id, nickname, xsec_token, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           red_id = CASE WHEN excluded.red_id != 'UNKNOWN' THEN excluded.red_id ELSE user_red_id_cache.red_id END,
           nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE user_red_id_cache.nickname END,
           xsec_token = CASE WHEN excluded.xsec_token != '' THEN excluded.xsec_token ELSE user_red_id_cache.xsec_token END,
           updated_at = excluded.updated_at`
      )
      .run(uid, rid, nickname, xsecToken, nowIso());

    if (rid === 'UNKNOWN') return [];

    // 找出将被补齐小红书号的所属笔记 ID，便于同步刷新本地 JSON 备份文件
    const affectedNotes = (
      this.db
        .prepare(
          `SELECT DISTINCT note_id FROM comments
           WHERE (user_id = ? AND (user_red_id = '' OR user_red_id IS NULL))
              OR (target_user_id = ? AND (target_red_id = '' OR target_red_id IS NULL))`
        )
        .all(uid, uid) as Array<{ note_id: string }>
    ).map((r) => String(r.note_id));

    this.db
      .prepare(`UPDATE comments SET user_red_id = ? WHERE user_id = ?`)
      .run(rid, uid);
    this.db
      .prepare(`UPDATE comments SET target_red_id = ? WHERE target_user_id = ?`)
      .run(rid, uid);

    return affectedNotes;
  }

  getCachedRedId(userId: string): string {
    if (!userId) return '';
    const row = this.db
      .prepare('SELECT red_id FROM user_red_id_cache WHERE user_id = ?')
      .get(userId) as { red_id: string } | undefined;
    if (!row || row.red_id === 'UNKNOWN') return '';
    return String(row.red_id);
  }

  /**
   * 导出本地库全部已知用户的 userId -> redId 映射（包含已标记为 UNKNOWN 的用户），
   * 供采集器启动前全量校验，确保已有记录绝不重复访问对方主页
   */
  getAllCachedUserRedIds(): Record<string, string> {
    const map: Record<string, string> = {};
    const cacheRows = this.db
      .prepare("SELECT user_id, red_id FROM user_red_id_cache WHERE user_id != '' AND red_id != ''")
      .all() as Array<{ user_id: string; red_id: string }>;
    for (const r of cacheRows) {
      map[String(r.user_id)] = String(r.red_id);
    }
    const commentRows = this.db
      .prepare(
        "SELECT DISTINCT user_id, user_red_id FROM comments WHERE user_id != '' AND user_red_id != ''"
      )
      .all() as Array<{ user_id: string; user_red_id: string }>;
    for (const r of commentRows) {
      const uid = String(r.user_id);
      if (!map[uid] || map[uid] === 'UNKNOWN') {
        map[uid] = String(r.user_red_id);
      }
    }
    return map;
  }

  private mapCommentRow(r: Record<string, unknown>): StoredCommentRow {
    return {
      commentId: String(r.comment_id),
      noteId: String(r.note_id),
      parentId: r.parent_id ? String(r.parent_id) : null,
      userId: String(r.user_id || ''),
      userRedId: String(r.user_red_id || ''),
      userXsecToken: String(r.user_xsec_token || ''),
      nickname: String(r.nickname || ''),
      userAvatar: String(r.user_avatar || ''),
      targetUserId: String(r.target_user_id || ''),
      targetRedId: String(r.target_red_id || ''),
      targetNickname: String(r.target_nickname || ''),
      content: String(r.content || ''),
      pictureUrls: JSON.parse(String(r.picture_urls_json || '[]')),
      localPhotoPaths: JSON.parse(String(r.local_photo_paths_json || '[]')),
      createdAt: r.created_at !== null && r.created_at !== undefined ? Number(r.created_at) : null,
      firstRenderedTimeText: String(r.first_rendered_time_text || ''),
      latestRenderedTimeText: String(r.latest_rendered_time_text || ''),
      verifiedCreatedMs:
        r.verified_created_ms !== null && r.verified_created_ms !== undefined
          ? Number(r.verified_created_ms)
          : null,
      verifiedTimeText: String(r.verified_time_text || ''),
      ipLocation: String(r.ip_location || ''),
      likeCountRaw: String(r.like_count_raw || '0'),
      status: String(r.status || 'ACTIVE') as StoredCommentRow['status'],
      isBaseline: Number(r.is_baseline || 0) === 1,
      firstSeenAt: String(r.first_seen_at),
      firstSeenDateKey: String(r.first_seen_date_key),
      lastSeenAt: String(r.last_seen_at),
      deletedDetectedAt: r.deleted_detected_at ? String(r.deleted_detected_at) : null,
      estimatedDeleteWindow: r.estimated_delete_window ? String(r.estimated_delete_window) : null,
    };
  }

  getCommentsByNote(noteId: string): StoredCommentRow[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM comments WHERE note_id = ? ORDER BY COALESCE(verified_created_ms, created_at, 0) ASC, first_seen_at ASC'
      )
      .all(noteId) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapCommentRow(r));
  }

  getComment(commentId: string): StoredCommentRow | null {
    const row = this.db
      .prepare('SELECT * FROM comments WHERE comment_id = ?')
      .get(commentId) as Record<string, unknown> | undefined;
    return row ? this.mapCommentRow(row) : null;
  }

  getCommentsByFirstSeenDate(
    dateKey: string,
    includeBaseline = false,
    userId?: string
  ): StoredCommentRow[] {
    const conds = ['c.first_seen_date_key = ?'];
    const params: Array<string | number> = [dateKey];
    if (!includeBaseline) conds.push('c.is_baseline = 0');
    const join = userId ? 'INNER JOIN notes n ON c.note_id = n.note_id' : '';
    if (userId) {
      conds.push('n.user_id = ?');
      params.push(userId);
    }
    const rows = this.db
      .prepare(
        `SELECT c.* FROM comments c ${join} WHERE ${conds.join(' AND ')} ORDER BY c.first_seen_at ASC`
      )
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => this.mapCommentRow(r));
  }

  upsertComment(c: StoredCommentRow): void {
    this.db
      .prepare(
        `INSERT INTO comments (
          comment_id, note_id, parent_id,
          user_id, user_red_id, user_xsec_token, nickname, user_avatar,
          target_user_id, target_red_id, target_nickname,
          content, picture_urls_json, local_photo_paths_json,
          created_at, first_rendered_time_text, latest_rendered_time_text,
          verified_created_ms, verified_time_text, ip_location, like_count_raw,
          status, is_baseline, first_seen_at, first_seen_date_key, last_seen_at,
          deleted_detected_at, estimated_delete_window
        ) VALUES (
          ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, ?, ?, ?,
          ?, ?
        )
        ON CONFLICT(comment_id) DO UPDATE SET
          user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE comments.user_id END,
          user_red_id = CASE WHEN excluded.user_red_id != '' THEN excluded.user_red_id ELSE comments.user_red_id END,
          user_xsec_token = CASE WHEN excluded.user_xsec_token != '' THEN excluded.user_xsec_token ELSE comments.user_xsec_token END,
          nickname = CASE WHEN excluded.nickname != '' THEN excluded.nickname ELSE comments.nickname END,
          target_user_id = CASE WHEN excluded.target_user_id != '' THEN excluded.target_user_id ELSE comments.target_user_id END,
          target_red_id = CASE WHEN excluded.target_red_id != '' THEN excluded.target_red_id ELSE comments.target_red_id END,
          content = CASE WHEN excluded.content != '' THEN excluded.content ELSE comments.content END,
          picture_urls_json = excluded.picture_urls_json,
          local_photo_paths_json = excluded.local_photo_paths_json,
          created_at = COALESCE(excluded.created_at, comments.created_at),
          latest_rendered_time_text = CASE WHEN excluded.latest_rendered_time_text != '' THEN excluded.latest_rendered_time_text ELSE comments.latest_rendered_time_text END,
          verified_created_ms = COALESCE(excluded.verified_created_ms, comments.verified_created_ms),
          verified_time_text = CASE WHEN excluded.verified_time_text != '' THEN excluded.verified_time_text ELSE comments.verified_time_text END,
          ip_location = CASE WHEN excluded.ip_location != '' THEN excluded.ip_location ELSE comments.ip_location END,
          like_count_raw = excluded.like_count_raw,
          status = excluded.status,
          last_seen_at = excluded.last_seen_at,
          deleted_detected_at = excluded.deleted_detected_at,
          estimated_delete_window = excluded.estimated_delete_window`
      )
      .run(
        c.commentId,
        c.noteId,
        c.parentId,
        c.userId,
        c.userRedId,
        c.userXsecToken,
        c.nickname,
        c.userAvatar,
        c.targetUserId,
        c.targetRedId,
        c.targetNickname,
        c.content,
        JSON.stringify(c.pictureUrls),
        JSON.stringify(c.localPhotoPaths),
        c.createdAt,
        c.firstRenderedTimeText,
        c.latestRenderedTimeText,
        c.verifiedCreatedMs,
        c.verifiedTimeText,
        c.ipLocation,
        c.likeCountRaw,
        c.status,
        c.isBaseline ? 1 : 0,
        c.firstSeenAt,
        c.firstSeenDateKey,
        c.lastSeenAt,
        c.deletedDetectedAt,
        c.estimatedDeleteWindow
      );
  }

  // ==================== Events ====================
  insertEvent(ev: MonitorEvent): MonitorEvent {
    const dateKey = getLocalDateKey(ev.createdAt);
    const userId = ev.userId || '';
    const res = this.db
      .prepare(
        `INSERT INTO events (
          user_id, event_type, title, body, note_id, comment_id,
          level, should_push, triggers_burst, is_activity,
          before_json, after_json, date_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        ev.eventType,
        ev.title,
        ev.body,
        ev.noteId || null,
        ev.commentId || null,
        ev.level,
        ev.shouldPush ? 1 : 0,
        ev.triggersBurst ? 1 : 0,
        ev.isActivity ? 1 : 0,
        ev.beforeSnapshot ? JSON.stringify(ev.beforeSnapshot) : null,
        ev.afterSnapshot ? JSON.stringify(ev.afterSnapshot) : null,
        dateKey,
        ev.createdAt
      );
    return { ...ev, userId, id: Number(res.lastInsertRowid) };
  }

  updateEventPushStatus(eventId: number, pushed: boolean, pushError?: string): void {
    this.db
      .prepare('UPDATE events SET pushed = ?, push_error = ? WHERE id = ?')
      .run(pushed ? 1 : 0, pushError || null, eventId);
  }

  getRecentEvents(limit = 80, dateKey?: string, userId?: string): MonitorEvent[] {
    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (userId) {
      conds.push('user_id = ?');
      params.push(userId);
    }
    if (dateKey) {
      conds.push('date_key = ?');
      params.push(dateKey);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    params.push(limit);
    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id || ''),
      eventType: String(r.event_type) as MonitorEvent['eventType'],
      title: String(r.title),
      body: String(r.body),
      noteId: r.note_id ? String(r.note_id) : undefined,
      commentId: r.comment_id ? String(r.comment_id) : undefined,
      level: String(r.level) as MonitorEvent['level'],
      shouldPush: Number(r.should_push) === 1,
      triggersBurst: Number(r.triggers_burst) === 1,
      isActivity: Number(r.is_activity) === 1,
      beforeSnapshot: r.before_json ? JSON.parse(String(r.before_json)) : undefined,
      afterSnapshot: r.after_json ? JSON.parse(String(r.after_json)) : undefined,
      pushed: Number(r.pushed) === 1,
      pushError: r.push_error ? String(r.push_error) : undefined,
      createdAt: String(r.created_at),
    }));
  }

  getEventsForDate(dateKey: string, userId?: string): MonitorEvent[] {
    const { startIso, endIso } = getLocalDayBoundsIso(dateKey);
    const rows = (userId
      ? this.db
          .prepare(
            'SELECT * FROM events WHERE user_id = ? AND (date_key = ? OR (created_at >= ? AND created_at <= ?)) ORDER BY id ASC'
          )
          .all(userId, dateKey, startIso, endIso)
      : this.db
          .prepare(
            'SELECT * FROM events WHERE date_key = ? OR (created_at >= ? AND created_at <= ?) ORDER BY id ASC'
          )
          .all(dateKey, startIso, endIso)) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id || ''),
      eventType: String(r.event_type) as MonitorEvent['eventType'],
      title: String(r.title),
      body: String(r.body),
      noteId: r.note_id ? String(r.note_id) : undefined,
      commentId: r.comment_id ? String(r.comment_id) : undefined,
      level: String(r.level) as MonitorEvent['level'],
      shouldPush: Number(r.should_push) === 1,
      triggersBurst: Number(r.triggers_burst) === 1,
      isActivity: Number(r.is_activity) === 1,
      createdAt: String(r.created_at),
    }));
  }

  // ==================== Comparison Records ====================
  insertComparisonRecord(rec: ComparisonRecord): ComparisonRecord {
    const userId = rec.userId || '';
    const res = this.db
      .prepare(
        `INSERT INTO comparison_records (
          user_id, date_key, compare_type, note_id, comment_id, note_title, author_nickname,
          local_saved_content, new_content_if_edited, local_photo_paths_json,
          note_publish_time, comment_publish_time, first_captured_time,
          last_seen_alive_time, detected_change_time, estimated_action_time_text,
          survival_minutes, summary_text, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        rec.dateKey,
        rec.compareType,
        rec.noteId,
        rec.commentId,
        rec.noteTitle,
        rec.authorNickname,
        rec.localSavedContent,
        rec.newContentIfEdited,
        JSON.stringify(rec.localPhotoPaths || []),
        rec.notePublishTime,
        rec.commentPublishTime,
        rec.firstCapturedTime,
        rec.lastSeenAliveTime,
        rec.detectedChangeTime,
        rec.estimatedActionTimeText,
        rec.survivalMinutes,
        rec.summaryText,
        rec.detectedChangeTime || nowIso()
      );
    return { ...rec, userId, id: Number(res.lastInsertRowid) };
  }

  getComparisonRecords(opts?: {
    userId?: string;
    dateKey?: string;
    compareType?: string;
    limit?: number;
  }): ComparisonRecord[] {
    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (opts?.userId) {
      conds.push('user_id = ?');
      params.push(opts.userId);
    }
    if (opts?.dateKey) {
      conds.push('date_key = ?');
      params.push(opts.dateKey);
    }
    if (opts?.compareType) {
      conds.push('compare_type = ?');
      params.push(opts.compareType);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = opts?.limit || 100;
    params.push(limit);

    const rows = this.db
      .prepare(`SELECT * FROM comparison_records ${where} ORDER BY id DESC LIMIT ?`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id || ''),
      dateKey: String(r.date_key),
      compareType: String(r.compare_type) as ComparisonRecord['compareType'],
      noteId: String(r.note_id),
      commentId: r.comment_id ? String(r.comment_id) : null,
      noteTitle: String(r.note_title),
      authorNickname: String(r.author_nickname),
      localSavedContent: String(r.local_saved_content),
      newContentIfEdited: r.new_content_if_edited ? String(r.new_content_if_edited) : null,
      localPhotoPaths: JSON.parse(String(r.local_photo_paths_json || '[]')),
      notePublishTime: String(r.note_publish_time),
      commentPublishTime: r.comment_publish_time ? String(r.comment_publish_time) : null,
      firstCapturedTime: String(r.first_captured_time),
      lastSeenAliveTime: r.last_seen_alive_time ? String(r.last_seen_alive_time) : null,
      detectedChangeTime: String(r.detected_change_time),
      estimatedActionTimeText: String(r.estimated_action_time_text),
      survivalMinutes:
        r.survival_minutes !== null && r.survival_minutes !== undefined
          ? Number(r.survival_minutes)
          : null,
      summaryText: String(r.summary_text),
    }));
  }

  // ==================== Time Reconciliations ====================
  upsertTimeReconciliation(item: TimeReconciliationItem): void {
    const userId = item.userId || '';
    this.db
      .prepare(
        `INSERT INTO time_reconciliations (
          user_id, target_date_key, item_type, target_id, note_id, title_or_excerpt, author_nickname,
          local_recorded_at, same_day_platform_time_text, same_day_estimated_ms,
          next_day_verified_time_text, verified_platform_ms,
          capture_delay_minutes, estimate_error_minutes, diff_minutes,
          status, anomaly_reason, review_note, checked_at, reviewed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(target_date_key, item_type, target_id) DO UPDATE SET
          user_id = CASE WHEN excluded.user_id != '' THEN excluded.user_id ELSE time_reconciliations.user_id END,
          title_or_excerpt = excluded.title_or_excerpt,
          next_day_verified_time_text = excluded.next_day_verified_time_text,
          verified_platform_ms = excluded.verified_platform_ms,
          capture_delay_minutes = excluded.capture_delay_minutes,
          estimate_error_minutes = excluded.estimate_error_minutes,
          diff_minutes = excluded.diff_minutes,
          status = CASE WHEN time_reconciliations.status = 'REVIEWED_OK' THEN 'REVIEWED_OK' ELSE excluded.status END,
          anomaly_reason = excluded.anomaly_reason,
          checked_at = excluded.checked_at`
      )
      .run(
        userId,
        item.targetDateKey,
        item.itemType,
        item.targetId,
        item.noteId,
        item.titleOrExcerpt,
        item.authorNickname,
        item.localRecordedAt,
        item.sameDayPlatformTimeText,
        item.sameDayEstimatedMs,
        item.nextDayVerifiedTimeText,
        item.verifiedPlatformMs,
        item.captureDelayMinutes,
        item.estimateErrorMinutes,
        item.diffMinutes,
        item.status,
        item.anomalyReason,
        item.reviewNote,
        item.checkedAt,
        item.reviewedAt
      );
  }

  getTimeReconciliations(dateKey?: string, userId?: string): TimeReconciliationItem[] {
    const conds: string[] = [];
    const params: Array<string | number> = [];
    if (userId) {
      conds.push('user_id = ?');
      params.push(userId);
    }
    if (dateKey) {
      conds.push('target_date_key = ?');
      params.push(dateKey);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const orderAndLimit = dateKey ? 'ORDER BY local_recorded_at ASC' : 'ORDER BY id DESC LIMIT 120';
    const rows = this.db
      .prepare(`SELECT * FROM time_reconciliations ${where} ${orderAndLimit}`)
      .all(...params) as Array<Record<string, unknown>>;

    return rows.map((r) => ({
      id: Number(r.id),
      userId: String(r.user_id || ''),
      targetDateKey: String(r.target_date_key),
      itemType: String(r.item_type) as 'NOTE' | 'COMMENT',
      targetId: String(r.target_id),
      noteId: String(r.note_id),
      titleOrExcerpt: String(r.title_or_excerpt),
      authorNickname: String(r.author_nickname),
      localRecordedAt: String(r.local_recorded_at),
      sameDayPlatformTimeText: String(r.same_day_platform_time_text),
      sameDayEstimatedMs:
        r.same_day_estimated_ms !== null && r.same_day_estimated_ms !== undefined
          ? Number(r.same_day_estimated_ms)
          : null,
      nextDayVerifiedTimeText: String(r.next_day_verified_time_text),
      verifiedPlatformMs:
        r.verified_platform_ms !== null && r.verified_platform_ms !== undefined
          ? Number(r.verified_platform_ms)
          : null,
      captureDelayMinutes:
        r.capture_delay_minutes !== null && r.capture_delay_minutes !== undefined
          ? Number(r.capture_delay_minutes)
          : null,
      estimateErrorMinutes:
        r.estimate_error_minutes !== null && r.estimate_error_minutes !== undefined
          ? Number(r.estimate_error_minutes)
          : null,
      diffMinutes:
        r.diff_minutes !== null && r.diff_minutes !== undefined ? Number(r.diff_minutes) : null,
      status: String(r.status) as ReconciliationStatus,
      anomalyReason: String(r.anomaly_reason || ''),
      reviewNote: String(r.review_note || ''),
      checkedAt: String(r.checked_at),
      reviewedAt: r.reviewed_at ? String(r.reviewed_at) : null,
    }));
  }

  markReconciliationReviewed(id: number, reviewNote: string): void {
    this.db
      .prepare(
        `UPDATE time_reconciliations
         SET status = 'REVIEWED_OK', review_note = ?, reviewed_at = ?
         WHERE id = ?`
      )
      .run(reviewNote || '已人工确认无误', nowIso(), id);
  }

  // ==================== Daily Reports & Patrol Runs ====================
  saveDailyReport(report: DailyAnalyticsReport): void {
    const userId = report.account?.userId || '';
    this.db
      .prepare(
        `INSERT INTO daily_reports (user_id, date_key, generated_at, is_next_day_verified, markdown_path, report_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(user_id, date_key) DO UPDATE SET
           generated_at = excluded.generated_at,
           is_next_day_verified = excluded.is_next_day_verified,
           markdown_path = excluded.markdown_path,
           report_json = excluded.report_json`
      )
      .run(
        userId,
        report.dateKey,
        report.generatedAt,
        report.isNextDayVerified ? 1 : 0,
        report.markdownReportPath,
        JSON.stringify(report)
      );
  }

  getDailyReport(dateKey: string, userId?: string): DailyAnalyticsReport | null {
    const row = (userId
      ? this.db
          .prepare('SELECT report_json FROM daily_reports WHERE user_id = ? AND date_key = ?')
          .get(userId, dateKey)
      : this.db
          .prepare(
            'SELECT report_json FROM daily_reports WHERE date_key = ? ORDER BY generated_at DESC LIMIT 1'
          )
          .get(dateKey)) as { report_json: string } | undefined;
    return row ? (JSON.parse(row.report_json) as DailyAnalyticsReport) : null;
  }

  listDailyReportDates(
    userId?: string
  ): Array<{ dateKey: string; generatedAt: string; isNextDayVerified: boolean }> {
    const rows = (userId
      ? this.db
          .prepare(
            'SELECT date_key, generated_at, is_next_day_verified FROM daily_reports WHERE user_id = ? ORDER BY date_key DESC LIMIT 60'
          )
          .all(userId)
      : this.db
          .prepare(
            'SELECT date_key, generated_at, is_next_day_verified FROM daily_reports ORDER BY date_key DESC LIMIT 60'
          )
          .all()) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      dateKey: String(r.date_key),
      generatedAt: String(r.generated_at),
      isNextDayVerified: Number(r.is_next_day_verified) === 1,
    }));
  }

  recordPatrolRun(params: {
    userId?: string;
    runType: string;
    status: string;
    notesScanned: number;
    commentsScanned: number;
    eventsCount: number;
    errorMsg?: string;
    startedAt: string;
    finishedAt?: string;
  }): void {
    const finishedAt = params.finishedAt || nowIso();
    this.db
      .prepare(
        `INSERT INTO patrol_runs (
          user_id, run_type, status, notes_scanned, comments_scanned, events_count, error_msg, date_key, started_at, finished_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        params.userId || '',
        params.runType,
        params.status,
        params.notesScanned,
        params.commentsScanned,
        params.eventsCount,
        params.errorMsg || null,
        getLocalDateKey(params.startedAt),
        params.startedAt,
        finishedAt
      );
  }

  countPatrolRunsForDate(dateKey: string, userId?: string): number {
    const row = (userId
      ? this.db
          .prepare(
            "SELECT COUNT(*) AS cnt FROM patrol_runs WHERE user_id = ? AND date_key = ? AND status = 'OK'"
          )
          .get(userId, dateKey)
      : this.db
          .prepare("SELECT COUNT(*) AS cnt FROM patrol_runs WHERE date_key = ? AND status = 'OK'")
          .get(dateKey)) as { cnt: number } | undefined;
    return row ? Number(row.cnt) : 0;
  }

  getArchiveStats(userId?: string): {
    totalNotes: number;
    activeNotes: number;
    deletedNotes: number;
    editedNotes: number;
    baselineNotes: number;
    totalComments: number;
    activeComments: number;
    deletedComments: number;
    comparisonsCount: number;
    reconciliationsCount: number;
    ipHistoryCount: number;
    ipChangeCount: number;
    profileFieldHistoryCount: number;
    profileFieldChangeCount: number;
  } {
    const nRow = (userId
      ? this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) AS deleted,
              SUM(CASE WHEN last_edited_time_text != '' OR edit_count > 0 THEN 1 ELSE 0 END) AS edited,
              SUM(CASE WHEN is_baseline = 1 THEN 1 ELSE 0 END) AS baseline
             FROM notes WHERE user_id = ?`
          )
          .get(userId)
      : this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) AS deleted,
              SUM(CASE WHEN last_edited_time_text != '' OR edit_count > 0 THEN 1 ELSE 0 END) AS edited,
              SUM(CASE WHEN is_baseline = 1 THEN 1 ELSE 0 END) AS baseline
             FROM notes`
          )
          .get()) as Record<string, number>;
    const cRow = (userId
      ? this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN c.status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN c.status = 'DELETED' THEN 1 ELSE 0 END) AS deleted
             FROM comments c
             INNER JOIN notes n ON c.note_id = n.note_id
             WHERE n.user_id = ?`
          )
          .get(userId)
      : this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN status = 'DELETED' THEN 1 ELSE 0 END) AS deleted
             FROM comments`
          )
          .get()) as Record<string, number>;
    const compRow = (userId
      ? this.db
          .prepare('SELECT COUNT(*) AS cnt FROM comparison_records WHERE user_id = ?')
          .get(userId)
      : this.db.prepare('SELECT COUNT(*) AS cnt FROM comparison_records').get()) as { cnt: number };
    const recRow = (userId
      ? this.db
          .prepare('SELECT COUNT(*) AS cnt FROM time_reconciliations WHERE user_id = ?')
          .get(userId)
      : this.db.prepare('SELECT COUNT(*) AS cnt FROM time_reconciliations').get()) as {
      cnt: number;
    };
    const ipRow = (userId
      ? this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN previous_ip IS NOT NULL THEN 1 ELSE 0 END) AS changes
             FROM ip_history WHERE user_id = ?`
          )
          .get(userId)
      : this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN previous_ip IS NOT NULL THEN 1 ELSE 0 END) AS changes
             FROM ip_history`
          )
          .get()) as Record<string, number>;
    const pfRow = (userId
      ? this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN old_value IS NOT NULL THEN 1 ELSE 0 END) AS changes
             FROM profile_field_history WHERE user_id = ?`
          )
          .get(userId)
      : this.db
          .prepare(
            `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN old_value IS NOT NULL THEN 1 ELSE 0 END) AS changes
             FROM profile_field_history`
          )
          .get()) as Record<string, number>;

    return {
      totalNotes: Number(nRow?.total || 0),
      activeNotes: Number(nRow?.active || 0),
      deletedNotes: Number(nRow?.deleted || 0),
      editedNotes: Number(nRow?.edited || 0),
      baselineNotes: Number(nRow?.baseline || 0),
      totalComments: Number(cRow?.total || 0),
      activeComments: Number(cRow?.active || 0),
      deletedComments: Number(cRow?.deleted || 0),
      comparisonsCount: Number(compRow?.cnt || 0),
      reconciliationsCount: Number(recRow?.cnt || 0),
      ipHistoryCount: Number(ipRow?.total || 0),
      ipChangeCount: Number(ipRow?.changes || 0),
      profileFieldHistoryCount: Number(pfRow?.total || 0),
      profileFieldChangeCount: Number(pfRow?.changes || 0),
    };
  }
}
