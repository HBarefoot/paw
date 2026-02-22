import { raw } from "hono/html";
import type { FC } from "hono/jsx";

interface LoginPageProps {
	error?: string;
	requireTotp?: boolean;
	csrfToken?: string;
	setupMode?: boolean;
}

const loginCss = `
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
    .login-card { background: #131316; border-color: #27272a; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.4); }
    .login-header h1 { color: #f4f4f5; }
    .login-header p { color: #a1a1aa; }
    .form-group label { color: #d4d4d8; }
    input { background: #1e1e22; border-color: #3f3f46; color: #f4f4f5; }
    input::placeholder { color: #71717a; }
    input:focus { border-color: #818cf8; box-shadow: 0 0 0 3px rgba(99,102,241,0.2); }
    .error-msg { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); }
    .login-footer { color: #71717a; }
    .setup-note { background: rgba(99,102,241,0.1); border-color: rgba(99,102,241,0.2); color: #c4b5fd; }
    .setup-note code { background: rgba(99,102,241,0.15); color: #e0e7ff; }
  }
  .login-card {
    background: #ffffff;
    border: 1px solid #e2e4e9;
    border-radius: 12px;
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 4px 6px -1px rgba(0,0,0,0.07), 0 2px 4px -2px rgba(0,0,0,0.05);
  }
  .login-header {
    text-align: center;
    margin-bottom: 32px;
  }
  .login-logo {
    width: 48px;
    height: 48px;
    border-radius: 12px;
    margin-bottom: 16px;
    object-fit: cover;
  }
  .login-header h1 { font-size: 22px; font-weight: 600; margin: 0 0 4px; color: #111827; }
  .login-header p { font-size: 14px; color: #4b5563; margin: 0; }
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
  .login-btn {
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
    margin-top: 8px;
  }
  .login-btn:hover { opacity: 0.9; }
  .error-msg {
    background: rgba(239,68,68,0.1);
    color: #ef4444;
    padding: 10px 14px;
    border-radius: 8px;
    font-size: 13px;
    margin-bottom: 16px;
    border: 1px solid rgba(239,68,68,0.2);
  }
  .login-footer {
    text-align: center;
    margin-top: 24px;
    font-size: 12px;
    color: #6b7280;
  }
  .setup-note {
    background: #eef2ff;
    border: 1px solid #c7d2fe;
    border-radius: 8px;
    padding: 12px 14px;
    font-size: 13px;
    color: #4338ca;
    margin-bottom: 20px;
    line-height: 1.5;
  }
  .setup-note code {
    background: rgba(99,102,241,0.1);
    padding: 1px 5px;
    border-radius: 4px;
    font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
    font-size: 12px;
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
			<link rel="preconnect" href="https://fonts.googleapis.com" />
			{raw(
				`<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`,
			)}
			<link
				href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
				rel="stylesheet"
			/>
			<title>{setupMode ? "Setup" : "Login"} - Paw</title>
			{raw(`<style>${loginCss}</style>`)}
		</head>
		<body>
			<div class="login-card">
				<div class="login-header">
					<img src="/paw-logo.jpg" class="login-logo" alt="Paw" />
					{setupMode ? (
						<>
							<h1>Create Admin Account</h1>
							<p>Set up your first admin to secure the web UI</p>
						</>
					) : (
						<>
							<h1>Sign in to Paw</h1>
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

				<form method="POST" action={setupMode ? "/login/setup" : "/login"}>
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
