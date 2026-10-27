// Self-contained HTML pages in the app's visual style (tokens from src/index.css).

export const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The app mark: a decision branching into options, on the app's indigo→blue gradient. */
export const ICON = `<div class="icon" aria-hidden="true"><svg width="40" height="40" viewBox="2.5 2.5 29 29" fill="none">
<path d="M9 17h5.5c2.2 0 3-1.2 3.9-3.4l.9-2.2c.9-2.2 1.7-3.4 3.9-3.4H25M14.5 17H25M14.5 17c2.2 0 3 1.2 3.9 3.4l.9 2.2c.9 2.2 1.7 3.4 3.9 3.4H25" stroke="#fff" stroke-opacity=".9" stroke-width="2" stroke-linecap="round"/>
<circle cx="8" cy="17" r="3.6" fill="#fff"/><circle cx="26" cy="8" r="2.8" fill="#fff"/><circle cx="26" cy="17" r="2.8" fill="#fff"/><circle cx="26" cy="26" r="2.8" fill="#fff"/>
</svg></div>`;

export const GOOGLE_MARK = `<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
<path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
<path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
<path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
<path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
</svg>`;

const CSS = `
:root {
  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Inter', system-ui, sans-serif;
  --bg: #f5f5f7; --card: #ffffff; --card-border: rgba(0,0,0,.06);
  --text: #1d1d1f; --text-2: #6e6e73; --text-3: #a1a1a6;
  --fill: rgba(118,118,128,.1); --fill-2: rgba(118,118,128,.16);
  --shadow-card: 0 .5px 1px rgba(0,0,0,.04), 0 2px 6px rgba(0,0,0,.04), 0 10px 28px -8px rgba(0,0,0,.08);
  --shadow-hover: 0 1px 2px rgba(0,0,0,.05), 0 6px 14px rgba(0,0,0,.06), 0 20px 44px -12px rgba(0,0,0,.14);
  --shadow-float: 0 1px 1px rgba(0,0,0,.03), 0 8px 24px rgba(0,0,0,.08), 0 24px 60px -20px rgba(0,0,0,.16);
  --problem: #5856d6; --option: #007aff; --pro: #34c759; --con: #ff3b30; --risk: #ff9500;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0c0c0e; --card: #1c1c1e; --card-border: rgba(255,255,255,.07);
    --text: #f5f5f7; --text-2: #98989f; --text-3: #636366;
    --fill: rgba(118,118,128,.2); --fill-2: rgba(118,118,128,.3);
    --shadow-card: 0 0 0 .5px rgba(0,0,0,.4), 0 2px 6px rgba(0,0,0,.3), 0 12px 30px -8px rgba(0,0,0,.5);
    --shadow-hover: 0 0 0 .5px rgba(0,0,0,.4), 0 6px 16px rgba(0,0,0,.35), 0 22px 48px -12px rgba(0,0,0,.6);
    --shadow-float: 0 0 0 .5px rgba(0,0,0,.5), 0 10px 30px rgba(0,0,0,.4), 0 28px 70px -20px rgba(0,0,0,.7);
    --problem: #5e5ce6; --option: #0a84ff; --pro: #30d158; --con: #ff453a; --risk: #ff9f0a;
    color-scheme: dark;
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; }
body {
  font-family: var(--font); background: var(--bg); color: var(--text);
  -webkit-font-smoothing: antialiased; display: grid; place-items: center;
  min-height: 100vh; min-height: 100dvh; padding: 24px 16px;
}
.card {
  width: 100%; max-width: 400px; background: var(--card); border: .5px solid var(--card-border);
  border-radius: 22px; box-shadow: var(--shadow-float); padding: 36px 32px 26px; text-align: center;
}
.icon {
  width: 64px; height: 64px; margin: 0 auto 20px; border-radius: 15px; display: grid; place-items: center;
  background: linear-gradient(140deg, #6e6cf0, #007aff);
  box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 8px 20px -6px rgba(0,98,255,.45);
}
h1 { margin: 0 0 8px; font-size: 22px; line-height: 1.22; font-weight: 700; letter-spacing: -.022em; text-wrap: balance; }
.lead { margin: 0 0 22px; font-size: 15px; line-height: 1.45; color: var(--text-2); text-wrap: pretty; }
.lead:last-child { margin-bottom: 6px; }
.lead a { color: var(--option); text-decoration: none; }
.lead code { font: 500 13px ui-monospace, 'SF Mono', Menlo, monospace; background: var(--fill); padding: 2px 6px; border-radius: 6px; color: var(--text); word-break: break-all; }
.facts {
  list-style: none; margin: 0 0 22px; padding: 4px 16px; text-align: left;
  background: var(--fill); border-radius: 14px;
}
.facts li { display: flex; gap: 11px; align-items: baseline; padding: 10px 0; font-size: 13.5px; line-height: 1.4; color: var(--text-2); }
.facts li + li { border-top: .5px solid var(--fill-2); }
.facts b { color: var(--text); font-weight: 600; word-break: break-all; }
.dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--problem); transform: translateY(-1px); }
.facts li:nth-child(2) .dot { background: var(--option); }
.facts li:nth-child(3) .dot { background: var(--pro); }
.warn {
  margin: -8px 0 18px; padding: 10px 14px; border-radius: 12px; text-align: left; font-size: 13px; line-height: 1.4;
  color: var(--text); background: color-mix(in srgb, var(--risk) 14%, transparent);
}
.google-btn {
  display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%; height: 46px;
  border-radius: 12px; font: 600 15px var(--font); color: var(--text); background: var(--card);
  border: 1px solid var(--card-border); box-shadow: var(--shadow-card); cursor: pointer;
  transition: transform 140ms ease, box-shadow 200ms ease, opacity 200ms ease;
}
@media (prefers-color-scheme: dark) { .google-btn { background: #2c2c2e; } }
.google-btn:hover { box-shadow: var(--shadow-hover); }
.google-btn:active { transform: scale(.98); }
.google-btn:focus-visible { outline: 3px solid color-mix(in srgb, var(--option) 50%, transparent); outline-offset: 2px; }
.google-btn:disabled { cursor: default; opacity: .6; }
.msg { margin: 12px 0 0; font-size: 13px; line-height: 1.4; color: var(--text-2); }
.msg:empty { margin: 0; }
.msg.err { color: var(--con); }
.msg.ok { color: var(--pro); }
.foot { margin: 16px 0 0; font-size: 12px; line-height: 1.4; color: var(--text-3); }
@media (max-width: 420px) { .card { padding: 30px 22px 22px; border-radius: 20px; } h1 { font-size: 20px; } }
`;

export function page({ nonce, title, body }: { nonce: string; title: string; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}
