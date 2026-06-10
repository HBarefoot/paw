import { raw } from "hono/html";
import type { FC } from "hono/jsx";
import { brandIdentityScript, pawMark } from "./layout.js";

interface LoginPageProps {
	error?: string;
	requireTotp?: boolean;
	csrfToken?: string;
	setupMode?: boolean;
}

// Paw "control-room" login — violet accent, Geist type, near-black hero.
// Standalone page: tokens are inlined since it doesn't load the app shell.
const loginCss = `
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
    overflow: hidden;
    position: relative;
  }
  body::before {
    content: '';
    position: absolute;
    top: 42%;
    left: 50%;
    width: 760px;
    height: 760px;
    background: radial-gradient(circle, var(--accent-soft) 0%, rgba(8,9,11,0) 68%);
    transform: translate(-50%, -50%);
    filter: blur(14px);
    z-index: 0;
    pointer-events: none;
  }
  .login-card {
    position: relative;
    z-index: 1;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 18px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 24px 60px -12px rgba(0,0,0,.7);
  }
  .login-header {
    text-align: center;
    margin-bottom: 30px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .app-icon {
    width: 60px; height: 60px;
    display: grid; place-items: center;
    border-radius: 28%;
    background: linear-gradient(150deg, var(--accent-bright), var(--accent) 55%, var(--accent-press));
    color: #fff;
    box-shadow: 0 8px 24px -6px rgba(116,88,245,.5), inset 0 1px 0 rgba(255,255,255,.25);
    margin-bottom: 18px;
    position: relative; overflow: hidden;
  }
  .app-icon::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 80% at 30% 10%, rgba(255,255,255,.35), transparent 50%);
  }
  .paw { display: block; }
  .paw path, .paw ellipse { fill: currentColor; }
  .login-header h1 { font-size: 23px; font-weight: 600; letter-spacing: -.03em; margin: 0 0 8px; color: var(--text-0); }
  .login-header p { font-size: 14px; color: var(--text-1); margin: 0; }
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
  .login-btn {
    width: 100%;
    padding: 12px;
    background: var(--accent);
    color: #fff;
    border: 1px solid transparent;
    border-radius: 9px;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: -.01em;
    cursor: pointer;
    font-family: inherit;
    margin-top: 18px;
    box-shadow: 0 1px 0 rgba(255,255,255,.12) inset;
    transition: all .16s cubic-bezier(.22,.61,.36,1);
  }
  .login-btn:hover {
    background: var(--accent-hover);
    transform: translateY(-1px);
    box-shadow: 0 0 0 1px var(--accent-line), 0 10px 40px -8px rgba(116,88,245,.45);
  }
  .login-btn:active {
    background: var(--accent-press);
    transform: translateY(0);
  }
  .error-msg {
    background: rgba(248,113,113,.14);
    color: var(--danger);
    padding: 11px 14px;
    border-radius: 9px;
    font-size: 13px;
    margin-bottom: 18px;
    border: 1px solid rgba(248,113,113,.3);
  }
  .login-footer {
    text-align: center;
    margin-top: 28px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: .04em;
    color: var(--text-2);
  }
  .setup-note {
    background: var(--accent-soft);
    border: 1px solid var(--accent-line);
    border-radius: 9px;
    padding: 13px 15px;
    font-size: 13px;
    color: var(--text-1);
    margin-bottom: 22px;
    line-height: 1.6;
  }
  .setup-note code {
    background: rgba(116,88,245,.2);
    padding: 2px 6px;
    border-radius: 5px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent-bright);
  }
`;

export const LoginPage: FC<LoginPageProps> = ({
	error,
	requireTotp,
	csrfToken,
	setupMode,
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
			<title>{setupMode ? "Setup" : "Login"} - Paw</title>
			{raw(`<style>${loginCss}</style>`)}
			{raw(`<link rel="stylesheet" href="/api/brand/theme.css">`)}
			{raw(`<script>${brandIdentityScript()}</script>`)}
		</head>
		<body>
			<div class="login-card">
				<div class="login-header">
					{raw(`<div class="app-icon">${pawMark(33)}</div>`)}
					{raw(
						`<img class="app-logo" data-brand-logo alt="" style="display:none;height:44px;max-width:200px;object-fit:contain;">`,
					)}
					{setupMode ? (
						<>
							<h1>Create Admin Account</h1>
							<p>Set up your first admin to secure the web UI</p>
						</>
					) : (
						<>
							<h1>
								Sign in to <span data-brand-name="">Paw</span>
							</h1>
							<p>Enter your credentials to continue</p>
						</>
					)}
				</div>

				{error && <div class="error-msg">{error}</div>}

				{setupMode && (
					<div class="setup-note">
						You can also create an admin from the terminal:
						<br />
						<code>paw auth web</code>
					</div>
				)}

				<form method="post" action={setupMode ? "/login/setup" : "/login"}>
					{csrfToken && <input type="hidden" name="_csrf" value={csrfToken} />}

					<div class="form-group">
						<label for="username">Username</label>
						<input
							type="text"
							id="username"
							name="username"
							required
							autocomplete="username"
							placeholder="admin"
							autofocus
						/>
					</div>

					<div class="form-group">
						<label for="password">
							Password{setupMode ? " (min 8 characters)" : ""}
						</label>
						<input
							type="password"
							id="password"
							name="password"
							required
							minLength={setupMode ? 8 : undefined}
							autocomplete={setupMode ? "new-password" : "current-password"}
						/>
					</div>

					{setupMode && (
						<div class="form-group">
							<label for="confirm_password">Confirm Password</label>
							<input
								type="password"
								id="confirm_password"
								name="confirm_password"
								required
								minLength={8}
								autocomplete="new-password"
							/>
						</div>
					)}

					{requireTotp && (
						<div class="form-group">
							<label for="totp">Authenticator Code</label>
							<input
								type="text"
								id="totp"
								name="totp"
								inputMode="numeric"
								pattern="[0-9]{6}"
								maxLength={6}
								placeholder="000000"
								autocomplete="one-time-code"
							/>
						</div>
					)}

					<button type="submit" class="login-btn">
						{setupMode ? "Create Account" : "Sign in"}
					</button>
				</form>

				<div class="login-footer">Paw v0.1.0</div>
			</div>
		</body>
	</html>
);
