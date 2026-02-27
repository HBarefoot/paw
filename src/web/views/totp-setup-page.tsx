import { raw } from "hono/html";
import type { FC } from "hono/jsx";

interface TotpSetupPageProps {
	secret: string;
	otpauthUri: string;
	error?: string;
	csrfToken?: string;
}

const totpCss = `
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #f8f9fb;
    color: #111827;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #09090b; color: #f4f4f5; }
    .setup-card { background: #131316; border-color: #27272a; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4); }
    .setup-header h1 { color: #f4f4f5; }
    .setup-header p { color: #a1a1aa; }
    .form-group label { color: #d4d4d8; }
    input { background: #1e1e22; border-color: #3f3f46; color: #f4f4f5; }
    input::placeholder { color: #71717a; }
    input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(99,102,241,0.2); }
    .secret-box { background: #1e1e22; border-color: #3f3f46; }
    .secret-label { color: #a1a1aa; }
    .secret-value { color: #f4f4f5; }
    .uri-box { color: #a1a1aa; }
    .uri-box code { background: #27272a; color: #d4d4d8; }
    .skip-link { color: #a1a1aa; }
    .skip-link:hover { color: #818cf8; }
    .error-msg { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); }
    .setup-footer { color: #71717a; }
  }
  .setup-card {
    background: #ffffff;
    border: 1px solid #e2e4e9;
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 440px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07);
  }
  .setup-header {
    text-align: center;
    margin-bottom: 24px;
  }
  .setup-header h1 { font-size: 20px; font-weight: 600; margin: 0 0 8px; color: #111827; }
  .setup-header p { font-size: 14px; color: #4b5563; margin: 0; line-height: 1.5; }
  .secret-box {
    background: #f8f9fb;
    border: 1px solid #e2e4e9;
    border-radius: 8px;
    padding: 14px;
    margin: 20px 0;
    text-align: center;
  }
  .secret-label {
    font-size: 11px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #4b5563;
    margin-bottom: 8px;
  }
  .secret-value {
    font-family: "JetBrains Mono", monospace;
    font-size: 16px;
    font-weight: 500;
    letter-spacing: 0.1em;
    word-break: break-all;
    color: #111827;
  }
  .uri-box {
    margin: 12px 0 20px;
    font-size: 12px;
    color: #4b5563;
    word-break: break-all;
  }
  .uri-box code {
    background: #f0f2f5;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 11px;
    color: #374151;
  }
  .form-group { margin-bottom: 16px; }
  .form-group label {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: #374151;
    margin-bottom: 6px;
  }
  .form-group input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 14px;
    font-family: inherit;
    color: #111827;
    background: #ffffff;
    outline: none;
    transition: border-color 150ms, box-shadow 150ms;
  }
  .form-group input::placeholder { color: #9ca3af; }
  .form-group input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.1);
  }
  .setup-btn {
    width: 100%;
    padding: 10px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    color: white;
    border: none;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
  }
  .setup-btn:hover { opacity: 0.9; }
  .skip-link {
    display: block;
    text-align: center;
    margin-top: 16px;
    font-size: 13px;
    color: #4b5563;
    text-decoration: none;
  }
  .skip-link:hover { color: #6366f1; }
  .error-msg {
    background: rgba(239,68,68,0.1);
    color: #ef4444;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 16px;
    border: 1px solid rgba(239,68,68,0.2);
  }
  .setup-footer {
    text-align: center;
    margin-top: 24px;
    font-size: 12px;
    color: #6b7280;
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
			<link rel="icon" type="image/png" href="/favicon.png" />
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			{raw(
				`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
			)}
			<link
				href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap"
				rel="stylesheet"
			/>
			<title>TOTP Setup - Paw</title>
			{raw(`<style>${totpCss}</style>`)}
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
