import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { brandIdentityScript } from "./layout.js";

interface TotpSetupPageProps {
	secret: string;
	otpauthUri: string;
	error?: string;
	csrfToken?: string;
}

// Paw "control-room" TOTP setup — violet accent, Geist, near-black hero.
// Standalone page: tokens are inlined since it doesn't load the app shell.
const totpCss = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  :root {
    --bg-0: #08090b; --bg-1: #0e0f13; --bg-2: #15161b;
    --border: #23252c; --border-strong: #313440;
    --text-0: #f4f5f7; --text-1: #a6abb5; --text-2: #6b7079; --text-3: #474b53;
    --accent: #7458f5; --accent-hover: #876ef8; --accent-press: #6446e8;
    --accent-bright: #a78bfa; --accent-soft: rgba(116,88,245,.15); --accent-line: rgba(116,88,245,.35);
    --danger: #f87171;
    --font-sans: "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --font-mono: "Geist Mono", "SF Mono", "Fira Code", ui-monospace, monospace;
  }
  body {
    font-family: var(--font-sans);
    background: var(--bg-0);
    color: var(--text-0);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
    position: relative;
    overflow: hidden;
  }
  body::before {
    content: '';
    position: absolute;
    top: 40%; left: 50%;
    width: 720px; height: 720px;
    background: radial-gradient(circle, var(--accent-soft) 0%, rgba(8,9,11,0) 68%);
    transform: translate(-50%, -50%);
    filter: blur(14px);
    z-index: 0; pointer-events: none;
  }
  .setup-card {
    position: relative; z-index: 1;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 40px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 24px 60px -12px rgba(0,0,0,.7);
  }
  .setup-header {
    text-align: center;
    margin-bottom: 24px;
  }
  .setup-header h1 { font-size: 21px; font-weight: 600; letter-spacing: -.03em; margin: 0 0 8px; color: var(--text-0); }
  .setup-header p { font-size: 14px; color: var(--text-1); margin: 0; line-height: 1.5; }
  .secret-box {
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: 9px;
    padding: 14px;
    margin: 20px 0;
    text-align: center;
  }
  .secret-label {
    font-family: var(--font-mono);
    font-size: 10.5px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--text-2);
    margin-bottom: 8px;
  }
  .secret-value {
    font-family: var(--font-mono);
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.1em;
    word-break: break-all;
    color: var(--accent-bright);
  }
  .uri-box {
    margin: 12px 0 20px;
    font-size: 12px;
    color: var(--text-2);
    word-break: break-all;
  }
  .uri-box code {
    background: var(--bg-2);
    padding: 2px 5px;
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-1);
  }
  .form-group { margin-bottom: 16px; }
  .form-group label {
    display: block;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: .08em;
    text-transform: uppercase;
    font-weight: 500;
    color: var(--text-2);
    margin-bottom: 7px;
  }
  .form-group input {
    width: 100%;
    padding: 11px 14px;
    border: 1px solid var(--border);
    border-radius: 9px;
    font-size: 14px;
    font-family: inherit;
    color: var(--text-0);
    background: var(--bg-2);
    outline: none;
    transition: border-color .16s, box-shadow .16s, background .16s;
  }
  .form-group input::placeholder { color: var(--text-3); }
  .form-group input:focus {
    border-color: var(--accent-line);
    box-shadow: 0 0 0 3px var(--accent-soft);
    background: var(--bg-1);
  }
  .setup-btn {
    width: 100%;
    padding: 11px;
    background: var(--accent);
    color: #fff;
    border: 1px solid transparent;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -.01em;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 1px 0 rgba(255,255,255,.12) inset;
    transition: all .16s cubic-bezier(.22,.61,.36,1);
  }
  .setup-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 0 0 1px var(--accent-line), 0 10px 40px -8px rgba(116,88,245,.45);
  }
  .setup-btn:active { background: var(--accent-press); transform: translateY(0); }
  .skip-link {
    display: block;
    text-align: center;
    margin-top: 16px;
    font-size: 13px;
    color: var(--text-2);
    text-decoration: none;
    transition: color .16s;
  }
  .skip-link:hover { color: var(--accent-bright); }
  .error-msg {
    background: rgba(248,113,113,.14);
    color: var(--danger);
    padding: 10px 14px;
    border-radius: 9px;
    font-size: 13px;
    margin-bottom: 16px;
    border: 1px solid rgba(248,113,113,.3);
  }
  .setup-footer {
    text-align: center;
    margin-top: 24px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: .04em;
    color: var(--text-2);
  }
`;

export const TotpSetupPage: FC<TotpSetupPageProps> = ({
	secret,
	otpauthUri,
	error,
	csrfToken,
}) => (
	<html lang="en">
		<head>
			<meta charset="UTF-8" />
			<meta name="viewport" content="width=device-width, initial-scale=1.0" />
			{raw(
				`<link rel="icon" id="favicon" type="image/png" href="/favicon.png" />`,
			)}
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			{raw(
				`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
			)}
			<link
				href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&family=Geist+Mono:wght@400;500&display=swap"
				rel="stylesheet"
			/>
			<title>TOTP Setup - Paw</title>
			{raw(`<style>${totpCss}</style>`)}
			{raw(`<link rel="stylesheet" href="/api/brand/theme.css">`)}
			{raw(`<script>${brandIdentityScript()}</script>`)}
		</head>
		<body>
			<div class="setup-card">
				<div class="setup-header">
					<h1>Set Up Two-Factor Authentication</h1>
					<p>
						Add this account to your authenticator app (Google Authenticator,
						Authy, 1Password, etc.) using the secret below.
					</p>
				</div>

				{error && <div class="error-msg">{error}</div>}

				<div class="secret-box">
					<div class="secret-label">Your Secret Key</div>
					<div class="secret-value">{secret}</div>
				</div>

				<div class="uri-box">
					Or use this URI: <code>{otpauthUri}</code>
				</div>

				<form method="POST" action="/login/totp-setup">
					{csrfToken && <input type="hidden" name="_csrf" value={csrfToken} />}

					<div class="form-group">
						<label for="code">
							Enter the 6-digit code from your app to verify
						</label>
						<input
							type="text"
							id="code"
							name="code"
							inputMode="numeric"
							pattern="[0-9]{6}"
							maxLength={6}
							placeholder="000000"
							required
							autocomplete="one-time-code"
							autofocus
						/>
					</div>

					<button type="submit" class="setup-btn">
						Verify &amp; Enable TOTP
					</button>
				</form>

				<a href="/" class="skip-link">
					Skip for now
				</a>

				<div class="setup-footer">
					You can always set up TOTP later from the settings.
				</div>
			</div>
		</body>
	</html>
);
