import { normalizeBarkInput } from '../shared/utils.ts';

export interface PushPayload {
  title: string;
  body: string;
  level?: 'active' | 'timeSensitive' | 'critical' | 'passive';
  group?: string;
  url?: string;
}

export interface NotificationChannel {
  readonly name: string;
  isConfigured(): boolean;
  send(payload: PushPayload): Promise<{ ok: boolean; error?: string }>;
}

export class BarkNotifier implements NotificationChannel {
  readonly name = 'Bark';
  private serverUrl: string;
  private deviceKey: string;
  private defaultGroup: string;

  constructor(opts: { barkKey: string; barkServerUrl?: string; group?: string }) {
    const parsed = normalizeBarkInput(opts.barkKey, opts.barkServerUrl);
    this.serverUrl = parsed.serverUrl;
    this.deviceKey = parsed.deviceKey;
    this.defaultGroup = opts.group || '小红书监控';
  }

  isConfigured(): boolean {
    return Boolean(this.deviceKey && this.serverUrl);
  }

  async send(payload: PushPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: '未配置 Bark Key' };
    }

    // 若用户填入的是 64 位十六进制苹果 APNs Device Token（常见于手机网络无法直连 api.day.app 注册时），自动代为向 Bark 服务器注册换取 22 位 Key
    if (/^[0-9a-f]{64}$/i.test(this.deviceKey)) {
      try {
        const regRes = await fetch(
          `${this.serverUrl}/register?devicetoken=${encodeURIComponent(this.deviceKey)}`,
          { signal: AbortSignal.timeout(10_000) }
        );
        const regData = (await regRes.json().catch(() => ({}))) as {
          code?: number;
          data?: { device_key?: string; key?: string };
        };
        const exchangedKey = regData?.data?.device_key || regData?.data?.key;
        if (regRes.ok && exchangedKey) {
          this.deviceKey = exchangedKey;
        } else {
          return {
            ok: false,
            error: '尝试使用 64 位 Device Token 自动向 Bark 服务器注册 Key 失败，请检查网络或填写 22 位 Bark Key。',
          };
        }
      } catch (err) {
        return {
          ok: false,
          error: `自动向 Bark 注册 Device Token 超时: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const endpoint = `${this.serverUrl}/push`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          device_key: this.deviceKey,
          title: payload.title,
          body: payload.body,
          group: payload.group || this.defaultGroup,
          level: payload.level || 'timeSensitive',
          url: payload.url || undefined,
        }),
        signal: AbortSignal.timeout(12_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        if (text.includes('failed to get device token')) {
          return {
            ok: false,
            error: `Bark 服务器未找到该 Key 绑定的设备（${text.slice(0, 120)}）。请确认：1) 填入的是 Bark【服务器】页链接里的 22 位 Key（而非设置页 64 位的 Device Token）；2) 手机已开启 Bark 通知权限并在 App 内刷新注册。`,
          };
        }
        return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = (await res.json().catch(() => ({}))) as { code?: number; message?: string };
      if (typeof data.code === 'number' && data.code !== 200) {
        return { ok: false, error: data.message || `Bark code ${data.code}` };
      }
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
