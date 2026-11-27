import { MonitorScheduler } from '../src/engine/scheduler.ts';
import { getYesterdayDateKey, loadConfig } from '../src/shared/utils.ts';
import { MonitorDatabase } from '../src/storage/database.ts';

async function main(): Promise<void> {
  const dateArg = process.argv[2] || getYesterdayDateKey();
  const refreshOnline = !process.argv.includes('--offline');

  const config = loadConfig();
  const db = new MonitorDatabase();
  const scheduler = new MonitorScheduler(db, config);

  console.log(`[次日0点时间对照汇总] 目标日期: ${dateArg}, 是否联网刷新「昨天 HH:mm」: ${refreshOnline}`);
  const res = await scheduler.triggerReconcileForDate(dateArg, refreshOnline);
  console.log(res.message);

  db.close();
  process.exit(res.ok ? 0 : 1);
}

main();
