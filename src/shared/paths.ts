import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 项目根目录 */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

/** 配置目录 */
const CONFIG_DIR = path.join(PROJECT_ROOT, 'config');
export const LOCAL_CONFIG_PATH = path.join(CONFIG_DIR, 'config.local.json');
export const EXAMPLE_CONFIG_PATH = path.join(CONFIG_DIR, 'config.example.json');

/** 本地永久数据总仓 */
export const STORAGE_ROOT = path.join(PROJECT_ROOT, 'storage');

/** 1. 照片分类存储目录（头像、笔记原图、评论配图） */
export const PHOTOS_ROOT = path.join(STORAGE_ROOT, 'photos');
export const AVATAR_PHOTOS_DIR = path.join(PHOTOS_ROOT, 'avatars');
export const NOTE_PHOTOS_DIR = path.join(PHOTOS_ROOT, 'notes');
export const COMMENT_PHOTOS_DIR = path.join(PHOTOS_ROOT, 'comments');

/** 2. SQLite 数据库存储目录 */
const DATABASE_DIR = path.join(STORAGE_ROOT, 'database');
export const DB_FILE_PATH = path.join(DATABASE_DIR, 'monitor.db');

/** 3. 本地每日异动与删改/新评对比日志目录 */
export const LOGS_DIR = path.join(STORAGE_ROOT, 'logs');

/** 4. 次日0点汇总与时间对照报告目录 */
export const REPORTS_DIR = path.join(STORAGE_ROOT, 'reports');

/** 5. 独立 Chrome 登录态目录 */
export const BROWSER_PROFILE_DIR = path.join(STORAGE_ROOT, 'browser-profile');

export function ensureAllDirectories(): void {
  const dirs = [
    CONFIG_DIR,
    STORAGE_ROOT,
    PHOTOS_ROOT,
    AVATAR_PHOTOS_DIR,
    NOTE_PHOTOS_DIR,
    COMMENT_PHOTOS_DIR,
    DATABASE_DIR,
    LOGS_DIR,
    REPORTS_DIR,
    BROWSER_PROFILE_DIR,
  ];
  for (const d of dirs) {
    if (!fs.existsSync(d)) {
      fs.mkdirSync(d, { recursive: true });
    }
  }
}
