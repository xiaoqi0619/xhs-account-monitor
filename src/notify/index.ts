import type { AppConfig, MonitorEvent } from '../shared/types.ts';
import type { MonitorDatabase } from '../storage/database.ts';
import { BarkNotifier, type NotificationChannel, type PushPayload } from './bark.ts';
import { QqMailNotifier } from './qq-mail.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class NotificationHub {
  private channels: NotificationChannel[] = [];
  private barkChannel: BarkNotifier;
  private qqMailChannel: QqMailNotifier;
  private dashboardPort: number;

  constructor(config: AppConfig) {
    this.dashboardPort = config.port || 3000;
    this.barkChannel = new BarkNotifier({
      barkKey: config.barkKey,
      barkServerUrl: config.barkServerUrl,
      group: config.barkGroup,
    });
    if (this.barkChannel.isConfigured()) {
      this.channels.push(this.barkChannel);
    }

    this.qqMailChannel = new QqMailNotifier({
      user: config.qqMailUser,
      authCode: config.qqMailAuthCode,
    });
    if (this.qqMailChannel.isConfigured()) {
      this.channels.push(this.qqMailChannel);
    }
  }

  hasActiveChannel(): boolean {
    return this.channels.length > 0;
  }

  async sendBarkPayload(payload: PushPayload): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.barkChannel.isConfigured()) {
      return { ok: false, errors: ['尚未配置 Bark Key'] };
    }
    const res = await this.barkChannel.send(payload);
    return {
      ok: res.ok,
      errors: res.error ? [`[${this.barkChannel.name}] ${res.error}`] : [],
    };
  }

  async sendQqMailPayload(payload: PushPayload): Promise<{ ok: boolean; errors: string[] }> {
    if (!this.qqMailChannel.isConfigured()) {
      return { ok: false, errors: ['尚未配置完整的 QQ 邮箱地址与 16 位授权码'] };
    }
    const res = await this.qqMailChannel.send(payload);
    return {
      ok: res.ok,
      errors: res.error ? [`[${this.qqMailChannel.name}] ${res.error}`] : [],
    };
  }

  async sendPayload(payload: PushPayload): Promise<{ ok: boolean; errors: string[] }> {
    if (this.channels.length === 0) {
      return { ok: false, errors: ['尚未开启任何推送渠道（请配置 Bark 或 QQ 邮箱）'] };
    }
    const errors: string[] = [];
    let anyOk = false;

    for (const channel of this.channels) {
      const res = await channel.send(payload);
      if (res.ok) anyOk = true;
      else if (res.error) errors.push(`[${channel.name}] ${res.error}`);
    }
    return { ok: anyOk, errors };
  }

  async notifyEvents(events: MonitorEvent[], db?: MonitorDatabase): Promise<void> {
    const pushable = events.filter((e) => e.shouldPush);
    if (pushable.length === 0) return;

    if (!this.hasActiveChannel()) {
      if (db) {
        for (const ev of pushable) {
          if (ev.id) {
            db.updateEventPushStatus(ev.id, false, '未开启推送渠道，数据已完整保存在本地');
          }
        }
      }
      return;
    }

    for (let i = 0; i < pushable.length; i++) {
      const ev = pushable[i];
      let url = `http://localhost:${this.dashboardPort}/`;
      if (ev.eventType === 'DAILY_REPORT' || ev.eventType === 'TIME_REVIEW_ALERT') {
        url = `http://localhost:${this.dashboardPort}/#daily`;
      } else if (ev.noteId) {
        url = `http://localhost:${this.dashboardPort}/#note-${ev.noteId}`;
      }

      const res = await this.sendPayload({
        title: ev.title,
        body: ev.body,
        level: ev.level,
        url,
      });

      if (db && ev.id) {
        db.updateEventPushStatus(
          ev.id,
          res.ok,
          res.ok ? undefined : res.errors.join('; ')
        );
      }

      if (i < pushable.length - 1) {
        await sleep(300);
      }
    }
  }
}
