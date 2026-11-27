export function renderDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>XHS Monitor</title>
  <style>
    :root,
    [data-theme="dark"] {
      --bg-canvas: #08090a;
      --bg-sidebar: #0d0e11;
      --bg-surface: #111216;
      --bg-elevated: #17191f;
      --bg-hover: rgba(255, 255, 255, 0.045);
      --bg-active: rgba(255, 255, 255, 0.075);
      --bg-subtle: rgba(255, 255, 255, 0.03);
      --border: rgba(255, 255, 255, 0.08);
      --border-strong: rgba(255, 255, 255, 0.14);
      --text-primary: #f7f8f8;
      --text-secondary: #9a9fa8;
      --text-muted: #62666f;
      --accent: #5e6ad2;
      --accent-hover: #6f7bf0;
      --accent-soft: rgba(94, 106, 210, 0.16);
      --accent-border: rgba(94, 106, 210, 0.4);
      --ok: #3fb950;
      --ok-soft: rgba(63, 185, 80, 0.14);
      --warn: #e5a93c;
      --warn-soft: rgba(229, 169, 60, 0.14);
      --danger: #e5484d;
      --danger-soft: rgba(229, 72, 77, 0.14);
      --glass: rgba(8, 9, 10, 0.78);
      --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.45);
      --shadow-lg: 0 20px 60px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.08);
      --specular: inset 0 1px 0 rgba(255, 255, 255, 0.045);
      --diff-del-bg: rgba(229, 72, 77, 0.09);
      --diff-add-bg: rgba(63, 185, 80, 0.09);
      color-scheme: dark;
    }

    [data-theme="light"] {
      --bg-canvas: #fafafa;
      --bg-sidebar: #f4f5f7;
      --bg-surface: #ffffff;
      --bg-elevated: #ffffff;
      --bg-hover: rgba(15, 23, 42, 0.04);
      --bg-active: rgba(15, 23, 42, 0.07);
      --bg-subtle: rgba(15, 23, 42, 0.025);
      --border: rgba(15, 23, 42, 0.09);
      --border-strong: rgba(15, 23, 42, 0.16);
      --text-primary: #111318;
      --text-secondary: #5c626e;
      --text-muted: #8b919d;
      --accent: #5e6ad2;
      --accent-hover: #4e5bc4;
      --accent-soft: rgba(94, 106, 210, 0.11);
      --accent-border: rgba(94, 106, 210, 0.32);
      --ok: #1f8a4c;
      --ok-soft: rgba(31, 138, 76, 0.11);
      --warn: #b87309;
      --warn-soft: rgba(184, 115, 9, 0.12);
      --danger: #d13438;
      --danger-soft: rgba(209, 52, 56, 0.11);
      --glass: rgba(250, 250, 250, 0.82);
      --shadow-sm: 0 1px 2px rgba(15, 23, 42, 0.05);
      --shadow-lg: 0 18px 50px rgba(15, 23, 42, 0.16), 0 0 0 1px rgba(15, 23, 42, 0.08);
      --specular: inset 0 1px 0 rgba(255, 255, 255, 0.7);
      --diff-del-bg: rgba(209, 52, 56, 0.07);
      --diff-add-bg: rgba(31, 138, 76, 0.07);
      color-scheme: light;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 13px;
      line-height: 1.45;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .mono {
      font-family: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
      font-variant-numeric: tabular-nums;
    }

    .num { font-variant-numeric: tabular-nums; }
    .hidden { display: none !important; }

    /* Focus Accessibility */
    :focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 99px; }

    /* App Shell */
    .shell {
      display: grid;
      grid-template-columns: 232px minmax(0, 1fr);
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      position: sticky;
      top: 0;
      height: 100vh;
      background: var(--bg-sidebar);
      border-right: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      padding: 12px 10px;
      gap: 10px;
      user-select: none;
    }

    .workspace-btn {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 8px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-primary);
      cursor: pointer;
      text-align: left;
      transition: background 0.14s, border-color 0.14s;
    }
    .workspace-btn:hover {
      background: var(--bg-hover);
      border-color: var(--border);
    }

    .ws-avatar-wrap {
      position: relative;
      width: 30px;
      height: 30px;
      flex-shrink: 0;
    }
    .ws-avatar {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      font-size: 12px;
      color: var(--text-secondary);
      overflow: hidden;
    }
    .ws-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .ws-status-dot {
      position: absolute;
      right: -1px;
      bottom: -1px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 2px solid var(--bg-sidebar);
      background: var(--text-muted);
    }
    .ws-status-dot.ok { background: var(--ok); }
    .ws-status-dot.warn { background: var(--warn); }
    .ws-status-dot.danger { background: var(--danger); }
    .ws-status-dot.running { background: var(--accent); animation: pulseDot 1.3s infinite; }

    @keyframes pulseDot {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.25); opacity: 0.65; }
    }

    .ws-info { min-width: 0; flex: 1; }
    .ws-name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.01em;
    }
    .ws-sub {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      flex: 1;
    }

    .nav-item {
      display: flex;
      align-items: center;
      gap: 9px;
      width: 100%;
      padding: 7px 9px;
      border-radius: 7px;
      border: 1px solid transparent;
      background: transparent;
      color: var(--text-secondary);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      text-align: left;
      transition: background 0.12s, color 0.12s, border-color 0.12s;
    }
    .nav-item:hover {
      background: var(--bg-hover);
      color: var(--text-primary);
    }
    .nav-item.active {
      background: var(--bg-active);
      color: var(--text-primary);
      border-color: var(--border);
      box-shadow: var(--specular);
    }
    .nav-item svg {
      width: 15px;
      height: 15px;
      flex-shrink: 0;
      opacity: 0.78;
    }
    .nav-item.active svg { opacity: 1; color: var(--accent); }
    .nav-label { flex: 1; }
    .nav-count {
      font-size: 11px;
      padding: 1px 6px;
      border-radius: 99px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .nav-kbd {
      font-size: 10px;
      color: var(--text-muted);
      opacity: 0;
      transition: opacity 0.15s;
    }
    .nav-item:hover .nav-kbd { opacity: 0.9; }

    /* Sidebar Footer */
    .sidebar-footer {
      border-top: 1px solid var(--border);
      padding-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .runtime-pill {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 7px 9px;
      border-radius: 7px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      font-size: 11.5px;
      color: var(--text-secondary);
    }
    .runtime-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      background: var(--text-muted);
    }
    .runtime-dot.ok { background: var(--ok); }
    .runtime-dot.warn { background: var(--warn); }
    .runtime-dot.danger { background: var(--danger); }
    .runtime-dot.running { background: var(--accent); animation: pulseDot 1.2s infinite; }
    .runtime-meta {
      min-width: 0;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .footer-actions {
      display: flex;
      gap: 6px;
    }

    /* Main Workspace */
    .workspace-main {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    /* Sticky Topbar */
    .topbar {
      position: sticky;
      top: 0;
      z-index: 20;
      height: 52px;
      padding: 0 24px;
      background: var(--glass);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .topbar-left {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .page-title {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: -0.01em;
      white-space: nowrap;
    }
    .topbar-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    .progress-rail {
      height: 2px;
      width: 100%;
      background: transparent;
      overflow: hidden;
      position: sticky;
      top: 52px;
      z-index: 19;
    }
    .progress-rail.active::after {
      content: "";
      display: block;
      height: 100%;
      width: 35%;
      background: linear-gradient(90deg, transparent, var(--accent), transparent);
      animation: linearSlide 1.3s ease-in-out infinite;
    }
    @keyframes linearSlide {
      0% { transform: translateX(-100%); }
      100% { transform: translateX(380%); }
    }

    /* Buttons */
    button, .btn {
      font-family: inherit;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      height: 28px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      box-shadow: var(--specular);
      transition: background 0.12s, border-color 0.12s, opacity 0.12s, transform 0.08s;
    }
    .btn:hover:not(:disabled) {
      background: var(--bg-elevated);
      border-color: var(--border-strong);
    }
    .btn:active:not(:disabled) { transform: translateY(0.5px); }
    .btn:disabled { opacity: 0.48; cursor: not-allowed; }
    .btn svg { width: 13.5px; height: 13.5px; flex-shrink: 0; }

    .btn-primary {
      background: var(--accent);
      border-color: rgba(255, 255, 255, 0.14);
      color: #ffffff;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.22), 0 1px 2px rgba(0, 0, 0, 0.35);
    }
    .btn-primary:hover:not(:disabled) {
      background: var(--accent-hover);
      border-color: rgba(255, 255, 255, 0.22);
    }

    .btn-ghost {
      background: transparent;
      border-color: transparent;
      color: var(--text-secondary);
      box-shadow: none;
    }
    .btn-ghost:hover:not(:disabled) {
      background: var(--bg-hover);
      color: var(--text-primary);
      border-color: transparent;
    }

    .btn-danger {
      background: var(--danger-soft);
      border-color: rgba(229, 72, 77, 0.35);
      color: var(--danger);
    }
    .btn-danger:hover:not(:disabled) {
      background: var(--danger);
      color: #ffffff;
      border-color: var(--danger);
    }

    .btn-icon {
      width: 28px;
      padding: 0;
    }

    /* Info Tooltip Icon + Global Floating Tooltip Portal */
    .info-tip {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      color: var(--text-muted);
      cursor: help;
      flex-shrink: 0;
      transition: color 0.12s, background 0.12s;
    }
    .info-tip:hover { color: var(--text-primary); background: var(--bg-hover); }
    .info-tip svg { width: 13px; height: 13px; }
    .floating-tip {
      position: fixed;
      left: 0;
      top: 0;
      max-width: 280px;
      padding: 7px 10px;
      border-radius: 7px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      color: var(--text-primary);
      font-size: 11.5px;
      font-weight: 400;
      line-height: 1.5;
      white-space: normal;
      word-break: break-word;
      box-shadow: var(--shadow-lg);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      z-index: 200;
      transition: opacity 0.12s ease;
    }
    .floating-tip.visible {
      opacity: 1;
      visibility: visible;
    }

    /* Alert Strip (only shown on PAUSED_AUTH or ERROR) */
    .alert-strip {
      margin: 14px 24px 0;
      padding: 10px 14px;
      border-radius: 8px;
      background: var(--danger-soft);
      border: 1px solid rgba(229, 72, 77, 0.32);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: 12.5px;
    }
    .alert-strip-text {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--text-primary);
      min-width: 0;
    }
    .alert-strip-text svg { color: var(--danger); width: 15px; height: 15px; flex-shrink: 0; }

    /* Content Canvas */
    .content {
      padding: 20px 24px 40px;
      max-width: 1280px;
      width: 100%;
    }

    /* Surface Panel */
    .panel {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      box-shadow: var(--specular);
      overflow: hidden;
    }

    /* Toolbar Row inside View */
    .view-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    /* Segmented Control */
    .segmented {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      padding: 3px;
      border-radius: 8px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      flex-wrap: wrap;
    }
    .seg-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 24px;
      padding: 0 9px;
      border: none;
      border-radius: 5px;
      background: transparent;
      color: var(--text-secondary);
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
    }
    .seg-btn:hover { color: var(--text-primary); background: var(--bg-hover); }
    .seg-btn.active {
      background: var(--bg-active);
      color: var(--text-primary);
      box-shadow: var(--specular);
    }
    .seg-count {
      font-size: 10.5px;
      color: var(--text-muted);
    }

    /* Badges & Status Pills */
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      height: 20px;
      padding: 0 7px;
      border-radius: 99px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      color: var(--text-secondary);
      white-space: nowrap;
    }
    .pill-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }
    .pill.ok { color: var(--ok); background: var(--ok-soft); border-color: rgba(63, 185, 80, 0.28); }
    .pill.warn { color: var(--warn); background: var(--warn-soft); border-color: rgba(229, 169, 60, 0.3); }
    .pill.danger { color: var(--danger); background: var(--danger-soft); border-color: rgba(229, 72, 77, 0.3); }
    .pill.accent { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-border); }

    /* KPI Strip (Overview) */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      margin-bottom: 18px;
      box-shadow: var(--specular);
    }
    .kpi-cell {
      padding: 16px 18px;
      border-right: 1px solid var(--border);
      background: transparent;
      border-top: none;
      border-bottom: none;
      border-left: none;
      text-align: left;
      color: inherit;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: background 0.14s;
    }
    .kpi-cell:last-child { border-right: none; }
    .kpi-cell:hover { background: var(--bg-hover); }
    .kpi-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: var(--text-secondary);
    }
    .kpi-val {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.025em;
      line-height: 1.15;
    }
    .kpi-sub {
      font-size: 11.5px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Profile Strip inside Overview */
    .profile-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 14px 18px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 14px;
      flex-wrap: wrap;
      box-shadow: var(--specular);
    }
    .profile-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }
    .profile-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid var(--border-strong);
      cursor: zoom-in;
      background: var(--bg-elevated);
      flex-shrink: 0;
    }
    .profile-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .profile-name { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; }
    .profile-metrics {
      display: flex;
      align-items: center;
      gap: 18px;
      flex-wrap: wrap;
    }
    .metric-chip {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }
    .metric-chip-val { font-size: 14px; font-weight: 600; }
    .metric-chip-lbl { font-size: 11px; color: var(--text-muted); }

    /* Standalone Next Monitor Countdown Card */
    .countdown-card {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      padding: 13px 18px;
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      margin-bottom: 14px;
      box-shadow: var(--specular);
      flex-wrap: wrap;
    }
    .countdown-card.running {
      border-color: var(--accent-border);
      background: linear-gradient(90deg, var(--accent-soft), var(--bg-surface) 45%);
    }
    .countdown-left {
      display: flex;
      align-items: center;
      gap: 11px;
      min-width: 0;
      flex: 1;
    }
    .countdown-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .countdown-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .countdown-clock {
      font-size: 12px;
      padding: 1px 7px;
      border-radius: 5px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      color: var(--text-secondary);
    }
    .countdown-sub {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .countdown-right {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      flex-shrink: 0;
    }
    .countdown-timer {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: -0.02em;
      line-height: 1;
      color: var(--text-primary);
    }
    .countdown-timer.accent { color: var(--accent); }
    .countdown-timer.muted { color: var(--text-muted); font-size: 16px; }
    .countdown-bar-track {
      width: 148px;
      height: 3px;
      border-radius: 99px;
      background: var(--border);
      overflow: hidden;
      position: relative;
    }
    .countdown-bar-fill {
      height: 100%;
      border-radius: 99px;
      background: var(--accent);
      transition: width 0.5s linear;
    }
    .countdown-bar-fill.indeterminate {
      width: 40% !important;
      animation: linearSlide 1.3s ease-in-out infinite;
    }

    /* Linear Dense List (Events Feed) */
    .list-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-subtle);
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
    }

    .event-row {
      display: grid;
      grid-template-columns: 18px 94px minmax(0, 1fr) 138px;
      align-items: center;
      gap: 12px;
      padding: 10px 16px;
      border-bottom: 1px solid var(--border);
      transition: background 0.12s;
    }
    .event-row:last-child { border-bottom: none; }
    .event-row:hover { background: var(--bg-hover); }
    .event-row.clickable { cursor: pointer; }
    .event-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      justify-self: center;
    }
    .event-dot.danger { background: var(--danger); }
    .event-dot.warn { background: var(--warn); }
    .event-dot.accent { background: var(--accent); }
    .event-dot.ok { background: var(--ok); }
    .event-main { min-width: 0; }
    .event-title {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .event-body {
      font-size: 12px;
      color: var(--text-secondary);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      margin-top: 2px;
    }
    .event-time {
      font-size: 11.5px;
      color: var(--text-muted);
      text-align: right;
      white-space: nowrap;
    }

    /* Comparison Cards */
    .comp-list {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .comp-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 14px 16px;
      box-shadow: var(--specular);
      transition: border-color 0.14s;
    }
    .comp-card:hover { border-color: var(--border-strong); }
    .comp-card.danger { border-left: 3px solid var(--danger); }
    .comp-card.warn { border-left: 3px solid var(--warn); }
    .comp-card.accent { border-left: 3px solid var(--accent); }
    .comp-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      flex-wrap: wrap;
    }
    .comp-title-group {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .comp-title {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--text-primary);
    }
    .comp-meta {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid var(--border);
      font-size: 12px;
      color: var(--text-secondary);
    }
    .comp-meta strong { color: var(--text-primary); font-weight: 500; }
    .comp-highlight { color: var(--warn); font-weight: 500; }
    .comp-card.danger .comp-highlight { color: var(--danger); }

    .diff-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
      margin-top: 10px;
    }
    .diff-box {
      padding: 10px 12px;
      border-radius: 7px;
      border: 1px solid var(--border);
      background: var(--bg-subtle);
      font-size: 12.5px;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 10px 0 0;
      font-family: inherit;
    }
    .diff-grid .diff-box { margin-top: 0; }
    .diff-box.before { background: var(--diff-del-bg); border-color: rgba(229, 72, 77, 0.22); }
    .diff-box.after { background: var(--diff-add-bg); border-color: rgba(63, 185, 80, 0.22); }

    .ip-transition {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      margin-top: 10px;
      padding: 8px 12px;
      border-radius: 7px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      font-size: 13px;
    }
    .ip-arrow { color: var(--text-muted); }

    .thumb-row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
    }
    .thumb-img {
      width: 64px;
      height: 64px;
      border-radius: 6px;
      object-fit: cover;
      border: 1px solid var(--border);
      cursor: zoom-in;
      transition: transform 0.14s, border-color 0.14s;
    }
    .thumb-img:hover { transform: scale(1.04); border-color: var(--border-strong); }

    /* Linear Data Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
    }
    .data-table th {
      text-align: left;
      padding: 9px 14px;
      font-size: 11px;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.03em;
      background: var(--bg-subtle);
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    .data-table td {
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    .data-table tr:last-child td { border-bottom: none; }
    .data-table tbody tr:hover { background: var(--bg-hover); }

    /* Daily Report Summary Strip */
    .report-kpi-row {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .mini-stat {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 14px;
      box-shadow: var(--specular);
    }
    .mini-stat-lbl { font-size: 11px; color: var(--text-muted); }
    .mini-stat-val { font-size: 18px; font-weight: 600; margin-top: 3px; }

    /* Archive Notes Grid */
    .search-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .search-wrap svg {
      position: absolute;
      left: 9px;
      width: 13.5px;
      height: 13.5px;
      color: var(--text-muted);
      pointer-events: none;
    }
    .search-input {
      height: 28px;
      width: 220px;
      padding: 0 28px 0 28px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-surface);
      color: var(--text-primary);
      font-size: 12.5px;
      transition: border-color 0.14s, width 0.18s;
    }
    .search-input:focus {
      border-color: var(--accent);
      outline: none;
      width: 260px;
    }
    .search-kbd {
      position: absolute;
      right: 7px;
      font-size: 10px;
      color: var(--text-muted);
      padding: 0 4px;
      border: 1px solid var(--border);
      border-radius: 4px;
      pointer-events: none;
    }

    .notes-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(256px, 100%), 1fr));
      gap: 14px;
    }
    .note-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      box-shadow: var(--specular);
      transition: border-color 0.15s, transform 0.15s;
    }
    .note-card:hover {
      border-color: var(--border-strong);
      transform: translateY(-1px);
    }
    .note-card.deleted { border-color: rgba(229, 72, 77, 0.45); }
    .note-cover-wrap {
      position: relative;
      height: 176px;
      background: var(--bg-elevated);
      overflow: hidden;
    }
    .note-cover {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      transition: transform 0.25s ease;
    }
    .note-card:hover .note-cover { transform: scale(1.025); }
    .note-cover-empty {
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
      font-size: 12px;
    }
    .note-cover-badges {
      position: absolute;
      top: 8px;
      left: 8px;
      right: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 6px;
    }
    .photo-count-chip {
      font-size: 11px;
      padding: 2px 7px;
      border-radius: 99px;
      background: rgba(8, 9, 10, 0.72);
      backdrop-filter: blur(6px);
      color: #f7f8f8;
      border: 1px solid rgba(255, 255, 255, 0.12);
    }
    .note-body {
      padding: 12px 13px;
      display: flex;
      flex-direction: column;
      gap: 7px;
      flex: 1;
    }
    .note-title {
      font-size: 13px;
      font-weight: 600;
      line-height: 1.4;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .note-meta {
      font-size: 11.5px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 6px;
      margin-top: auto;
      padding-top: 6px;
      border-top: 1px solid var(--border);
    }

    /* Avatar Archive Grid */
    .avatar-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
      gap: 12px;
    }
    .avatar-card {
      background: var(--bg-surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 12px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      box-shadow: var(--specular);
    }
    .avatar-card img {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      object-fit: cover;
      border: 1px solid var(--border-strong);
      cursor: zoom-in;
    }

    /* Linear Settings List */
    .settings-wrap {
      max-width: 780px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .settings-section-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-secondary);
      margin: 0 0 8px 2px;
    }
    .settings-row {
      display: grid;
      grid-template-columns: 220px minmax(0, 1fr);
      align-items: center;
      gap: 16px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--border);
    }
    .settings-row:last-child { border-bottom: none; }
    .settings-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: var(--text-primary);
    }

    .input, .select {
      width: 100%;
      height: 32px;
      padding: 0 10px;
      border-radius: 6px;
      border: 1px solid var(--border);
      background: var(--bg-canvas);
      color: var(--text-primary);
      font-family: inherit;
      font-size: 12.5px;
      transition: border-color 0.14s, background 0.14s;
    }
    .input:hover, .select:hover { border-color: var(--border-strong); }
    .input:focus, .select:focus { border-color: var(--accent); outline: none; }
    .input-sm { height: 28px; width: auto; }
    .range-pair {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
    }
    .range-sep { color: var(--text-muted); font-size: 12px; }

    /* Empty State (Onboarding / No Data) */
    .empty-state {
      padding: 48px 24px;
      text-align: center;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 10px;
      color: var(--text-secondary);
    }
    .empty-icon {
      width: 38px;
      height: 38px;
      border-radius: 10px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--text-muted);
    }
    .empty-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
    .empty-actions { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; justify-content: center; }

    /* Slide-over Note Detail Drawer */
    .drawer-mask {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.56);
      backdrop-filter: blur(3px);
      z-index: 80;
      display: flex;
      justify-content: flex-end;
    }
    .drawer-panel {
      width: min(680px, 100vw);
      height: 100vh;
      background: var(--bg-surface);
      border-left: 1px solid var(--border-strong);
      display: flex;
      flex-direction: column;
      box-shadow: var(--shadow-lg);
      animation: slideInRight 0.18s ease-out;
    }
    @keyframes slideInRight {
      from { transform: translateX(24px); opacity: 0.6; }
      to { transform: translateX(0); opacity: 1; }
    }
    .drawer-header {
      padding: 14px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .drawer-body {
      padding: 18px 20px 32px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .drawer-meta-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 8px;
    }
    .drawer-meta-item {
      padding: 9px 11px;
      border-radius: 7px;
      background: var(--bg-subtle);
      border: 1px solid var(--border);
    }
    .drawer-meta-lbl { font-size: 11px; color: var(--text-muted); }
    .drawer-meta-val { font-size: 12.5px; font-weight: 500; margin-top: 2px; word-break: break-all; }

    .comment-item {
      padding: 10px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      flex-direction: column;
      gap: 5px;
    }
    .comment-item:last-child { border-bottom: none; }
    .comment-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      flex-wrap: wrap;
    }

    /* Confirm Modal */
    .dialog-mask {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.62);
      backdrop-filter: blur(4px);
      z-index: 95;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .dialog-box {
      width: min(440px, 100%);
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      border-radius: 12px;
      padding: 18px 20px;
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .dialog-title { font-size: 14.5px; font-weight: 600; }
    .dialog-desc { font-size: 12.5px; color: var(--text-secondary); line-height: 1.55; }
    .dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }

    /* Lightbox */
    .lightbox-mask {
      position: fixed;
      inset: 0;
      background: rgba(5, 6, 8, 0.9);
      backdrop-filter: blur(8px);
      z-index: 100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 28px;
    }
    .lightbox-img {
      max-width: 90vw;
      max-height: 86vh;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      box-shadow: 0 24px 80px rgba(0, 0, 0, 0.75);
      object-fit: contain;
    }
    .lightbox-bar {
      position: fixed;
      top: 16px;
      right: 20px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .lightbox-nav {
      position: fixed;
      top: 50%;
      transform: translateY(-50%);
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.18);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .lightbox-nav:hover { background: rgba(255, 255, 255, 0.2); }
    .lightbox-prev { left: 20px; }
    .lightbox-next { right: 20px; }

    /* Toast Stack */
    .toast-stack {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 110;
      display: flex;
      flex-direction: column;
      gap: 8px;
      pointer-events: none;
    }
    .toast {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 9px;
      max-width: 380px;
      padding: 10px 13px;
      border-radius: 8px;
      background: var(--bg-elevated);
      border: 1px solid var(--border-strong);
      color: var(--text-primary);
      font-size: 12.5px;
      box-shadow: var(--shadow-lg);
      animation: toastIn 0.18s ease-out;
    }
    @keyframes toastIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .toast-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--accent); }
    .toast.ok .toast-dot { background: var(--ok); }
    .toast.danger .toast-dot { background: var(--danger); }
    .toast.warn .toast-dot { background: var(--warn); }

    @media (max-width: 960px) {
      .shell {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto minmax(0, 1fr);
      }
      .sidebar {
        position: static;
        height: auto;
        border-right: none;
        border-bottom: 1px solid var(--border);
      }
      .nav-group {
        flex: 0 0 auto;
        flex-direction: row;
        align-items: center;
        overflow-x: auto;
      }
      .nav-item {
        width: auto;
        flex-shrink: 0;
        white-space: nowrap;
      }
      .nav-kbd { display: none; }
      .topbar {
        height: auto;
        min-height: 48px;
        padding: 8px 14px;
        flex-wrap: wrap;
      }
      .topbar-actions { flex-wrap: wrap; }
      .content { padding: 14px 14px 32px; }
      .search-wrap { flex: 1; min-width: 150px; max-width: 100%; }
      .search-input,
      .search-input:focus { width: 100%; }
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .kpi-cell { border-bottom: 1px solid var(--border); }
      .event-row { grid-template-columns: 14px 86px minmax(0, 1fr); }
      .event-time { display: none; }
      .settings-row { grid-template-columns: 1fr; gap: 6px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <!-- Left Sidebar -->
    <aside class="sidebar" aria-label="主导航">
      <button type="button" class="workspace-btn" onclick="switchTab('overview')" aria-label="返回概览">
        <div class="ws-avatar-wrap">
          <div class="ws-avatar" id="wsAvatar">X</div>
          <span class="ws-status-dot" id="wsStatusDot"></span>
        </div>
        <div class="ws-info">
          <div class="ws-name" id="wsName">XHS Monitor</div>
          <div class="ws-sub mono" id="wsSub">未配置目标</div>
        </div>
      </button>

      <nav class="nav-group">
        <button type="button" class="nav-item active" data-tab="overview" onclick="switchTab('overview')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>
          <span class="nav-label">概览</span>
          <span class="nav-kbd mono">1</span>
        </button>

        <button type="button" class="nav-item" data-tab="comparisons" onclick="switchTab('comparisons')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M8 21H3v-5"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/></svg>
          <span class="nav-label">变动记录</span>
          <span class="nav-count mono hidden" id="navCompBadge">0</span>
          <span class="nav-kbd mono">2</span>
        </button>

        <button type="button" class="nav-item" data-tab="midnight" onclick="switchTab('midnight')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <span class="nav-label">每日汇总</span>
          <span class="nav-kbd mono">3</span>
        </button>

        <button type="button" class="nav-item" data-tab="archive" onclick="switchTab('archive')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg>
          <span class="nav-label">本地备份</span>
          <span class="nav-count mono hidden" id="navArchiveBadge">0</span>
          <span class="nav-kbd mono">4</span>
        </button>

        <button type="button" class="nav-item" data-tab="settings" onclick="switchTab('settings')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.26.6.85 1 1.51 1H21a2 2 0 1 1 0 4h-.09c-.66 0-1.25.4-1.51 1z"/></svg>
          <span class="nav-label">设置</span>
          <span class="nav-kbd mono">5</span>
        </button>
      </nav>

      <div class="sidebar-footer">
        <div class="runtime-pill" id="runtimePill" title="">
          <span class="runtime-dot" id="runtimeDot"></span>
          <span class="runtime-meta" id="runtimeText">连接中</span>
          <span class="mono" style="font-size:11px;color:var(--text-muted);" id="nextRunShort">-</span>
        </div>
        <div class="footer-actions">
          <button type="button" class="btn" style="flex:1;" onclick="openLogin()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v3h-3M14 20h6"/></svg>
            扫码登录
          </button>
          <button type="button" class="btn btn-icon" id="themeToggleBtn" onclick="toggleTheme()" aria-label="切换明暗主题" title="切换明暗主题">
            <svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>
          </button>
        </div>
      </div>
    </aside>

    <!-- Main Content Shell -->
    <div class="workspace-main">
      <header class="topbar">
        <div class="topbar-left">
          <span class="page-title" id="topbarTitle">概览</span>
          <span class="pill hidden" id="topbarModePill"></span>
          <span class="info-tip hidden" id="topbarInfoTip" tabindex="0" aria-label="说明" data-tip="">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </span>
        </div>
        <div class="topbar-actions">
          <button type="button" class="btn btn-ghost" id="pauseResumeBtn" onclick="togglePause()">暂停</button>
          <button type="button" class="btn" id="todaySummaryBtn" onclick="runTodaySummary()">当天汇总</button>
          <button type="button" class="btn" id="fullScanBtn" onclick="runFullScan()">检查全部笔记</button>
          <button type="button" class="btn btn-primary" id="runNowBtn" onclick="runNow()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 4 20 12 6 20 6 4"/></svg>
            立即检查
          </button>
        </div>
      </header>

      <div class="progress-rail" id="progressRail"></div>

      <!-- High-priority Alert Strip (only shown on PAUSED_AUTH) -->
      <div class="alert-strip hidden" id="authAlertStrip" role="alert">
        <div class="alert-strip-text">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          <span id="authAlertText">需要登录或安全验证</span>
        </div>
        <button type="button" class="btn btn-danger" onclick="openLogin()">重新扫码登录</button>
      </div>

      <main class="content">
        <!-- TAB 1: OVERVIEW -->
        <section id="tab-overview">
          <!-- Onboarding Empty State (only visible when targetProfileUrl is not configured) -->
          <div id="onboardingPanel" class="panel hidden" style="margin-bottom:16px;">
            <div class="empty-state">
              <div class="empty-icon">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/></svg>
              </div>
              <div class="empty-title">配置目标账号开始监控</div>
              <div class="empty-actions">
                <button type="button" class="btn" onclick="openLogin()">1. 扫码登录小红书</button>
                <button type="button" class="btn btn-primary" onclick="switchTab('settings')">2. 填写主页链接</button>
              </div>
            </div>
          </div>

          <!-- Compact Profile Pulse Bar -->
          <div id="profileBar" class="profile-bar hidden">
            <div class="profile-left">
              <img id="ovAvatarImg" class="profile-avatar" src="" alt="账号头像" onclick="openSingleLightbox(this.src)" />
              <div style="min-width:0;">
                <div class="profile-title-row">
                  <span class="profile-name" id="ovNickname">-</span>
                  <span class="pill hidden" id="ovGenderPill"></span>
                  <span class="mono" style="font-size:11.5px;color:var(--text-muted);" id="ovRedId"></span>
                  <button type="button" class="pill ok" id="ovIpPill" style="cursor:pointer;" onclick="openArchiveSub('ip')"></button>
                  <button type="button" class="pill" id="ovAvatarPill" style="cursor:pointer;" onclick="openArchiveSub('avatars')"></button>
                  <button type="button" class="pill warn hidden" id="ovProfileChangePill" style="cursor:pointer;" onclick="openArchiveSub('profile')"></button>
                </div>
                <div style="font-size:12px;color:var(--text-secondary);margin-top:2px;" id="ovBioLine" class="hidden"></div>
                <div style="font-size:12px;color:var(--text-muted);margin-top:2px;" id="ovProgressLine"></div>
              </div>
            </div>
            <div class="profile-metrics">
              <div class="metric-chip">
                <span class="metric-chip-val num" id="ovFollows">0</span>
                <span class="metric-chip-lbl">关注</span>
              </div>
              <div class="metric-chip">
                <span class="metric-chip-val num" id="ovFans">0</span>
                <span class="metric-chip-lbl">粉丝</span>
              </div>
              <div class="metric-chip">
                <span class="metric-chip-val num" id="ovInteraction">0</span>
                <span class="metric-chip-lbl">获赞收藏</span>
              </div>
            </div>
          </div>

          <!-- Standalone Next Monitor Countdown Card -->
          <div id="nextRunCard" class="countdown-card">
            <div class="countdown-left">
              <span class="runtime-dot" id="cdDot"></span>
              <div style="min-width:0;">
                <div class="countdown-title-row">
                  <span class="countdown-label" id="cdLabel">下次监控</span>
                  <span class="mono countdown-clock" id="cdExactTime">--:--:--</span>
                  <span class="pill mono hidden" id="cdNextFullPill"></span>
                </div>
                <div class="countdown-sub" id="cdStatusLine">准备中...</div>
              </div>
            </div>
            <div class="countdown-right">
              <div class="countdown-timer mono" id="cdTimer">--:--</div>
              <div class="countdown-bar-track" aria-hidden="true">
                <div class="countdown-bar-fill" id="cdBarFill" style="width:0%;"></div>
              </div>
            </div>
          </div>

          <!-- 4-Column Linear KPI Strip -->
          <div class="kpi-grid">
            <button type="button" class="kpi-cell" onclick="openArchiveSub('notes')">
              <div class="kpi-head">
                <span>笔记备份</span>
                <span class="pill hidden" id="kpiDeletedNotesPill"></span>
              </div>
              <div class="kpi-val num" id="statNotes">0</div>
              <div class="kpi-sub" id="statNotesSub">初始 0</div>
            </button>

            <button type="button" class="kpi-cell" onclick="openArchiveSub('notes')">
              <div class="kpi-head">
                <span>评论备份</span>
                <span class="pill hidden" id="kpiDeletedCommsPill"></span>
              </div>
              <div class="kpi-val num" id="statComments">0</div>
              <div class="kpi-sub" id="statCommentsSub">正常 0</div>
            </button>

            <button type="button" class="kpi-cell" onclick="switchTab('comparisons')">
              <div class="kpi-head">
                <span>变动记录</span>
                <span class="pill hidden" id="kpiRecPill"></span>
              </div>
              <div class="kpi-val num" id="statComparisons">0</div>
              <div class="kpi-sub" id="statRecSub">已核对 0</div>
            </button>

            <button type="button" class="kpi-cell" onclick="openArchiveSub('ip')">
              <div class="kpi-head">
                <span>当前 IP 属地</span>
                <span class="pill hidden" id="kpiIpChangePill"></span>
              </div>
              <div class="kpi-val" id="statCurrentIp" style="font-size:20px;">-</div>
              <div class="kpi-sub" id="statIpSub">本地记录 0 条</div>
            </button>
          </div>

          <!-- Live Activity Stream -->
          <div class="panel">
            <div class="list-header">
              <span>最新动态</span>
              <span class="mono" style="font-weight:400;color:var(--text-muted);" id="eventsCountLabel">0</span>
            </div>
            <div id="eventsList"></div>
          </div>
        </section>

        <!-- TAB 2: COMPARISONS -->
        <section id="tab-comparisons" class="hidden">
          <div class="view-toolbar">
            <div class="segmented" id="compFilterSeg" role="tablist" aria-label="对比类型筛选">
              <button type="button" class="seg-btn active" value="ALL" onclick="setCompFilter('ALL', this)">全部</button>
              <button type="button" class="seg-btn" value="NOTE_DELETED" onclick="setCompFilter('NOTE_DELETED', this)">删帖</button>
              <button type="button" class="seg-btn" value="COMMENT_APPEARED" onclick="setCompFilter('COMMENT_APPEARED', this)">新评</button>
              <button type="button" class="seg-btn" value="COMMENT_DELETED" onclick="setCompFilter('COMMENT_DELETED', this)">删评</button>
              <button type="button" class="seg-btn" value="NOTE_EDITED" onclick="setCompFilter('NOTE_EDITED', this)">改文</button>
              <button type="button" class="seg-btn" value="AVATAR_CHANGED" onclick="setCompFilter('AVATAR_CHANGED', this)">头像</button>
              <button type="button" class="seg-btn" value="IP_CHANGED" onclick="setCompFilter('IP_CHANGED', this)">IP 变更</button>
              <button type="button" class="seg-btn" value="NICKNAME_CHANGED" onclick="setCompFilter('NICKNAME_CHANGED', this)">改名</button>
              <button type="button" class="seg-btn" value="GENDER_CHANGED" onclick="setCompFilter('GENDER_CHANGED', this)">性别</button>
              <button type="button" class="seg-btn" value="BIO_CHANGED" onclick="setCompFilter('BIO_CHANGED', this)">签名</button>
            </div>
            <button type="button" class="btn btn-ghost" onclick="loadComparisons()">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>
              刷新
            </button>
          </div>
          <div id="comparisonsList" class="comp-list"></div>
        </section>

        <!-- TAB 3: DAILY SUMMARY -->
        <section id="tab-midnight" class="hidden">
          <div class="view-toolbar">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <input type="date" id="reportDateInput" class="input input-sm mono" aria-label="选择汇总日期" onchange="loadDailyReport()" />
              <span class="pill mono" id="midnightMetaPill"></span>
            </div>
            <div style="display:flex;gap:6px;">
              <button type="button" class="btn" id="recalcLocalBtn" onclick="generateReport(false)">刷新汇总</button>
              <button type="button" class="btn btn-primary" id="recalcOnlineBtn" onclick="generateReport(true)">重新核对时间</button>
            </div>
          </div>

          <div id="reportSummaryStats" class="report-kpi-row hidden"></div>

          <div class="panel">
            <div class="list-header">
              <span>发布时间核对</span>
              <span class="mono" style="font-weight:400;color:var(--text-muted);" id="reconcileCountLabel">0</span>
            </div>
            <div style="overflow-x:auto;">
              <table class="data-table">
                <thead>
                  <tr>
                    <th style="width:62px;">类型</th>
                    <th>内容</th>
                    <th style="width:146px;">记录时间</th>
                    <th style="width:140px;">页面显示</th>
                    <th style="width:176px;">次日核对时间</th>
                    <th style="width:78px;">延迟</th>
                    <th style="width:170px;">状态</th>
                    <th style="width:86px;">操作</th>
                  </tr>
                </thead>
                <tbody id="reconcileTbody"></tbody>
              </table>
            </div>
          </div>
        </section>

        <!-- TAB 4: LOCAL ARCHIVE -->
        <section id="tab-archive" class="hidden">
          <div class="view-toolbar">
            <div class="segmented" role="tablist" aria-label="备份分类">
              <button type="button" class="seg-btn active" data-sub="notes" onclick="openArchiveSub('notes')">
                全部作品 <span class="seg-count mono" id="subCountNotes">0</span>
              </button>
              <button type="button" class="seg-btn" data-sub="ip" onclick="openArchiveSub('ip')">
                IP 记录 <span class="seg-count mono" id="subCountIp">0</span>
              </button>
              <button type="button" class="seg-btn" data-sub="avatars" onclick="openArchiveSub('avatars')">
                头像记录 <span class="seg-count mono" id="subCountAvatars">0</span>
              </button>
              <button type="button" class="seg-btn" data-sub="profile" onclick="openArchiveSub('profile')">
                资料记录 <span class="seg-count mono" id="subCountProfile">0</span>
              </button>
            </div>

            <div id="archiveNotesControls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <div class="segmented" aria-label="笔记筛选">
                <button type="button" class="seg-btn active" data-nfilter="ALL" onclick="setNoteFilter('ALL', this)">全部</button>
                <button type="button" class="seg-btn" data-nfilter="DELETED" onclick="setNoteFilter('DELETED', this)">已删</button>
                <button type="button" class="seg-btn" data-nfilter="EDITED" onclick="setNoteFilter('EDITED', this)">已编辑</button>
                <button type="button" class="seg-btn" data-nfilter="BASELINE" onclick="setNoteFilter('BASELINE', this)">已有作品</button>
                <button type="button" class="seg-btn" data-nfilter="NEW" onclick="setNoteFilter('NEW', this)">新发</button>
              </div>
              <div class="search-wrap">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
                <input id="archiveSearchInput" class="search-input" type="search" placeholder="搜索作品..." aria-label="搜索备份作品" oninput="renderArchiveNotesGrid()" />
                <span class="search-kbd mono">/</span>
              </div>
            </div>
          </div>

          <!-- Sub-view A: Notes Grid -->
          <div id="archive-sub-notes">
            <div id="archiveNotesGrid" class="notes-grid"></div>
          </div>

          <!-- Sub-view B: IP History Table -->
          <div id="archive-sub-ip" class="hidden">
            <div class="panel">
              <div class="list-header">
                <span>IP 属地记录</span>
                <span class="pill" id="ipHistorySummaryBadge">当前：-</span>
              </div>
              <div style="overflow-x:auto;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:104px;">状态</th>
                      <th style="width:92px;">来源</th>
                      <th style="width:200px;">属地</th>
                      <th style="width:160px;">记录时间</th>
                      <th>大概时间</th>
                    </tr>
                  </thead>
                  <tbody id="ipHistoryTbody"></tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- Sub-view C: Avatar Archive -->
          <div id="archive-sub-avatars" class="hidden">
            <div id="avatarHistoryGrid" class="avatar-grid"></div>
          </div>

          <!-- Sub-view D: Profile Field History (Name / Gender / Bio) -->
          <div id="archive-sub-profile" class="hidden">
            <div class="report-kpi-row" id="profileCurrentStrip">
              <div class="mini-stat">
                <div class="mini-stat-lbl">当前名字</div>
                <div class="mini-stat-val" style="font-size:15px;" id="pfCurNickname">-</div>
              </div>
              <div class="mini-stat">
                <div class="mini-stat-lbl">当前性别</div>
                <div class="mini-stat-val" style="font-size:15px;" id="pfCurGender">未设置</div>
              </div>
              <div class="mini-stat" style="grid-column:span 2;">
                <div class="mini-stat-lbl">当前个性签名</div>
                <div class="mini-stat-val" style="font-size:13.5px;font-weight:500;" id="pfCurBio">（空白）</div>
              </div>
            </div>
            <div class="panel">
              <div class="list-header">
                <span>资料变更记录</span>
                <span class="pill" id="profileHistorySummaryBadge">0</span>
              </div>
              <div style="overflow-x:auto;">
                <table class="data-table">
                  <thead>
                    <tr>
                      <th style="width:92px;">项目</th>
                      <th style="width:96px;">状态</th>
                      <th>内容</th>
                      <th style="width:160px;">记录时间</th>
                      <th style="width:240px;">大概时间</th>
                    </tr>
                  </thead>
                  <tbody id="profileHistoryTbody"></tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        <!-- TAB 5: SETTINGS -->
        <section id="tab-settings" class="hidden">
          <div class="settings-wrap">
            <div>
              <h2 class="settings-section-title">监控目标</h2>
              <div class="panel">
                <div class="settings-row">
                  <label class="settings-label" for="cfg_targetProfileUrl">
                    <span>主页链接</span>
                    <span class="info-tip" tabindex="0" data-tip="填入小红书个人主页完整链接，首次保存会自动备份全部笔记">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <input id="cfg_targetProfileUrl" class="input mono" placeholder="https://www.xiaohongshu.com/user/profile/..." />
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_targetRemark">备注名</label>
                  <input id="cfg_targetRemark" class="input" placeholder="留空使用账号昵称" />
                </div>
              </div>
            </div>

            <div>
              <h2 class="settings-section-title">监控与汇总</h2>
              <div class="panel">
                <div class="settings-row">
                  <label class="settings-label" for="cfg_lightCheckMinMinutes">
                    <span>主页检查间隔（分钟）</span>
                    <span class="info-tip" tabindex="0" data-tip="平时仅刷目标主页 1 页，发现变动帖时当轮只进变动帖查详情">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <div class="range-pair">
                    <input id="cfg_lightCheckMinMinutes" type="number" min="1" class="input mono" aria-label="主页检查最小间隔" />
                    <span class="range-sep">~</span>
                    <input id="cfg_lightCheckMaxMinutes" type="number" min="1" class="input mono" aria-label="主页检查最大间隔" />
                  </div>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_fullScanMinMinutes">
                    <span>全部笔记间隔（分钟）</span>
                    <span class="info-tip" tabindex="0" data-tip="定期完整检查全部笔记的详情、评论与编辑时间">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <div class="range-pair">
                    <input id="cfg_fullScanMinMinutes" type="number" min="5" class="input mono" aria-label="全部笔记最小间隔" />
                    <span class="range-sep">~</span>
                    <input id="cfg_fullScanMaxMinutes" type="number" min="5" class="input mono" aria-label="全部笔记最大间隔" />
                  </div>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_burstMinMinutes">
                    <span>高频监控间隔（分钟）</span>
                    <span class="info-tip" tabindex="0" data-tip="发现监控范围内变动后切换为此随机间隔">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <div class="range-pair">
                    <input id="cfg_burstMinMinutes" type="number" min="1" class="input mono" aria-label="高频监控最小间隔" />
                    <span class="range-sep">~</span>
                    <input id="cfg_burstMaxMinutes" type="number" min="1" class="input mono" aria-label="高频监控最大间隔" />
                  </div>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_burstQuietChecksToRecover">
                    <span>高频恢复轮数</span>
                    <span class="info-tip" tabindex="0" data-tip="连续无新变动达到该轮数后自动恢复常态">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <input id="cfg_burstQuietChecksToRecover" type="number" min="1" max="10" class="input mono" />
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_burstExtraRecentNotes">
                    <span>高频额外检查最新篇数</span>
                    <span class="info-tip" tabindex="0" data-tip="高频期间检查主页 + 变动帖 + 除变动帖外最新 N 篇笔记（建议 3–5 篇）">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <input id="cfg_burstExtraRecentNotes" type="number" min="0" max="20" class="input mono" />
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_likeChangeTriggersBurst">点赞变化触发高频</label>
                  <select id="cfg_likeChangeTriggersBurst" class="select">
                    <option value="true">开启</option>
                    <option value="false">关闭</option>
                  </select>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_nextDaySummaryTime">
                    <span>每天自动汇总时间</span>
                    <span class="info-tip" tabindex="0" data-tip="跨过零点后自动核对前一天内容的精确发布时间并生成汇总，建议 00:02">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <input id="cfg_nextDaySummaryTime" class="input mono" placeholder="00:02" />
                </div>
              </div>
            </div>

            <div>
              <h2 class="settings-section-title">通知与浏览器</h2>
              <div class="panel">
                <div class="settings-row">
                  <label class="settings-label" for="cfg_barkKey">
                    <span>手机推送（Bark）</span>
                    <span class="info-tip" tabindex="0" data-tip="粘贴 Bark「服务器」页测试链接或 22 位 Key">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <div style="display:flex;gap:8px;">
                    <input id="cfg_barkKey" class="input mono" placeholder="https://api.day.app/..." />
                    <button type="button" class="btn" id="testBarkBtn" onclick="testBark()">测试推送</button>
                  </div>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_qqMailUser">
                    <span>QQ 邮箱通知</span>
                    <span class="info-tip" tabindex="0" data-tip="填 QQ 号或完整 QQ 邮箱，与下方 16 位授权码同时填写后自动向该邮箱发送提示">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <div style="display:flex;gap:8px;">
                    <input id="cfg_qqMailUser" class="input mono" placeholder="QQ 号或 QQ 邮箱（如 123456@qq.com）" />
                    <button type="button" class="btn" id="testQqMailBtn" onclick="testQqMail()">测试邮件</button>
                  </div>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_qqMailAuthCode">
                    <span>QQ 邮箱授权码</span>
                    <span class="info-tip" tabindex="0" data-tip="在 QQ 邮箱网页版「设置 → 账户」开启 POP3/SMTP 后生成的 16 位授权码，非 QQ 密码">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                    </span>
                  </label>
                  <input id="cfg_qqMailAuthCode" type="password" autocomplete="off" class="input mono" placeholder="16 位 SMTP 授权码" />
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_headless">浏览器显示</label>
                  <select id="cfg_headless" class="select">
                    <option value="true">后台隐藏运行</option>
                    <option value="false">显示浏览器窗口</option>
                  </select>
                </div>
                <div class="settings-row">
                  <label class="settings-label" for="cfg_chromeExecutablePath">Chrome 路径</label>
                  <input id="cfg_chromeExecutablePath" class="input mono" />
                </div>
              </div>
            </div>

            <div style="display:flex;justify-content:flex-end;gap:8px;">
              <button type="button" class="btn btn-primary" id="saveSettingsBtn" onclick="handleSaveSettingsClick()">保存设置</button>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <!-- Slide-Over Note Detail Drawer -->
  <div id="noteDrawer" class="drawer-mask hidden" role="dialog" aria-modal="true" aria-label="作品存档详情" onclick="if(event.target===this)closeDrawer()">
    <div class="drawer-panel">
      <div class="drawer-header">
        <div style="min-width:0;">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" id="drawerTitle">作品详情</div>
        </div>
        <button type="button" class="btn btn-ghost btn-icon" onclick="closeDrawer()" aria-label="关闭详情">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="drawer-body" id="drawerBody"></div>
    </div>
  </div>

  <!-- Confirmation Dialog for High-Impact Changes -->
  <div id="confirmDialog" class="dialog-mask hidden" role="dialog" aria-modal="true" aria-labelledby="confirmTitle" onclick="if(event.target===this)closeConfirm(false)">
    <div class="dialog-box">
      <div class="dialog-title" id="confirmTitle">确认变更</div>
      <div class="dialog-desc" id="confirmDesc"></div>
      <div class="dialog-actions">
        <button type="button" class="btn" onclick="closeConfirm(false)">取消</button>
        <button type="button" class="btn btn-danger" id="confirmOkBtn" onclick="closeConfirm(true)">确认执行</button>
      </div>
    </div>
  </div>

  <!-- Full-screen Lightbox -->
  <div id="lightbox" class="lightbox-mask hidden" role="dialog" aria-modal="true" aria-label="图片预览" onclick="if(event.target===this)closeLightbox()">
    <div class="lightbox-bar">
      <span class="pill mono" id="lightboxCounter" style="background:rgba(17,18,22,0.85);color:#fff;"></span>
      <a id="lightboxOpenRaw" class="btn" href="#" target="_blank" style="text-decoration:none;">原图 ↗</a>
      <button type="button" class="btn btn-icon" onclick="closeLightbox()" aria-label="关闭预览">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <button type="button" class="lightbox-nav lightbox-prev hidden" id="lightboxPrev" onclick="stepLightbox(-1)" aria-label="上一张">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
    </button>
    <img id="lightboxImg" class="lightbox-img" src="" alt="原图预览" />
    <button type="button" class="lightbox-nav lightbox-next hidden" id="lightboxNext" onclick="stepLightbox(1)" aria-label="下一张">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
    </button>
  </div>

  <!-- Toast Stack -->
  <div id="toastStack" class="toast-stack" aria-live="polite"></div>

  <!-- Global Floating Tooltip (avoids panel/table overflow clipping) -->
  <div id="floatingTip" class="floating-tip" role="tooltip"></div>

  <script>
    let currentState = null;
    let activeTab = 'overview';
    let activeCompFilter = 'ALL';
    let activeArchiveSub = 'notes';
    let activeNoteFilter = 'ALL';
    let cachedNotes = [];
    let lightboxImages = [];
    let lightboxIndex = 0;
    let lightboxRegistry = {};
    let lightboxGroupSeq = 0;
    let pendingConfirmResolve = null;

    function registerLightboxGroup(urls) {
      const key = 'lb_' + (++lightboxGroupSeq);
      lightboxRegistry[key] = urls || [];
      return key;
    }

    function openLightboxGroup(key, idx) {
      const urls = lightboxRegistry[key];
      if (urls && urls.length) openLightbox(urls, idx);
    }

    const TAB_META = {
      overview: { title: '概览', tip: '' },
      comparisons: { title: '变动记录', tip: '记录删帖、改文、新评论、删评论、换头像、IP 及资料变动的大概时间与前后内容' },
      midnight: { title: '每日汇总', tip: '每天跨零点后自动核对前一天内容的精确发布时间，也可随时点击顶部「当天汇总」查看今日情况' },
      archive: { title: '本地备份', tip: '所有笔记图片、评论、头像、IP 与资料记录均保存在本地，原帖删除后仍可随时查看' },
      settings: { title: '设置', tip: '' }
    };

    const EVENT_LABELS = {
      BASELINE_READY: ['初始备份', 'ok'],
      NEW_NOTE: ['新发笔记', 'accent'],
      NOTE_UPDATED: ['修改笔记', 'warn'],
      NOTE_SUSPECTED: ['疑似不见', 'warn'],
      NOTE_DELETED: ['删除笔记', 'danger'],
      NOTE_RESTORED: ['恢复显示', 'ok'],
      NOTE_LIKE_CHANGED: ['赞藏变化', 'accent'],
      NEW_COMMENT: ['新增评论', 'accent'],
      COMMENT_DELETED: ['删除评论', 'danger'],
      AVATAR_CHANGED: ['更换头像', 'warn'],
      IP_CHANGED: ['IP 变更', 'warn'],
      NICKNAME_CHANGED: ['名字变更', 'warn'],
      GENDER_CHANGED: ['性别变更', 'warn'],
      BIO_CHANGED: ['签名变更', 'warn'],
      FOLLOWS_CHANGED: ['关注变动', 'accent'],
      FANS_CHANGED: ['粉丝变动', 'accent'],
      INTERACTION_CHANGED: ['赞藏变动', 'accent'],
      DAILY_REPORT: ['每日汇总', 'ok'],
      TIME_REVIEW_ALERT: ['时间偏差', 'warn'],
      SYSTEM_ALERT: ['系统提醒', 'danger']
    };

    const MODE_LABELS = {
      IDLE: ['未设置目标', ''],
      NORMAL: ['正常监控', 'ok'],
      BURST: ['高频监控', 'warn'],
      RUNNING: ['检查中', 'accent'],
      PAUSED_MANUAL: ['已暂停', 'danger'],
      PAUSED_AUTH: ['需要登录', 'danger']
    };

    let serverClockOffsetMs = 0;
    let lastAutoTriggeredTarget = '';
    let lastActiveTargetUid = '';

    function fmtClockHMS(iso) {
      if (!iso) return '--:--:--';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return '--:--:--';
      const p = function(n) { return String(n).padStart(2, '0'); };
      return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
    }

    function fmtCountdown(ms) {
      const totalSec = Math.max(0, Math.ceil(ms / 1000));
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      const p = function(n) { return String(n).padStart(2, '0'); };
      return h > 0 ? (h + ':' + p(m) + ':' + p(s)) : (p(m) + ':' + p(s));
    }

    function tickCountdown() {
      const card = document.getElementById('nextRunCard');
      const dot = document.getElementById('cdDot');
      const lbl = document.getElementById('cdLabel');
      const exactEl = document.getElementById('cdExactTime');
      const subEl = document.getElementById('cdStatusLine');
      const timerEl = document.getElementById('cdTimer');
      const barEl = document.getElementById('cdBarFill');
      const sideShort = document.getElementById('nextRunShort');
      if (!currentState || !currentState.status || !card) return;

      const st = currentState.status;
      const cfg = currentState.config || {};
      const mInfo = MODE_LABELS[st.mode] || [st.mode, ''];

      if (st.isRunningNow) {
        card.classList.add('running');
        dot.className = 'runtime-dot running';
        lbl.textContent = '正在监控';
        exactEl.textContent = '检查全部笔记';
        subEl.textContent = st.progressText || '正在检查账号资料与全部笔记...';
        timerEl.textContent = '运行中';
        timerEl.className = 'countdown-timer mono accent';
        barEl.className = 'countdown-bar-fill indeterminate';
        if (sideShort) sideShort.textContent = '运行中';
        return;
      }

      card.classList.remove('running');
      barEl.className = 'countdown-bar-fill';

      if (st.mode === 'PAUSED_MANUAL' || st.mode === 'PAUSED_AUTH' || st.mode === 'IDLE' || !st.nextRunAt) {
        dot.className = 'runtime-dot ' + (mInfo[1] || '');
        lbl.textContent = '下次监控';
        exactEl.textContent = st.mode === 'IDLE' ? '未设置目标' : (st.mode === 'PAUSED_AUTH' ? '需要重新登录' : '已暂停');
        subEl.textContent = st.progressText || '';
        timerEl.textContent = '--:--';
        timerEl.className = 'countdown-timer mono muted';
        barEl.style.width = '0%';
        if (sideShort) sideShort.textContent = st.mode === 'IDLE' ? '-' : '暂停';
        return;
      }

      const targetMs = new Date(st.nextRunAt).getTime();
      const nowSynced = Date.now() + serverClockOffsetMs;
      const remainMs = targetMs - nowSynced;
      const fallbackDelayMs = (st.mode === 'BURST' ? (cfg.burstMinMinutes || 5) : (cfg.lightCheckMinMinutes || 15)) * 60000;
      const totalMs = Math.max(1000, st.nextRunDelayMs || fallbackDelayMs);

      const kindLabelMap = {
        BASELINE: '首次备份',
        PROFILE_LIGHT: '下次主页检查',
        FULL_SCAN: '下次全部笔记',
        BURST_CHECK: '下次高频监控',
        MIDNIGHT_RECONCILE: '次日时间核对'
      };
      dot.className = 'runtime-dot ' + (mInfo[1] || 'ok');
      lbl.textContent = (st.nextRunKind && kindLabelMap[st.nextRunKind]) || (st.mode === 'BURST' ? '下次高频监控' : '下次监控');
      exactEl.textContent = fmtClockHMS(st.nextRunAt);

      const nextFullPill = document.getElementById('cdNextFullPill');
      if (nextFullPill) {
        if (st.nextRunKind === 'PROFILE_LIGHT' && st.nextFullScanAt) {
          nextFullPill.textContent = '全量 ' + fmtClockHMS(st.nextFullScanAt).slice(0, 5);
          nextFullPill.classList.remove('hidden');
        } else {
          nextFullPill.classList.add('hidden');
        }
      }

      if (remainMs <= 0) {
        subEl.textContent = '倒计时结束，正在自动开始监控...';
        timerEl.textContent = '00:00';
        timerEl.className = 'countdown-timer mono accent';
        barEl.style.width = '100%';
        if (sideShort) sideShort.textContent = '00:00';

        // 时间一到：前端立即刷新并在超过 1.5 秒仍未启动时主动触发保底运行
        if (remainMs <= -1500 && lastAutoTriggeredTarget !== st.nextRunAt) {
          lastAutoTriggeredTarget = st.nextRunAt;
          fetch('/api/actions/run-now', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fullScan: st.nextRunKind === 'FULL_SCAN' })
          }).then(function() { setTimeout(loadOverview, 400); }).catch(function() {});
        } else {
          loadOverview();
        }
        return;
      }

      const text = fmtCountdown(remainMs);
      const pct = Math.max(0, Math.min(100, ((totalMs - remainMs) / totalMs) * 100));
      subEl.textContent = st.progressText || '倒计时结束后自动开始';
      timerEl.textContent = text;
      timerEl.className = 'countdown-timer mono';
      barEl.style.width = pct.toFixed(1) + '%';
      if (sideShort) sideShort.textContent = text;
    }

    function esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, function(m) {
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
      });
    }

    function fmtTime(iso) {
      if (!iso) return '-';
      const d = new Date(iso);
      if (isNaN(d.getTime())) return String(iso);
      const p = function(n) { return String(n).padStart(2, '0'); };
      return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }

    function showToast(message, type) {
      const stack = document.getElementById('toastStack');
      const el = document.createElement('div');
      el.className = 'toast ' + (type || '');
      el.innerHTML = '<span class="toast-dot"></span><span>' + esc(message) + '</span>';
      stack.appendChild(el);
      setTimeout(function() {
        el.style.opacity = '0';
        el.style.transform = 'translateY(6px)';
        el.style.transition = 'opacity 0.2s, transform 0.2s';
        setTimeout(function() { el.remove(); }, 220);
      }, 3400);
    }

    function askConfirm(title, desc, okLabel) {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmDesc').textContent = desc;
      document.getElementById('confirmOkBtn').textContent = okLabel || '确认';
      document.getElementById('confirmDialog').classList.remove('hidden');
      return new Promise(function(resolve) { pendingConfirmResolve = resolve; });
    }

    function closeConfirm(result) {
      document.getElementById('confirmDialog').classList.add('hidden');
      if (pendingConfirmResolve) {
        const fn = pendingConfirmResolve;
        pendingConfirmResolve = null;
        fn(Boolean(result));
      }
    }

    function initTheme() {
      const saved = localStorage.getItem('xhs-monitor-theme') || 'dark';
      applyTheme(saved);
    }

    function applyTheme(theme) {
      const t = theme === 'light' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('xhs-monitor-theme', t);
      const icon = document.getElementById('themeIcon');
      if (icon) {
        icon.innerHTML = t === 'dark'
          ? '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>'
          : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
      }
    }

    function toggleTheme() {
      const cur = document.documentElement.getAttribute('data-theme') || 'dark';
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    }

    function switchTab(name) {
      activeTab = name;
      document.querySelectorAll('section[id^="tab-"]').forEach(function(el) {
        el.classList.add('hidden');
      });
      const target = document.getElementById('tab-' + name);
      if (target) target.classList.remove('hidden');

      document.querySelectorAll('.nav-item').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.tab === name);
      });

      const meta = TAB_META[name] || { title: name, tip: '' };
      document.getElementById('topbarTitle').textContent = meta.title;
      const tipEl = document.getElementById('topbarInfoTip');
      if (meta.tip) {
        tipEl.setAttribute('data-tip', meta.tip);
        tipEl.classList.remove('hidden');
      } else {
        tipEl.classList.add('hidden');
      }

      if (name === 'comparisons') loadComparisons();
      if (name === 'midnight') loadDailyReport();
      if (name === 'archive') {
        if (activeArchiveSub === 'notes') loadArchiveNotes();
        else renderArchiveSideViews();
      }
    }

    function openArchiveSub(sub) {
      activeArchiveSub = sub;
      if (activeTab !== 'archive') {
        switchTab('archive');
      }
      document.querySelectorAll('[data-sub]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.sub === sub);
      });
      document.getElementById('archive-sub-notes').classList.toggle('hidden', sub !== 'notes');
      document.getElementById('archive-sub-ip').classList.toggle('hidden', sub !== 'ip');
      document.getElementById('archive-sub-avatars').classList.toggle('hidden', sub !== 'avatars');
      document.getElementById('archive-sub-profile').classList.toggle('hidden', sub !== 'profile');
      document.getElementById('archiveNotesControls').classList.toggle('hidden', sub !== 'notes');

      if (sub === 'notes') loadArchiveNotes();
      else renderArchiveSideViews();
    }

    function setCompFilter(val, btn) {
      activeCompFilter = val;
      document.querySelectorAll('#compFilterSeg .seg-btn').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      loadComparisons();
    }

    function setNoteFilter(val, btn) {
      activeNoteFilter = val;
      document.querySelectorAll('[data-nfilter]').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      loadArchiveNotes();
    }

    async function loadOverview() {
      try {
        const res = await fetch('/api/overview').then(function(r) { return r.json(); });
        if (!res.ok) return;
        currentState = res;
        const st = res.status;
        if (st && st.serverNow) {
          const srvMs = Date.parse(st.serverNow);
          if (!isNaN(srvMs)) serverClockOffsetMs = srvMs - Date.now();
        }
        const prof = res.profile;
        const cfg = res.config || {};
        const stats = res.stats || {};
        const ipHist = res.ipHistory || [];
        const avHist = res.avatarHistory || [];
        const pfHist = res.profileFieldHistory || [];

        // Mode & Progress
        const mInfo = MODE_LABELS[st.mode] || [st.mode, ''];
        const modePill = document.getElementById('topbarModePill');
        modePill.textContent = mInfo[0];
        modePill.className = 'pill ' + mInfo[1];

        document.getElementById('progressRail').classList.toggle('active', Boolean(st.isRunningNow));
        document.getElementById('runNowBtn').disabled = Boolean(st.isRunningNow);
        const fullBtn = document.getElementById('fullScanBtn');
        if (fullBtn) fullBtn.disabled = Boolean(st.isRunningNow);

        const dotCls = st.isRunningNow ? 'running' : (mInfo[1] === 'accent' ? 'running' : mInfo[1]);
        document.getElementById('wsStatusDot').className = 'ws-status-dot ' + dotCls;
        document.getElementById('runtimeDot').className = 'runtime-dot ' + dotCls;
        document.getElementById('runtimeText').textContent = mInfo[0];
        document.getElementById('runtimePill').title = (st.progressText || '') + (st.nextRunAt ? ' | 下次监控：' + fmtTime(st.nextRunAt) : '');
        tickCountdown();

        const pauseBtn = document.getElementById('pauseResumeBtn');
        pauseBtn.textContent = st.mode && st.mode.startsWith('PAUSED') ? '继续' : '暂停';

        // Auth Alert Strip
        const authStrip = document.getElementById('authAlertStrip');
        if (st.mode === 'PAUSED_AUTH') {
          document.getElementById('authAlertText').textContent = st.lastError || '需要重新扫码登录或完成人工安全验证';
          authStrip.classList.remove('hidden');
        } else {
          authStrip.classList.add('hidden');
        }

        // Onboarding vs Active Profile
        const hasTarget = Boolean(cfg.targetProfileUrl);
        document.getElementById('onboardingPanel').classList.toggle('hidden', hasTarget);
        document.getElementById('profileBar').classList.toggle('hidden', !prof);

        if (prof) {
          const displayName = cfg.targetRemark ? (prof.nickname + ' · ' + cfg.targetRemark) : prof.nickname;
          const avatarSrc = prof.localAvatarPath || prof.avatar || '';
          document.getElementById('wsName').textContent = displayName;
          document.getElementById('wsSub').textContent = (prof.redId ? 'ID ' + prof.redId : '') + (prof.ipLocation ? ' · ' + prof.ipLocation : '');
          const wsAv = document.getElementById('wsAvatar');
          wsAv.innerHTML = avatarSrc
            ? '<img src="' + esc(avatarSrc) + '" alt="" />'
            : esc((prof.nickname || 'X').slice(0, 1));

          document.getElementById('ovNickname').textContent = displayName;
          const genderPill = document.getElementById('ovGenderPill');
          if (prof.gender) {
            genderPill.textContent = prof.gender;
            genderPill.classList.remove('hidden');
          } else {
            genderPill.classList.add('hidden');
          }
          document.getElementById('ovRedId').textContent = prof.redId || '';
          const bioLine = document.getElementById('ovBioLine');
          if (prof.desc) {
            bioLine.textContent = prof.desc;
            bioLine.classList.remove('hidden');
          } else {
            bioLine.classList.add('hidden');
          }
          document.getElementById('ovProgressLine').textContent = st.progressText || '';
          const pfChangeCnt = pfHist.filter(function(x) { return x.oldValue !== null && x.oldValue !== undefined; }).length;
          const pfPill = document.getElementById('ovProfileChangePill');
          if (pfChangeCnt > 0) {
            pfPill.textContent = '资料变更 ' + pfChangeCnt;
            pfPill.classList.remove('hidden');
          } else {
            pfPill.classList.add('hidden');
          }
          const ovImg = document.getElementById('ovAvatarImg');
          if (avatarSrc) {
            ovImg.src = avatarSrc;
            ovImg.classList.remove('hidden');
          } else {
            ovImg.classList.add('hidden');
          }

          const ipChangeCnt = ipHist.filter(function(x) { return Boolean(x.previousIp); }).length;
          const curIp = prof.ipLocation || (ipHist[0] && ipHist[0].ipLocation) || '';
          const ovIpPill = document.getElementById('ovIpPill');
          if (curIp) {
            ovIpPill.innerHTML = '<span class="pill-dot"></span>IP ' + esc(curIp) + (ipChangeCnt > 0 ? ' · ' + ipChangeCnt + ' 变更' : '');
            ovIpPill.className = 'pill ' + (ipChangeCnt > 0 ? 'warn' : 'ok');
            ovIpPill.classList.remove('hidden');
          } else {
            ovIpPill.classList.add('hidden');
          }

          const ovAvPill = document.getElementById('ovAvatarPill');
          if (avHist.length > 0) {
            ovAvPill.textContent = '头像 ' + avHist.length;
            ovAvPill.classList.remove('hidden');
          } else {
            ovAvPill.classList.add('hidden');
          }

          document.getElementById('ovFollows').textContent = prof.followsRaw || '0';
          document.getElementById('ovFans').textContent = prof.fansRaw || '0';
          document.getElementById('ovInteraction').textContent = prof.interactionRaw || '0';
        } else {
          document.getElementById('wsAvatar').textContent = 'X';
          document.getElementById('wsName').textContent = hasTarget ? '等待首次采集' : 'XHS Monitor';
          document.getElementById('wsSub').textContent = hasTarget ? mInfo[0] : '未配置目标';
        }

        const cfgUidMatch = String(cfg.targetProfileUrl || '').match(/\\/user\\/profile\\/([a-zA-Z0-9_-]+)/);
        const curTargetUid = (cfgUidMatch && cfgUidMatch[1]) || (prof && prof.userId) || '';
        if (lastActiveTargetUid && curTargetUid && lastActiveTargetUid !== curTargetUid) {
          cachedNotes = [];
          lastAutoTriggeredTarget = '';
          if (activeTab === 'comparisons') loadComparisons();
          if (activeTab === 'midnight') loadDailyReport();
          if (activeTab === 'archive' && activeArchiveSub === 'notes') loadArchiveNotes();
        }
        if (curTargetUid) lastActiveTargetUid = curTargetUid;

        // KPI Strip & Sidebar Badges
        document.getElementById('statNotes').textContent = String(stats.totalNotes || 0);
        document.getElementById('statNotesSub').textContent = '初始 ' + (stats.baselineNotes || 0) + ' · 正常 ' + (stats.activeNotes || 0);
        const delNPill = document.getElementById('kpiDeletedNotesPill');
        if (stats.deletedNotes > 0) {
          delNPill.textContent = '已删 ' + stats.deletedNotes;
          delNPill.className = 'pill danger';
        } else {
          delNPill.classList.add('hidden');
        }

        document.getElementById('statComments').textContent = String(stats.totalComments || 0);
        document.getElementById('statCommentsSub').textContent = '正常 ' + (stats.activeComments || 0);
        const delCPill = document.getElementById('kpiDeletedCommsPill');
        if (stats.deletedComments > 0) {
          delCPill.textContent = '已删 ' + stats.deletedComments;
          delCPill.className = 'pill danger';
        } else {
          delCPill.classList.add('hidden');
        }

        document.getElementById('statComparisons').textContent = String(stats.comparisonsCount || 0);
        document.getElementById('statRecSub').textContent = '已核对 ' + (stats.reconciliationsCount || 0) + ' 条';

        const curIpVal = (prof && prof.ipLocation) || (ipHist[0] && ipHist[0].ipLocation) || '-';
        const ipChanges = stats.ipChangeCount || ipHist.filter(function(x) { return Boolean(x.previousIp); }).length;
        document.getElementById('statCurrentIp').textContent = curIpVal;
        document.getElementById('statIpSub').textContent = '本地记录 ' + (stats.ipHistoryCount || ipHist.length) + ' 条';
        const ipChPill = document.getElementById('kpiIpChangePill');
        if (ipChanges > 0) {
          ipChPill.textContent = ipChanges + ' 次变更';
          ipChPill.className = 'pill warn';
        } else {
          ipChPill.classList.add('hidden');
        }

        const navComp = document.getElementById('navCompBadge');
        navComp.textContent = String(stats.comparisonsCount || 0);
        navComp.classList.toggle('hidden', !stats.comparisonsCount);

        const navArch = document.getElementById('navArchiveBadge');
        navArch.textContent = String(stats.totalNotes || 0);
        navArch.classList.toggle('hidden', !stats.totalNotes);

        document.getElementById('subCountNotes').textContent = String(stats.totalNotes || 0);
        document.getElementById('subCountIp').textContent = String(ipHist.length);
        document.getElementById('subCountAvatars').textContent = String(avHist.length);
        document.getElementById('subCountProfile').textContent = String(pfHist.length);

        // Midnight meta pill
        const midPill = document.getElementById('midnightMetaPill');
        if (midPill) {
          midPill.textContent = '每日 ' + (st.nextMidnightSummaryTime || '00:02') + (st.lastReconciledDate ? ' · 上次 ' + st.lastReconciledDate : '');
        }

        // Events Feed
        const events = res.recentEvents || [];
        document.getElementById('eventsCountLabel').textContent = String(events.length);
        const listEl = document.getElementById('eventsList');
        if (events.length === 0) {
          listEl.innerHTML = '<div class="empty-state" style="padding:32px;"><div style="font-size:12.5px;color:var(--text-muted);">暂无监控动态</div></div>';
        } else {
          listEl.innerHTML = events.map(function(ev) {
            const info = EVENT_LABELS[ev.eventType] || [ev.eventType, 'accent'];
            const clickAttr = ev.noteId &&
              !String(ev.noteId).startsWith('ip_') &&
              !String(ev.noteId).startsWith('avatar_') &&
              !String(ev.noteId).startsWith('profile_')
              ? ' class="event-row clickable" onclick="openNoteDetail(\\'' + esc(ev.noteId) + '\\')"'
              : ' class="event-row"';
            return '<div' + clickAttr + '>' +
              '<span class="event-dot ' + info[1] + '"></span>' +
              '<span class="pill ' + info[1] + '">' + esc(info[0]) + '</span>' +
              '<div class="event-main">' +
                '<div class="event-title">' + esc(ev.title) + '</div>' +
                '<div class="event-body">' + esc(ev.body) + '</div>' +
              '</div>' +
              '<span class="event-time mono">' + esc(fmtTime(ev.createdAt)) + '</span>' +
            '</div>';
          }).join('');
        }

        // Keep IP / Avatar sub-views synced
        renderArchiveSideViews();

        // Populate settings form once
        const urlEl = document.getElementById('cfg_targetProfileUrl');
        if (urlEl && !urlEl.dataset.loaded) {
          urlEl.value = cfg.targetProfileUrl || '';
          document.getElementById('cfg_targetRemark').value = cfg.targetRemark || '';
          document.getElementById('cfg_lightCheckMinMinutes').value = cfg.lightCheckMinMinutes ?? 15;
          document.getElementById('cfg_lightCheckMaxMinutes').value = cfg.lightCheckMaxMinutes ?? 20;
          document.getElementById('cfg_fullScanMinMinutes').value = cfg.fullScanMinMinutes ?? 50;
          document.getElementById('cfg_fullScanMaxMinutes').value = cfg.fullScanMaxMinutes ?? 55;
          document.getElementById('cfg_burstMinMinutes').value = cfg.burstMinMinutes ?? 5;
          document.getElementById('cfg_burstMaxMinutes').value = cfg.burstMaxMinutes ?? 10;
          document.getElementById('cfg_burstQuietChecksToRecover').value = cfg.burstQuietChecksToRecover ?? 2;
          document.getElementById('cfg_burstExtraRecentNotes').value = cfg.burstExtraRecentNotes ?? 4;
          document.getElementById('cfg_likeChangeTriggersBurst').value = String(cfg.likeChangeTriggersBurst !== false);
          document.getElementById('cfg_nextDaySummaryTime').value = cfg.nextDaySummaryTime || '00:02';
          document.getElementById('cfg_barkKey').value = cfg.barkKey || '';
          document.getElementById('cfg_qqMailUser').value = cfg.qqMailUser || '';
          document.getElementById('cfg_qqMailAuthCode').value = cfg.qqMailAuthCode || '';
          document.getElementById('cfg_chromeExecutablePath').value = cfg.chromeExecutablePath || '';
          document.getElementById('cfg_headless').value = String(cfg.headless !== false);
          urlEl.dataset.loaded = '1';
        }
      } catch (e) {
        // ignore transient polling error
      }
    }

    function renderArchiveSideViews() {
      if (!currentState) return;
      const ipHist = currentState.ipHistory || [];
      const avHist = currentState.avatarHistory || [];
      const prof = currentState.profile;

      const ipChangeCnt = ipHist.filter(function(x) { return Boolean(x.previousIp); }).length;
      const curIp = (prof && prof.ipLocation) || (ipHist[0] && ipHist[0].ipLocation) || '-';
      const sumBadge = document.getElementById('ipHistorySummaryBadge');
      if (sumBadge) {
        sumBadge.textContent = '当前 ' + curIp + (ipChangeCnt > 0 ? ' · 变更 ' + ipChangeCnt + ' 次' : '');
        sumBadge.className = 'pill ' + (ipChangeCnt > 0 ? 'warn' : 'ok');
      }

      const ipTbody = document.getElementById('ipHistoryTbody');
      if (ipTbody) {
        if (ipHist.length === 0) {
          ipTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:28px;">暂无 IP 属地记录</td></tr>';
        } else {
          ipTbody.innerHTML = ipHist.map(function(item, idx) {
            const isChange = Boolean(item.previousIp);
            const statusPill = isChange
              ? '<span class="pill warn"><span class="pill-dot"></span>变更</span>'
              : (idx === 0 ? '<span class="pill ok"><span class="pill-dot"></span>当前</span>' : '<span class="pill">初始</span>');
            const srcPill = item.source === 'NOTE'
              ? '<span class="pill accent">笔记</span>'
              : '<span class="pill">主页</span>';
            const ipCell = isChange
              ? '<span style="color:var(--text-muted);">' + esc(item.previousIp) + '</span> <span style="color:var(--text-muted);margin:0 4px;">→</span> <strong>' + esc(item.ipLocation) + '</strong>'
              : '<strong>' + esc(item.ipLocation) + '</strong>';
            const noteLink = item.noteId
              ? ' <button type="button" class="btn btn-ghost" style="height:22px;padding:0 6px;font-size:11px;" onclick="openNoteDetail(\\'' + esc(item.noteId) + '\\')">查看笔记</button>'
              : '';
            const winText = item.estimatedChangeWindow ? esc(item.estimatedChangeWindow) : '-';
            return '<tr>' +
              '<td>' + statusPill + '</td>' +
              '<td>' + srcPill + '</td>' +
              '<td>' + ipCell + '</td>' +
              '<td class="mono" style="color:var(--text-secondary);">' + esc(fmtTime(item.capturedAt)) + '</td>' +
              '<td style="color:var(--text-secondary);">' + winText + noteLink + '</td>' +
            '</tr>';
          }).join('');
        }
      }

      const avGrid = document.getElementById('avatarHistoryGrid');
      if (avGrid) {
        if (avHist.length === 0) {
          avGrid.innerHTML = '<div class="panel" style="grid-column:1/-1;"><div class="empty-state" style="padding:32px;"><div style="font-size:12.5px;color:var(--text-muted);">暂无已归档头像</div></div></div>';
        } else {
          avGrid.innerHTML = avHist.map(function(av, idx) {
            const tag = idx === 0 ? '<span class="pill ok">当前</span>' : '<span class="pill">历史</span>';
            return '<div class="avatar-card">' +
              '<img src="' + esc(av.localPath) + '" alt="历史头像" onclick="openSingleLightbox(\\'' + esc(av.localPath) + '\\')" />' +
              tag +
              '<div class="mono" style="font-size:11px;color:var(--text-muted);">' + esc(fmtTime(av.capturedAt)) + '</div>' +
            '</div>';
          }).join('');
        }
      }

      const pfHist = currentState.profileFieldHistory || [];
      const pfChangeCnt = pfHist.filter(function(x) { return x.oldValue !== null && x.oldValue !== undefined; }).length;
      const pfCurName = document.getElementById('pfCurNickname');
      const pfCurGender = document.getElementById('pfCurGender');
      const pfCurBio = document.getElementById('pfCurBio');
      if (pfCurName) pfCurName.textContent = (prof && prof.nickname) || '-';
      if (pfCurGender) pfCurGender.textContent = (prof && prof.gender) || '未设置';
      if (pfCurBio) {
        pfCurBio.textContent = (prof && prof.desc) ? prof.desc : '（空白）';
        pfCurBio.style.color = (prof && prof.desc) ? 'var(--text-primary)' : 'var(--text-muted)';
      }
      const pfBadge = document.getElementById('profileHistorySummaryBadge');
      if (pfBadge) {
        pfBadge.textContent = pfChangeCnt > 0 ? ('变更 ' + pfChangeCnt + ' 次') : (pfHist.length + ' 条记录');
        pfBadge.className = 'pill ' + (pfChangeCnt > 0 ? 'warn' : 'ok');
      }
      const pfTbody = document.getElementById('profileHistoryTbody');
      if (pfTbody) {
        if (pfHist.length === 0) {
          pfTbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:var(--text-muted);padding:28px;">暂无资料记录</td></tr>';
        } else {
          const fMeta = {
            NICKNAME: ['名字', 'accent', '（未知）'],
            GENDER: ['性别', 'ok', '（未设置）'],
            BIO: ['签名', 'warn', '（空白）']
          };
          pfTbody.innerHTML = pfHist.map(function(item) {
            const fm = fMeta[item.field] || [item.field, '', '（空白）'];
            const isChange = item.oldValue !== null && item.oldValue !== undefined;
            const oldText = item.oldValue ? item.oldValue : fm[2];
            const newText = item.newValue ? item.newValue : fm[2];
            const valHtml = isChange
              ? '<span style="color:var(--text-muted);">' + esc(oldText) + '</span> <span style="color:var(--text-muted);margin:0 4px;">→</span> <strong>' + esc(newText) + '</strong>'
              : '<span style="color:' + (item.newValue ? 'var(--text-primary)' : 'var(--text-muted)') + ';">' + esc(newText) + '</span>';
            const statusPill = isChange
              ? '<span class="pill warn"><span class="pill-dot"></span>变更</span>'
              : '<span class="pill">初始</span>';
            return '<tr>' +
              '<td><span class="pill ' + fm[1] + '">' + esc(fm[0]) + '</span></td>' +
              '<td>' + statusPill + '</td>' +
              '<td style="word-break:break-word;">' + valHtml + '</td>' +
              '<td class="mono" style="color:var(--text-secondary);">' + esc(fmtTime(item.capturedAt)) + '</td>' +
              '<td style="color:var(--text-secondary);">' + esc(item.estimatedChangeWindow || '-') + '</td>' +
            '</tr>';
          }).join('');
        }
      }
    }

    async function loadComparisons() {
      const res = await fetch('/api/comparisons?type=' + encodeURIComponent(activeCompFilter)).then(function(r) { return r.json(); });
      const box = document.getElementById('comparisonsList');
      const records = res.records || [];
      if (records.length === 0) {
        box.innerHTML = '<div class="panel"><div class="empty-state"><div class="empty-title">暂无变动对比记录</div></div></div>';
        return;
      }

      const labelMap = {
        NOTE_DELETED: ['删帖', 'danger'],
        COMMENT_APPEARED: ['新评', 'accent'],
        COMMENT_DELETED: ['删评', 'danger'],
        NOTE_EDITED: ['改文', 'warn'],
        AVATAR_CHANGED: ['换头像', 'warn'],
        IP_CHANGED: ['IP 变更', 'warn'],
        NICKNAME_CHANGED: ['改名', 'warn'],
        GENDER_CHANGED: ['性别变更', 'warn'],
        BIO_CHANGED: ['签名变更', 'warn']
      };

      box.innerHTML = records.map(function(r) {
        const meta = labelMap[r.compareType] || [r.compareType, 'accent'];
        const isInlineTransition =
          r.compareType === 'IP_CHANGED' ||
          r.compareType === 'NICKNAME_CHANGED' ||
          r.compareType === 'GENDER_CHANGED';
        const isBio = r.compareType === 'BIO_CHANGED';
        const isAvatar = r.compareType === 'AVATAR_CHANGED';
        const isEdit = r.compareType === 'NOTE_EDITED';
        const hasRealNote =
          r.noteId &&
          !String(r.noteId).startsWith('ip_') &&
          !String(r.noteId).startsWith('avatar_') &&
          !String(r.noteId).startsWith('profile_');

        let bodyHtml = '';
        if (isInlineTransition) {
          bodyHtml = '<div class="ip-transition">' +
            '<span style="color:var(--text-secondary);">' + esc(r.localSavedContent) + '</span>' +
            '<span class="ip-arrow">→</span>' +
            '<strong>' + esc(r.newContentIfEdited || '-') + '</strong>' +
          '</div>';
        } else if (isAvatar) {
          const imgs = r.localPhotoPaths || [];
          const avKey = registerLightboxGroup(imgs);
          bodyHtml = '<div class="thumb-row" style="align-items:center;">' +
            imgs.map(function(p, idx) {
              return (idx === 1 ? '<span class="ip-arrow" style="font-size:16px;">→</span>' : '') +
                '<img class="thumb-img" style="border-radius:50%;" src="' + esc(p) + '" alt="头像对比" onclick="openLightboxGroup(\\'' + avKey + '\\',' + idx + ')" />';
            }).join('') +
          '</div>';
        } else if ((isEdit || isBio) && r.newContentIfEdited) {
          bodyHtml = '<div class="diff-grid">' +
            '<pre class="diff-box before">' + esc(r.localSavedContent) + '</pre>' +
            '<pre class="diff-box after">' + esc(r.newContentIfEdited) + '</pre>' +
          '</div>';
        } else {
          bodyHtml = '<pre class="diff-box">' + esc(r.localSavedContent) + '</pre>';
        }

        const photoKey = !isAvatar && (r.localPhotoPaths || []).length ? registerLightboxGroup(r.localPhotoPaths) : '';
        const photosHtml = photoKey
          ? '<div class="thumb-row">' + r.localPhotoPaths.map(function(p, idx) {
              return '<img class="thumb-img" src="' + esc(p) + '" alt="归档图片" onclick="openLightboxGroup(\\'' + photoKey + '\\',' + idx + ')" />';
            }).join('') + '</div>'
          : '';

        const timeLabel = isInlineTransition || isBio ? '原记录时间' : isAvatar ? '旧头像存档' : '笔记时间';

        return '<div class="comp-card ' + meta[1] + '">' +
          '<div class="comp-top">' +
            '<div class="comp-title-group">' +
              '<span class="pill ' + meta[1] + '"><span class="pill-dot"></span>' + esc(meta[0]) + '</span>' +
              '<span class="comp-title">' + esc(r.noteTitle) + '</span>' +
            '</div>' +
            '<div style="display:flex;align-items:center;gap:8px;">' +
              (hasRealNote ? '<button type="button" class="btn btn-ghost" style="height:24px;font-size:11.5px;" onclick="openNoteDetail(\\'' + esc(r.noteId) + '\\')">查看作品</button>' : '') +
              '<span class="mono" style="font-size:11.5px;color:var(--text-muted);">' + esc(r.detectedChangeTime) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="comp-meta">' +
            '<span>' + timeLabel + '：<strong>' + esc(r.notePublishTime) + '</strong></span>' +
            (r.commentPublishTime ? '<span>评论（@' + esc(r.authorNickname) + '）：<strong>' + esc(r.commentPublishTime) + '</strong></span>' : '') +
            '<span class="comp-highlight">' + esc(r.estimatedActionTimeText) + '</span>' +
          '</div>' +
          bodyHtml +
          photosHtml +
        '</div>';
      }).join('');
    }

    async function loadDailyReport() {
      const dateInput = document.getElementById('reportDateInput');
      const q = dateInput.value ? '?date=' + encodeURIComponent(dateInput.value) : '';
      const res = await fetch('/api/daily-report' + q).then(function(r) { return r.json(); });
      if (!dateInput.value && res.dateKey) {
        dateInput.value = res.dateKey;
      }

      const statsEl = document.getElementById('reportSummaryStats');
      if (res.report) {
        const c = res.report.counts || {};
        const a = res.report.account || {};
        statsEl.classList.remove('hidden');
        statsEl.innerHTML =
          '<div class="mini-stat"><div class="mini-stat-lbl">笔记变化</div><div class="mini-stat-val num">+' + (c.newNotes || 0) + ' / -' + (c.deletedNotes || 0) + '</div></div>' +
          '<div class="mini-stat"><div class="mini-stat-lbl">评论变化</div><div class="mini-stat-val num">+' + (c.newComments || 0) + ' / -' + (c.deletedComments || 0) + '</div></div>' +
          '<div class="mini-stat"><div class="mini-stat-lbl">IP 属地</div><div class="mini-stat-val" style="font-size:15px;">' + esc(a.ipLocationEnd || a.ipLocationStart || '-') + ((c.ipChanges || 0) > 0 ? ' (' + c.ipChanges + ')' : '') + '</div></div>' +
          '<div class="mini-stat"><div class="mini-stat-lbl">时间核对</div><div class="mini-stat-val num">' + (c.timeCheckMatched || 0) + ' / ' + (c.timeCheckTotal || 0) + '</div></div>';
      } else {
        statsEl.classList.add('hidden');
      }

      const list = res.reconciliations || [];
      document.getElementById('reconcileCountLabel').textContent = String(list.length);
      const tbody = document.getElementById('reconcileTbody');
      if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:var(--text-muted);padding:32px;">当天暂无新增笔记或评论</td></tr>';
        return;
      }

      const stMap = {
        MATCHED: ['正常', 'ok'],
        REVIEWED_OK: ['已确认', 'ok'],
        DELETED_BEFORE_MIDNIGHT: ['0点前已删', 'danger'],
        NEEDS_REVIEW: ['偏差较大', 'warn']
      };

      tbody.innerHTML = list.map(function(item) {
        const s = stMap[item.status] || [item.status, 'accent'];
        const actionHtml = item.status === 'NEEDS_REVIEW'
          ? '<button type="button" class="btn" style="height:24px;font-size:11.5px;" onclick="markReviewed(' + item.id + ')">确认无误</button>'
          : '<span style="color:var(--text-muted);">-</span>';
        const reasonTip = item.anomalyReason
          ? '<span class="info-tip" tabindex="0" data-tip="' + esc(item.anomalyReason) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg></span>'
          : '';
        return '<tr>' +
          '<td><span class="pill">' + (item.itemType === 'NOTE' ? '笔记' : '评论') + '</span></td>' +
          '<td><div style="font-weight:500;">' + esc(item.titleOrExcerpt) + '</div><div style="font-size:11.5px;color:var(--text-muted);">@' + esc(item.authorNickname) + '</div></td>' +
          '<td class="mono" style="color:var(--text-secondary);">' + esc(fmtTime(item.localRecordedAt)) + '</td>' +
          '<td style="color:var(--text-secondary);">' + esc(item.sameDayPlatformTimeText) + '</td>' +
          '<td class="mono" style="font-weight:500;">' + esc(item.nextDayVerifiedTimeText) + '</td>' +
          '<td class="mono">' + (item.captureDelayMinutes !== null ? item.captureDelayMinutes + 'm' : '-') + '</td>' +
          '<td><span style="display:inline-flex;align-items:center;gap:5px;"><span class="pill ' + s[1] + '"><span class="pill-dot"></span>' + esc(s[0]) + '</span>' + reasonTip + '</span></td>' +
          '<td>' + actionHtml + '</td>' +
        '</tr>';
      }).join('');
    }

    async function generateReport(refreshOnline) {
      const dateKey = document.getElementById('reportDateInput').value;
      const btn = document.getElementById(refreshOnline ? 'recalcOnlineBtn' : 'recalcLocalBtn');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = refreshOnline ? '核对中...' : '汇总中...';
      try {
        const res = await fetch('/api/daily-report/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateKey, refreshOnline })
        }).then(function(r) { return r.json(); });
        showToast(res.message || '汇总完成', res.ok ? 'ok' : 'danger');
        await loadDailyReport();
        loadOverview();
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }

    async function markReviewed(id) {
      await fetch('/api/reconciliations/' + id + '/review', { method: 'POST' });
      showToast('已确认无误', 'ok');
      loadDailyReport();
    }

    async function loadArchiveNotes() {
      const res = await fetch('/api/notes?filter=' + encodeURIComponent(activeNoteFilter)).then(function(r) { return r.json(); });
      cachedNotes = res.notes || [];
      renderArchiveNotesGrid();
    }

    function renderArchiveNotesGrid() {
      const grid = document.getElementById('archiveNotesGrid');
      const kw = (document.getElementById('archiveSearchInput').value || '').trim().toLowerCase();
      const notes = kw
        ? cachedNotes.filter(function(n) {
            return (n.title || '').toLowerCase().includes(kw) ||
              (n.desc || '').toLowerCase().includes(kw) ||
              (n.noteId || '').toLowerCase().includes(kw) ||
              (n.ipLocation || '').toLowerCase().includes(kw);
          })
        : cachedNotes;

      if (notes.length === 0) {
        grid.innerHTML = '<div class="panel" style="grid-column:1/-1;"><div class="empty-state"><div class="empty-title">无匹配作品</div></div></div>';
        return;
      }

      grid.innerHTML = notes.map(function(n) {
        const cover = (n.localPhotoPaths && n.localPhotoPaths[0]) || n.coverUrl || '';
        const isDel = n.status === 'DELETED';
        const isSusp = n.status === 'SUSPECTED_DELETED';
        const isEdited = Boolean(n.lastEditedTimeText) || n.editCount > 0;
        const pubTime = n.verifiedTimeText || n.latestRenderedTimeText || fmtTime(n.firstSeenAt);
        const photoCnt = (n.localPhotoPaths || []).length;
        const badges = [];
        if (isDel) badges.push('<span class="pill danger" style="backdrop-filter:blur(6px);">已删</span>');
        else if (isSusp) badges.push('<span class="pill warn" style="backdrop-filter:blur(6px);">疑似隐藏</span>');
        if (isEdited) badges.push('<span class="pill warn" style="backdrop-filter:blur(6px);">已编辑</span>');
        if (!isDel && !isSusp && !n.isBaseline) badges.push('<span class="pill accent" style="backdrop-filter:blur(6px);">新帖</span>');
        const statusChip = badges.join(' ');

        return '<article class="note-card ' + (isDel ? 'deleted' : '') + '" tabindex="0" onclick="openNoteDetail(\\'' + esc(n.noteId) + '\\')" onkeydown="if(event.key===\\'Enter\\')openNoteDetail(\\'' + esc(n.noteId) + '\\')">' +
          '<div class="note-cover-wrap">' +
            (cover ? '<img class="note-cover" loading="lazy" src="' + esc(cover) + '" alt="" />' : '<div class="note-cover-empty">无封面</div>') +
            '<div class="note-cover-badges">' +
              '<span style="display:flex;gap:4px;flex-wrap:wrap;">' + statusChip + '</span>' +
              (photoCnt > 0 ? '<span class="photo-count-chip mono">' + photoCnt + ' 图</span>' : '') +
            '</div>' +
          '</div>' +
          '<div class="note-body">' +
            '<div class="note-title">' + esc(n.title || '（无标题）') + '</div>' +
            (isEdited ? '<div class="mono" style="font-size:11px;color:var(--warn);">编辑于 ' + esc(n.lastEditedTimeText) + '</div>' : '') +
            (isDel && n.estimatedDeleteWindow ? '<div style="font-size:11.5px;color:var(--danger);">' + esc(n.estimatedDeleteWindow) + '</div>' : '') +
            '<div class="note-meta">' +
              '<span class="mono" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(pubTime) + (n.ipLocation ? ' · ' + esc(n.ipLocation) : '') + '</span>' +
              '<span class="mono" style="flex-shrink:0;">♥ ' + esc(n.likedRaw) + ' · 💬 ' + esc(n.commentRaw) + '</span>' +
            '</div>' +
          '</div>' +
        '</article>';
      }).join('');
    }

    async function openNoteDetail(noteId) {
      const res = await fetch('/api/notes/' + encodeURIComponent(noteId)).then(function(r) { return r.json(); });
      if (!res.ok) return showToast(res.error || '未找到存档', 'danger');
      const n = res.note;
      const comments = res.comments || [];
      const revisions = res.revisions || [];
      const photos = n.localPhotoPaths || [];

      document.getElementById('drawerTitle').textContent = n.title || '（无标题）';
      const notePhotoKey = photos.length ? registerLightboxGroup(photos) : '';
      const photosHtml = notePhotoKey
        ? '<div class="thumb-row">' + photos.map(function(p, idx) {
            return '<img class="thumb-img" style="width:96px;height:96px;" src="' + esc(p) + '" alt="作品图片" onclick="openLightboxGroup(\\'' + notePhotoKey + '\\',' + idx + ')" />';
          }).join('') + '</div>'
        : '';

      const commsHtml = comments.length
        ? comments.map(function(c) {
            const cTime = c.verifiedTimeText || c.latestRenderedTimeText || fmtTime(c.firstSeenAt);
            const authorLabel = c.userRedId && !String(c.nickname).includes(c.userRedId)
              ? (c.nickname + ' (' + c.userRedId + ')')
              : c.nickname;
            const targetLabel = c.targetNickname
              ? (c.targetRedId && !String(c.targetNickname).includes(c.targetRedId)
                  ? (c.targetNickname + ' (' + c.targetRedId + ')')
                  : c.targetNickname)
              : '';
            const cPhotoKey = (c.localPhotoPaths || []).length ? registerLightboxGroup(c.localPhotoPaths) : '';
            const cPhotos = cPhotoKey
              ? '<div class="thumb-row">' + c.localPhotoPaths.map(function(p, idx) {
                  return '<img class="thumb-img" style="width:52px;height:52px;" src="' + esc(p) + '" alt="评论配图" onclick="openLightboxGroup(\\'' + cPhotoKey + '\\',' + idx + ')" />';
                }).join('') + '</div>'
              : '';
            return '<div class="comment-item">' +
              '<div class="comment-head">' +
                '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">' +
                  '<strong style="font-size:12.5px;">' + esc(authorLabel) + '</strong>' +
                  (c.ipLocation ? '<span class="pill">' + esc(c.ipLocation) + '</span>' : '') +
                  (c.status === 'DELETED' ? '<span class="pill danger">已删</span>' : '') +
                '</div>' +
                '<span class="mono" style="font-size:11px;color:var(--text-muted);">' + esc(cTime) + '</span>' +
              '</div>' +
              '<div style="font-size:12.5px;color:var(--text-secondary);">' + (targetLabel ? '<span style="color:var(--text-muted);">回复 @' + esc(targetLabel) + ' </span>' : '') + esc(c.content) + '</div>' +
              (c.status === 'DELETED' && c.estimatedDeleteWindow ? '<div style="font-size:11.5px;color:var(--danger);">' + esc(c.estimatedDeleteWindow) + '</div>' : '') +
              cPhotos +
            '</div>';
          }).join('')
        : '<div style="color:var(--text-muted);font-size:12.5px;padding:12px 0;">暂无评论</div>';

      const revisionsHtml = revisions.length
        ? '<div>' +
            '<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text-secondary);">' +
              '<span>编辑记录</span><span class="mono">' + revisions.length + '</span>' +
            '</div>' +
            revisions.map(function(rev) {
              const editAtLabel = rev.editedTimeText || rev.estimatedEditWindow || fmtTime(rev.changedAt);
              const textChanged = rev.oldTitle !== rev.newTitle || rev.oldDesc !== rev.newDesc;
              return '<div class="comment-item">' +
                '<div class="comment-head">' +
                  '<span class="pill warn"><span class="pill-dot"></span>编辑于 ' + esc(editAtLabel) + '</span>' +
                  '<span class="mono" style="font-size:11px;color:var(--text-muted);">捕获 ' + esc(fmtTime(rev.changedAt)) + '</span>' +
                '</div>' +
                (textChanged
                  ? '<div class="diff-grid">' +
                      '<pre class="diff-box before">' + esc((rev.oldTitle ? rev.oldTitle + '\\n' : '') + rev.oldDesc) + '</pre>' +
                      '<pre class="diff-box after">' + esc((rev.newTitle ? rev.newTitle + '\\n' : '') + rev.newDesc) + '</pre>' +
                    '</div>'
                  : '<div style="font-size:12px;color:var(--text-muted);">正文未变（配图、封面或标签更新）</div>') +
              '</div>';
            }).join('') +
          '</div>'
        : '';

      document.getElementById('drawerBody').innerHTML =
        (n.status === 'DELETED' ? '<div class="pill danger" style="align-self:flex-start;"><span class="pill-dot"></span>已删除 · ' + esc(n.estimatedDeleteWindow || '本地已保留') + '</div>' : '') +
        '<div class="drawer-meta-grid">' +
          '<div class="drawer-meta-item" style="cursor:pointer;" onclick="copyText(\\'' + esc(n.noteId) + '\\')" title="点击复制 ID"><div class="drawer-meta-lbl">笔记 ID</div><div class="drawer-meta-val mono">' + esc(n.noteId) + '</div></div>' +
          '<div class="drawer-meta-item"><div class="drawer-meta-lbl">发布时间</div><div class="drawer-meta-val mono">' + esc(n.verifiedTimeText || n.firstRenderedTimeText || '-') + '</div></div>' +
          (n.lastEditedTimeText ? '<div class="drawer-meta-item"><div class="drawer-meta-lbl">最后编辑</div><div class="drawer-meta-val mono" style="color:var(--warn);">' + esc(n.lastEditedTimeText) + '</div></div>' : '') +
          '<div class="drawer-meta-item"><div class="drawer-meta-lbl">IP 属地</div><div class="drawer-meta-val">' + esc(n.ipLocation || '-') + '</div></div>' +
          '<div class="drawer-meta-item"><div class="drawer-meta-lbl">互动</div><div class="drawer-meta-val mono">♥ ' + esc(n.likedRaw) + ' · ★ ' + esc(n.collectedRaw) + ' · 💬 ' + esc(n.commentRaw) + '</div></div>' +
        '</div>' +
        '<pre class="diff-box" style="margin-top:0;">' + esc(n.desc || '（无正文）') + '</pre>' +
        photosHtml +
        revisionsHtml +
        '<div>' +
          '<div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--border);font-size:12px;font-weight:600;color:var(--text-secondary);">' +
            '<span>评论存档</span><span class="mono">' + comments.length + '</span>' +
          '</div>' +
          commsHtml +
        '</div>';

      document.getElementById('noteDrawer').classList.remove('hidden');
    }

    function closeDrawer() {
      document.getElementById('noteDrawer').classList.add('hidden');
    }

    function copyText(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() { showToast('已复制 ' + text, 'ok'); });
      }
    }

    function openSingleLightbox(url) {
      if (!url) return;
      openLightbox([url], 0);
    }

    function openLightbox(urls, idx) {
      if (!urls || urls.length === 0) return;
      lightboxImages = urls;
      lightboxIndex = Math.max(0, Math.min(idx || 0, urls.length - 1));
      renderLightbox();
      document.getElementById('lightbox').classList.remove('hidden');
    }

    function renderLightbox() {
      const url = lightboxImages[lightboxIndex];
      document.getElementById('lightboxImg').src = url;
      document.getElementById('lightboxOpenRaw').href = url;
      const multi = lightboxImages.length > 1;
      document.getElementById('lightboxPrev').classList.toggle('hidden', !multi);
      document.getElementById('lightboxNext').classList.toggle('hidden', !multi);
      const cnt = document.getElementById('lightboxCounter');
      cnt.textContent = (lightboxIndex + 1) + ' / ' + lightboxImages.length;
      cnt.classList.toggle('hidden', !multi);
    }

    function stepLightbox(delta) {
      if (lightboxImages.length <= 1) return;
      lightboxIndex = (lightboxIndex + delta + lightboxImages.length) % lightboxImages.length;
      renderLightbox();
    }

    function closeLightbox() {
      document.getElementById('lightbox').classList.add('hidden');
    }

    async function runNow() {
      const res = await fetch('/api/actions/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(function(r) { return r.json(); });
      showToast(res.message || '已开始检查主页动态', 'ok');
      setTimeout(loadOverview, 500);
    }

    async function runFullScan() {
      const res = await fetch('/api/actions/run-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullScan: true })
      }).then(function(r) { return r.json(); });
      showToast(res.message || '已开始检查全部笔记', 'ok');
      setTimeout(loadOverview, 500);
    }

    async function runTodaySummary() {
      const btn = document.getElementById('todaySummaryBtn');
      const oldText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '汇总中...';
      try {
        const d = new Date();
        const p = function(n) { return String(n).padStart(2, '0'); };
        const fallbackToday = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        const todayKey = (currentState && currentState.todayKey) || fallbackToday;
        const res = await fetch('/api/daily-report/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dateKey: todayKey, refreshOnline: false })
        }).then(function(r) { return r.json(); });
        const dateInput = document.getElementById('reportDateInput');
        if (dateInput) dateInput.value = todayKey;
        switchTab('midnight');
        await loadDailyReport();
        loadOverview();
        showToast(res.ok ? '当天汇总已更新' : (res.message || '汇总失败'), res.ok ? 'ok' : 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }

    async function togglePause() {
      const isPaused = currentState && currentState.status && currentState.status.mode && currentState.status.mode.startsWith('PAUSED');
      await fetch(isPaused ? '/api/actions/resume' : '/api/actions/pause', { method: 'POST' });
      showToast(isPaused ? '已继续定时监控' : '已暂停定时监控', isPaused ? 'ok' : 'warn');
      loadOverview();
    }

    async function openLogin() {
      const res = await fetch('/api/actions/login', { method: 'POST' }).then(function(r) { return r.json(); });
      showToast(res.message || '正在打开登录窗口', 'ok');
      loadOverview();
    }

    async function handleSaveSettingsClick() {
      const nextUrl = document.getElementById('cfg_targetProfileUrl').value.trim();
      const prevUrl = (currentState && currentState.config && currentState.config.targetProfileUrl) || '';
      const extractUid = function(u) {
        const m = String(u || '').match(/\\/user\\/profile\\/([a-zA-Z0-9_-]+)/);
        return m ? m[1] : '';
      };
      if (prevUrl && nextUrl && extractUid(prevUrl) && extractUid(nextUrl) && extractUid(prevUrl) !== extractUid(nextUrl)) {
        const confirmed = await askConfirm(
          '切换监控目标账号？',
          '切换后会保留原账号本地备份，并立即对新目标重新备份全部笔记、图片与评论。',
          '确认切换'
        );
        if (!confirmed) return;
      }
      await saveSettings();
    }

    async function saveSettings() {
      const btn = document.getElementById('saveSettingsBtn');
      btn.disabled = true;
      try {
        const payload = {
          targetProfileUrl: document.getElementById('cfg_targetProfileUrl').value.trim(),
          targetRemark: document.getElementById('cfg_targetRemark').value.trim(),
          lightCheckMinMinutes: Number(document.getElementById('cfg_lightCheckMinMinutes').value),
          lightCheckMaxMinutes: Number(document.getElementById('cfg_lightCheckMaxMinutes').value),
          fullScanMinMinutes: Number(document.getElementById('cfg_fullScanMinMinutes').value),
          fullScanMaxMinutes: Number(document.getElementById('cfg_fullScanMaxMinutes').value),
          burstMinMinutes: Number(document.getElementById('cfg_burstMinMinutes').value),
          burstMaxMinutes: Number(document.getElementById('cfg_burstMaxMinutes').value),
          burstQuietChecksToRecover: Number(document.getElementById('cfg_burstQuietChecksToRecover').value),
          burstExtraRecentNotes: Number(document.getElementById('cfg_burstExtraRecentNotes').value),
          likeChangeTriggersBurst: document.getElementById('cfg_likeChangeTriggersBurst').value === 'true',
          nextDaySummaryTime: document.getElementById('cfg_nextDaySummaryTime').value.trim(),
          barkKey: document.getElementById('cfg_barkKey').value.trim(),
          qqMailUser: document.getElementById('cfg_qqMailUser').value.trim(),
          qqMailAuthCode: document.getElementById('cfg_qqMailAuthCode').value.trim(),
          chromeExecutablePath: document.getElementById('cfg_chromeExecutablePath').value.trim(),
          headless: document.getElementById('cfg_headless').value === 'true'
        };
        const res = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).then(function(r) { return r.json(); });
        if (res.ok) {
          cachedNotes = [];
          lastAutoTriggeredTarget = '';
          showToast('配置已保存', 'ok');
          loadOverview();
        } else {
          showToast('保存失败', 'danger');
        }
      } finally {
        btn.disabled = false;
      }
    }

    async function testBark() {
      const btn = document.getElementById('testBarkBtn');
      btn.disabled = true;
      try {
        const currentBarkInput = document.getElementById('cfg_barkKey').value.trim();
        if (currentBarkInput) {
          const cfgRes = await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ barkKey: currentBarkInput })
          }).then(function(r) { return r.json(); });
          if (cfgRes.ok && cfgRes.config) {
            document.getElementById('cfg_barkKey').value = cfgRes.config.barkKey || '';
          }
        }
        const res = await fetch('/api/actions/test-bark', { method: 'POST' }).then(function(r) { return r.json(); });
        showToast(res.ok ? 'Bark 测试推送成功' : '推送失败：' + (res.errors || []).join('; '), res.ok ? 'ok' : 'danger');
      } finally {
        btn.disabled = false;
      }
    }

    async function testQqMail() {
      const btn = document.getElementById('testQqMailBtn');
      btn.disabled = true;
      try {
        const qqMailUser = document.getElementById('cfg_qqMailUser').value.trim();
        const qqMailAuthCode = document.getElementById('cfg_qqMailAuthCode').value.trim();
        if (!qqMailUser || !qqMailAuthCode) {
          showToast('请先填写 QQ 邮箱地址与 16 位授权码', 'warn');
          return;
        }
        const cfgRes = await fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ qqMailUser, qqMailAuthCode })
        }).then(function(r) { return r.json(); });
        if (cfgRes.ok && cfgRes.config) {
          document.getElementById('cfg_qqMailUser').value = cfgRes.config.qqMailUser || '';
          document.getElementById('cfg_qqMailAuthCode').value = cfgRes.config.qqMailAuthCode || '';
        }
        const res = await fetch('/api/actions/test-qq-mail', { method: 'POST' }).then(function(r) { return r.json(); });
        showToast(res.ok ? 'QQ 邮箱测试邮件已发送' : '发送失败：' + (res.errors || []).join('; '), res.ok ? 'ok' : 'danger');
      } finally {
        btn.disabled = false;
      }
    }

    // Floating Tooltip Portal (immune to .panel overflow:hidden and viewport edges)
    let activeTipEl = null;
    function showFloatingTip(el) {
      const box = document.getElementById('floatingTip');
      const text = el && el.getAttribute('data-tip');
      if (!box || !text) return hideFloatingTip();
      activeTipEl = el;
      box.textContent = text;
      box.style.left = '-9999px';
      box.style.top = '-9999px';
      box.classList.add('visible');
      const rect = el.getBoundingClientRect();
      const bw = box.offsetWidth || 220;
      const bh = box.offsetHeight || 36;
      const pad = 12;
      let left = rect.left + rect.width / 2 - bw / 2;
      if (left < pad) left = pad;
      if (left + bw > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - pad - bw);
      let top = rect.bottom + 8;
      if (top + bh > window.innerHeight - pad) {
        top = Math.max(pad, rect.top - bh - 8);
      }
      box.style.left = Math.round(left) + 'px';
      box.style.top = Math.round(top) + 'px';
    }
    function hideFloatingTip() {
      activeTipEl = null;
      const box = document.getElementById('floatingTip');
      if (box) box.classList.remove('visible');
    }
    document.addEventListener('mouseover', function(e) {
      const tip = e.target && e.target.closest ? e.target.closest('.info-tip') : null;
      if (tip) showFloatingTip(tip);
    });
    document.addEventListener('mouseout', function(e) {
      if (!activeTipEl) return;
      const related = e.relatedTarget;
      if (!related || !activeTipEl.contains(related)) {
        const nextTip = related && related.closest ? related.closest('.info-tip') : null;
        if (nextTip) showFloatingTip(nextTip);
        else hideFloatingTip();
      }
    });
    document.addEventListener('focusin', function(e) {
      const tip = e.target && e.target.closest ? e.target.closest('.info-tip') : null;
      if (tip) showFloatingTip(tip);
    });
    document.addEventListener('focusout', function(e) {
      if (activeTipEl && e.target === activeTipEl) hideFloatingTip();
    });
    window.addEventListener('scroll', hideFloatingTip, true);
    window.addEventListener('resize', hideFloatingTip);

    // Global Keyboard Shortcuts (Linear style)
    document.addEventListener('keydown', function(e) {
      const tag = (e.target && e.target.tagName) || '';
      const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape') {
        if (!document.getElementById('lightbox').classList.contains('hidden')) return closeLightbox();
        if (!document.getElementById('confirmDialog').classList.contains('hidden')) return closeConfirm(false);
        if (!document.getElementById('noteDrawer').classList.contains('hidden')) return closeDrawer();
        return;
      }
      if (!document.getElementById('lightbox').classList.contains('hidden')) {
        if (e.key === 'ArrowLeft') stepLightbox(-1);
        if (e.key === 'ArrowRight') stepLightbox(1);
        return;
      }
      if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === '1') switchTab('overview');
      else if (e.key === '2') switchTab('comparisons');
      else if (e.key === '3') switchTab('midnight');
      else if (e.key === '4') switchTab('archive');
      else if (e.key === '5') switchTab('settings');
      else if (e.key === '/' && activeTab === 'archive' && activeArchiveSub === 'notes') {
        e.preventDefault();
        document.getElementById('archiveSearchInput').focus();
      }
    });

    function handleInitialHash() {
      const h = location.hash || '';
      if (h === '#daily') {
        switchTab('midnight');
      } else if (h.startsWith('#note-') && h.length > 6) {
        openNoteDetail(h.slice(6));
      }
    }

    initTheme();
    loadOverview();
    handleInitialHash();
    setInterval(loadOverview, 4000);
    setInterval(tickCountdown, 1000);
  </script>
</body>
</html>`;
}
