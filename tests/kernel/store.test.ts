import { describe, test, expect, afterAll } from "bun:test";
import { getDb, closeDb } from "../../src/store/db.js";
import { getOrCreateSession, getSession } from "../../src/store/sessions.js";
import { appendMessage, getSessionMessages, pruneOldMessages } from "../../src/store/messages.js";
import { unlinkSync } from "node:fs";

const TEST_DB = "/tmp/paw-test.db";

describe("Store", () => {
  const db = getDb(TEST_DB);

  afterAll(() => {
    closeDb();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + "-journal"); } catch {}
    try { unlinkSync(TEST_DB + "-wal"); } catch {}
    try { unlinkSync(TEST_DB + "-shm"); } catch {}
  });

  test("creates and retrieves sessions", () => {
    const session = getOrCreateSession(db, "s1", "slack", "user1");
    expect(session.id).toBe("s1");
    expect(session.channel).toBe("slack");

    const fetched = getSession(db, "s1");
    expect(fetched).not.toBeNull();
    expect(fetched!.user_id).toBe("user1");
  });

  test("getOrCreateSession is idempotent", () => {
    const s1 = getOrCreateSession(db, "s2", "slack", "user2");
    const s2 = getOrCreateSession(db, "s2", "slack", "user2");
    expect(s1.id).toBe(s2.id);
  });

  test("appends and retrieves messages", () => {
    getOrCreateSession(db, "s3", "slack", "user3");
    appendMessage(db, "s3", "user", "hello");
    appendMessage(db, "s3", "assistant", "hi there");

    const msgs = getSessionMessages(db, "s3");
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe("user");
    expect(msgs[1].role).toBe("assistant");
  });

  test("prunes old messages", () => {
    getOrCreateSession(db, "s4", "slack", "user4");
    for (let i = 0; i < 10; i++) {
      appendMessage(db, "s4", "user", `msg ${i}`);
    }

    pruneOldMessages(db, "s4", 3);
    const msgs = getSessionMessages(db, "s4");
    expect(msgs).toHaveLength(3);
  });
});
