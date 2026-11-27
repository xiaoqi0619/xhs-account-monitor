import tls from 'node:tls';
import { normalizeQqMailAddress, normalizeQqMailAuthCode } from '../shared/utils.ts';
import type { NotificationChannel, PushPayload } from './bark.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function escapeHtml(text: string): string {
  return String(text || '').replace(/[&<>"']/g, (ch) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[ch] || ch;
  });
}

function encodeMimeHeader(value: string): string {
  const clean = String(value || '')
    .replace(/[\r\n]+/g, ' ')
    .trim();
  if (!clean) return '';
  return `=?UTF-8?B?${Buffer.from(clean, 'utf8').toString('base64')}?=`;
}

function chunkBase64(b64: string, width = 76): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += width) {
    lines.push(b64.slice(i, i + width));
  }
  return lines.join('\r\n');
}

export function buildQqMailMimeMessage(opts: {
  from: string;
  to: string;
  payload: PushPayload;
  now?: Date;
}): string {
  const now = opts.now || new Date();
  const title = (opts.payload.title || '小红书监控提醒').replace(/[\r\n]+/g, ' ').trim();
  const body = String(opts.payload.body || '').trim();
  const url = opts.payload.url ? String(opts.payload.url).trim() : '';

  const levelBadge =
    opts.payload.level === 'critical'
      ? { text: '紧急提醒', bg: '#fee2e2', fg: '#b91c1c' }
      : opts.payload.level === 'timeSensitive'
      ? { text: '动态提醒', bg: '#fef3c7', fg: '#b45309' }
      : { text: '监控通知', bg: '#eef2ff', fg: '#4338ca' };

  const pad = (n: number) => String(n).padStart(2, '0');
  const localTimeText = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(
    now.getHours()
  )}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const bodyHtml = escapeHtml(body).replace(/\r?\n/g, '<br/>');
  const urlHtml = url
    ? `<p style="margin:16px 0 0;font-size:12px;color:#64748b;">控制台链接：<a href="${escapeHtml(
        url
      )}" style="color:#4f46e5;text-decoration:none;">${escapeHtml(url)}</a></p>`
    : '';

  const html = [
    '<!doctype html>',
    '<html lang="zh-CN"><head><meta charset="utf-8" /></head>',
    '<body style="margin:0;padding:20px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',sans-serif;color:#0f172a;">',
    '<div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:10px;padding:22px 24px;">',
    `<div style="margin-bottom:10px;"><span style="display:inline-block;padding:2px 8px;border-radius:99px;font-size:12px;font-weight:600;background:${levelBadge.bg};color:${levelBadge.fg};">${levelBadge.text}</span><span style="margin-left:8px;font-size:12px;color:#94a3b8;">${escapeHtml(
      localTimeText
    )}</span></div>`,
    `<h2 style="margin:0 0 12px;font-size:16px;line-height:1.45;color:#0f172a;">${escapeHtml(title)}</h2>`,
    `<div style="font-size:14px;line-height:1.7;color:#334155;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;word-break:break-word;">${
      bodyHtml || '（无详细正文）'
    }</div>`,
    urlHtml,
    '</div></body></html>',
  ].join('');

  const encodedHtml = chunkBase64(Buffer.from(html, 'utf8').toString('base64'));
  const msgId = `<${now.getTime()}.${Math.random().toString(36).slice(2, 10)}@qq.com>`;

  const headers = [
    `From: ${encodeMimeHeader('小红书监控系统')} <${opts.from}>`,
    `To: ${opts.to}`,
    `Subject: ${encodeMimeHeader(title)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: ${msgId}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];

  return `${headers.join('\r\n')}\r\n\r\n${encodedHtml}`;
}

interface SmtpResponse {
  code: number;
  text: string;
}

class SimpleSmtpsClient {
  private socket: tls.TLSSocket;
  private buffer = '';
  private lines: string[] = [];
  private pendingResolve: ((res: SmtpResponse) => void) | null = null;
  private pendingReject: ((err: Error) => void) | null = null;
  private closed = false;
  private lastError: Error | null = null;

  constructor(socket: tls.TLSSocket) {
    this.socket = socket;
    this.socket.setEncoding('utf8');

    this.socket.on('data', (chunk: string) => {
      this.buffer += chunk;
      let idx = this.buffer.indexOf('\n');
      while (idx !== -1) {
        const line = this.buffer.slice(0, idx).replace(/\r$/, '');
        this.buffer = this.buffer.slice(idx + 1);
        this.lines.push(line);
        idx = this.buffer.indexOf('\n');
      }
      this.tryFlushResponse();
    });

    this.socket.on('error', (err) => {
      this.lastError = err;
      this.closed = true;
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(err);
      }
    });

    this.socket.on('close', () => {
      this.closed = true;
      if (this.pendingReject) {
        const reject = this.pendingReject;
        this.pendingResolve = null;
        this.pendingReject = null;
        reject(this.lastError || new Error('SMTP 连接已提前关闭'));
      }
    });

    this.socket.on('timeout', () => {
      const err = new Error('连接 QQ 邮箱 SMTP 服务器超时');
      this.lastError = err;
      this.socket.destroy(err);
    });
  }

  private tryFlushResponse(): void {
    if (!this.pendingResolve) return;
    const collected: string[] = [];
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      collected.push(line);
      const match = line.match(/^(\d{3})(?: |$)/);
      if (match) {
        this.lines.splice(0, i + 1);
        const resolve = this.pendingResolve;
        this.pendingResolve = null;
        this.pendingReject = null;
        resolve({
          code: Number(match[1]),
          text: collected.join('\n'),
        });
        return;
      }
    }
  }

  readResponse(): Promise<SmtpResponse> {
    if (this.closed && this.lines.length === 0) {
      return Promise.reject(this.lastError || new Error('SMTP 连接已关闭'));
    }
    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.tryFlushResponse();
    });
  }

  async command(cmd: string, expectedCodes: number[]): Promise<SmtpResponse> {
    this.socket.write(`${cmd}\r\n`, 'utf8');
    const res = await this.readResponse();
    if (!expectedCodes.includes(res.code)) {
      throw new Error(`SMTP ${res.code}: ${res.text.slice(0, 180)}`);
    }
    return res;
  }

  async sendData(mimeBody: string): Promise<SmtpResponse> {
    this.socket.write(`${mimeBody}\r\n.\r\n`, 'utf8');
    const res = await this.readResponse();
    if (res.code !== 250) {
      throw new Error(`SMTP DATA ${res.code}: ${res.text.slice(0, 180)}`);
    }
    return res;
  }

  close(): void {
    try {
      this.socket.end();
    } catch {
      // ignore
    }
  }
}

export class QqMailNotifier implements NotificationChannel {
  readonly name = 'QQ邮箱';
  private user: string;
  private authCode: string;
  private host: string;
  private port: number;
  private rejectUnauthorized: boolean;

  constructor(opts: {
    user: string;
    authCode: string;
    host?: string;
    port?: number;
    rejectUnauthorized?: boolean;
  }) {
    this.user = normalizeQqMailAddress(opts.user);
    this.authCode = normalizeQqMailAuthCode(opts.authCode);
    this.host = (opts.host || 'smtp.qq.com').trim();
    this.port = opts.port || 465;
    this.rejectUnauthorized = opts.rejectUnauthorized !== false;
  }

  isConfigured(): boolean {
    return Boolean(EMAIL_RE.test(this.user) && this.authCode);
  }

  async send(payload: PushPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      return { ok: false, error: '未配置完整的 QQ 邮箱地址与 16 位授权码' };
    }

    let client: SimpleSmtpsClient | null = null;
    try {
      const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const s = tls.connect(
          {
            host: this.host,
            port: this.port,
            servername: this.host,
            rejectUnauthorized: this.rejectUnauthorized,
          },
          () => resolve(s)
        );
        s.setTimeout(15_000);
        s.once('error', reject);
        s.once('timeout', () => {
          const err = new Error('连接 smtp.qq.com:465 超时');
          s.destroy(err);
          reject(err);
        });
      });

      client = new SimpleSmtpsClient(socket);

      const greeting = await client.readResponse();
      if (greeting.code !== 220) {
        throw new Error(`SMTP 握手失败 (${greeting.code}): ${greeting.text.slice(0, 140)}`);
      }

      await client.command('EHLO localhost', [250]);
      await client.command('AUTH LOGIN', [334]);
      await client.command(Buffer.from(this.user, 'utf8').toString('base64'), [334]);
      await client.command(Buffer.from(this.authCode, 'utf8').toString('base64'), [235]);

      await client.command(`MAIL FROM:<${this.user}>`, [250]);
      await client.command(`RCPT TO:<${this.user}>`, [250, 251]);

      await client.command('DATA', [354]);
      const mimeMessage = buildQqMailMimeMessage({
        from: this.user,
        to: this.user,
        payload,
      });
      await client.sendData(mimeMessage);

      try {
        await client.command('QUIT', [221]);
      } catch {
        // 邮件已被服务器 250 接收，忽略 QUIT 关闭时的非致命异常
      }

      return { ok: true };
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (rawMsg.includes('535')) {
        return {
          ok: false,
          error:
            'QQ 邮箱认证失败（535）：请确认填入的是 QQ 邮箱网页版「设置 → 账户」开启 POP3/SMTP 后生成的 16 位授权码（非 QQ 登录密码）',
        };
      }
      return { ok: false, error: rawMsg.slice(0, 220) };
    } finally {
      client?.close();
    }
  }
}
