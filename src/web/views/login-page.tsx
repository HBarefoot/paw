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
    background: #0a1628;
    color: #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    overflow: hidden; /* Prevent scrollbars from glow */
    position: relative;
  }
  body::before {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    width: 600px;
    height: 600px;
    background: radial-gradient(circle, rgba(37,148,208,0.18) 0%, rgba(10,22,40,0) 70%);
    transform: translate(-50%, -50%);
    border-radius: 50%;
    z-index: 0;
    pointer-events: none;
  }
  @media (prefers-color-scheme: dark) {
    /* Dark mode styles are mostly covered by the new default, but ensure consistency */
    body { background: #0a1628; color: #e2e8f0; }
    .login-card { background: rgba(255, 255, 255, 0.05); border-color: rgba(255, 255, 255, 0.1); box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .login-header h1 { color: #e0e7ff; }
    .login-header p { color: #a7b5e0; }
    .form-group label { color: #c3d0f0; }
    input { background: rgba(255, 255, 255, 0.1); border-color: rgba(255, 255, 255, 0.2); color: #e0e7ff; }
    input::placeholder { color: #8c9ccf; }
    input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99,102,241,0.3); }
    .error-msg { background: rgba(239,68,68,0.2); border-color: rgba(239,68,68,0.4); color: #fca5a5; }
    .login-footer { color: #8c9ccf; }
    .setup-note { background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.3); color: #c3d0f0; }
    .setup-note code { background: rgba(99,102,241,0.25); color: #e0e7ff; }
  }
  .login-card {
    background: rgba(255, 255, 255, 0.05); /* Glassy effect */
    border-radius: 16px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    padding: 40px;
    width: 100%;
    max-width: 400px;
    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.37); /* Deeper shadow */
    backdrop-filter: blur(10px); /* Glassy blur */
    -webkit-backdrop-filter: blur(10px);
    z-index: 1;
    position: relative;
  }
  .login-header {
    text-align: center;
    margin-bottom: 32px;
  }
  .login-logo {
    width: 64px; /* Larger logo */
    height: 64px;
    border-radius: 16px;
    margin-bottom: 16px;
    object-fit: cover;
    box-shadow: 0 0 0 4px rgba(37,148,208,0.3), 0 4px 16px rgba(37,148,208,0.18);
    transition: box-shadow 0.3s ease;
  }
  .login-logo:hover {
    box-shadow: 0 0 0 4px rgba(37,148,208,0.45), 0 4px 20px rgba(37,148,208,0.25);
  }
  .login-header h1 { font-size: 24px; font-weight: 700; margin: 0 0 8px; color: #e0e7ff; }
  .login-header p { font-size: 15px; color: #a7b5e0; margin: 0; }
  .form-group { margin-bottom: 18px; }
  .form-group label {
    display: block;
    font-size: 14px;
    font-weight: 500;
    color: #c3d0f0;
    margin-bottom: 8px;
  }
  .form-group input {
    width: 100%;
    padding: 12px 16px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 10px;
    font-size: 15px;
    font-family: inherit;
    color: #e0e7ff;
    background: rgba(255, 255, 255, 0.1);
    outline: none;
    transition: border-color 150ms, box-shadow 150ms, background 150ms;
  }
  .form-group input::placeholder { color: #8c9ccf; }
  .form-group input:focus {
    border-color: #6366f1;
    box-shadow: 0 0 0 3px rgba(99,102,241,0.3);
    background: rgba(255, 255, 255, 0.15);
  }
  .login-btn {
    width: 100%;
    padding: 12px;
    background: linear-gradient(135deg, #2594d0, #1a7ab5);
    color: white;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
    margin-top: 16px;
    transition: opacity 0.2s ease, transform 0.2s ease;
  }
  .login-btn:hover {
    opacity: 0.95;
    transform: translateY(-1px);
  }
  .login-btn:active {
    opacity: 0.85;
    transform: translateY(0);
  }
  .error-msg {
    background: rgba(239,68,68,0.2);
    color: #fca5a5;
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 14px;
    margin-bottom: 20px;
    border: 1px solid rgba(239,68,68,0.4);
  }
  .login-footer {
    text-align: center;
    margin-top: 32px;
    font-size: 13px;
    color: #8c9ccf;
  }
  .setup-note {
    background: rgba(99,102,241,0.15);
    border: 1px solid rgba(99,102,241,0.3);
    border-radius: 10px;
    padding: 14px 16px;
    font-size: 14px;
    color: #c3d0f0;
    margin-bottom: 24px;
    line-height: 1.6;
  }
  .setup-note code {
    background: rgba(99,102,241,0.25);
    padding: 2px 6px;
    border-radius: 6px;
    font-family: "SF Mono", "Fira Code", ui-monospace, monospace;
    font-size: 13px;
    color: #e0e7ff;
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
