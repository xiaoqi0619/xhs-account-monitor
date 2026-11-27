import { exec } from 'node:child_process';
import { serve } from '@hono/node-server';
import { MonitorScheduler } from './engine/scheduler.ts';
import { ensureAllDirectories, PROJECT_ROOT, STORAGE_ROOT } from './shared/paths.ts';
import { loadConfig } from './shared/utils.ts';
import { MonitorDatabase } from './storage/database.ts';
import { createWebApp } from './web/server.ts';

function openBrowserUrl(url: string): void {
  if (process.argv.includes('--no-open')) return;
  if (process.platform === 'win32') {
    exec(`start "" "${url}"`);
  }
}

async function bootstrap(): Promise<void> {
  ensureAllDirectories();
  const config = loadConfig();
  const db = new MonitorDatabase();
  const scheduler = new MonitorScheduler(db, config);
  const app = createWebApp(db, scheduler);
  const dashboardUrl = `http://localhost:${config.port}`;

  const server = serve(
    {
      fetch: app.fetch,
      port: config.port,
    },
    (info) => {
      const url = `http://localhost:${info.port}`;
      console.log('==============================================================');
      console.log('  小红书监控系统 v2.0 已成功启动（请保持本窗口开启）');
      console.log(`  项目目录: ${PROJECT_ROOT}`);
      console.log(`  本地存储: ${STORAGE_ROOT}`);
      console.log(`  Web控制台: ${url}`);
      console.log(`  次日0点汇总与时间对照时刻: 每日 ${config.nextDaySummaryTime}`);
      console.log('==============================================================');
      openBrowserUrl(url);
    }
  );

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n[提示] 端口 ${config.port} 已被占用，说明监控系统可能已经在后台运行中！`);
      console.error(`正在为您直接打开控制台网页: ${dashboardUrl}\n`);
      openBrowserUrl(dashboardUrl);
      db.close();
      process.exit(0);
    }
    console.error('[服务异常]', err);
  });

  scheduler.start();

  const shutdown = () => {
    console.log('\n[系统] 正在安全关闭调度器与数据库连接...');
    scheduler.stop();
    server.close();
    db.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

bootstrap().catch((err) => {
  console.error('[致命错误] 启动失败:', err);
  process.exit(1);
});
