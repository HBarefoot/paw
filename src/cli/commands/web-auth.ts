import { createInterface } from "node:readline";
import { getDb } from "../../store/db.js";
import { WebAuthManager } from "../../security/web-auth.js";
import { loadConfig } from "../../config/loader.js";

function ask(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export async function webAuthCommand(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    console.log("\n  🐾 Paw Web Admin Setup\n");

    const config = loadConfig();
    const db = getDb(config.store.dbPath, config.store.customSqlitePath);
    const authManager = new WebAuthManager(db, {
      maxAgeMinutes: config.web.session.maxAgeMinutes,
      idleTimeoutMinutes: config.web.session.idleTimeoutMinutes,
    });

    // Check for existing admins
    if (authManager.hasAdmins()) {
      console.log("  Existing admin accounts found.");
      const proceed = await ask(rl, "  Create another admin? (y/N): ");
      if (proceed.toLowerCase() !== "y") {
        console.log("  Cancelled.\n");
        return;
      }
    }

    const username = await ask(rl, "  Username: ");
    if (!username) {
      console.log("  Username is required.\n");
      return;
    }

    // Check if username already exists
    if (authManager.getAdminByUsername(username)) {
      console.log(`  Username "${username}" already exists.\n`);
      return;
    }

    const password = await ask(rl, "  Password: ");
    if (!password) {
      console.log("  Password is required.\n");
      return;
    }

    if (password.length < 8) {
      console.log("  Password must be at least 8 characters.\n");
      return;
    }

    const confirm = await ask(rl, "  Confirm password: ");
    if (password !== confirm) {
      console.log("  Passwords do not match.\n");
      return;
    }

    const id = await authManager.createAdmin(username, password);
    console.log(`\n  ✓ Admin "${username}" created (id: ${id})`);
    console.log("  You can now log in at the web UI.\n");

    const setupTotp = await ask(rl, "  Set up TOTP now? (y/N): ");
    if (setupTotp.toLowerCase() === "y") {
      const secret = authManager.setupTotp(id);
      console.log(`\n  Your TOTP secret: ${secret}`);
      console.log("  Add this to your authenticator app.\n");

      const code = await ask(rl, "  Enter the 6-digit code to verify: ");
      if (authManager.verifyAndEnableTotp(id, code)) {
        console.log("  ✓ TOTP enabled successfully.\n");
      } else {
        console.log("  ✗ Invalid code. TOTP not enabled. You can set it up later via the web UI.\n");
      }
    }
  } finally {
    rl.close();
  }
}
