import { XhsCollector } from '../src/collector/xhs-collector.ts';
import { ensureAllDirectories } from '../src/shared/paths.ts';
import { loadConfig } from '../src/shared/utils.ts';

async function main(): Promise<void> {
  ensureAllDirectories();
  const config = loadConfig();
  const collector = new XhsCollector(config);

  console.log('==================================================');
  console.log('  小红书独立登录态初始化工具');
  console.log('==================================================');

  const res = await collector.openLoginSession(10, (msg) => {
    console.log(`[登录引导] ${msg}`);
  });

  console.log(res.ok ? `[完成] ${res.message}` : `[失败] ${res.message}`);
  process.exit(res.ok ? 0 : 1);
}

main();
