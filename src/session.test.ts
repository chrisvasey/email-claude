/**
 * Session Module Tests
 *
 * Tests for SQLite session management using in-memory database
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  hashSubject,
  initDb,
  getSession,
  createSession,
  updateSession,
  getOrCreateSession,
  type Session,
  type InboundEmail,
} from "./session.ts";

describe("session module", () => {
  describe("hashSubject", () => {
    test("normalizes Re: prefix", () => {
      const hash1 = hashSubject("Test Subject");
      const hash2 = hashSubject("Re: Test Subject");
      const hash3 = hashSubject("RE: Test Subject");
      const hash4 = hashSubject("re: Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
      expect(hash1).toBe(hash4);
    });

    test("normalizes Fwd: prefix", () => {
      const hash1 = hashSubject("Test Subject");
      const hash2 = hashSubject("Fwd: Test Subject");
      const hash3 = hashSubject("FWD: Test Subject");
      const hash4 = hashSubject("fwd: Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
      expect(hash1).toBe(hash4);
    });

    test("normalizes Fw: prefix", () => {
      const hash1 = hashSubject("Test Subject");
      const hash2 = hashSubject("Fw: Test Subject");
      const hash3 = hashSubject("FW: Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    test("normalizes whitespace", () => {
      const hash1 = hashSubject("Test Subject");
      const hash2 = hashSubject("  Test Subject  ");
      const hash3 = hashSubject("Test Subject ");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    test("normalizes case", () => {
      const hash1 = hashSubject("test subject");
      const hash2 = hashSubject("TEST SUBJECT");
      const hash3 = hashSubject("Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    test("normalizes combined prefixes, whitespace, and case", () => {
      const hash1 = hashSubject("test subject");
      const hash2 = hashSubject("Re:   TEST SUBJECT  ");
      const hash3 = hashSubject("FWD: Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1).toBe(hash3);
    });

    test("produces consistent 12-character hashes", () => {
      const hash1 = hashSubject("Test Subject");
      const hash2 = hashSubject("Test Subject");

      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(12);
      expect(/^[a-f0-9]+$/.test(hash1)).toBe(true);
    });

    test("produces different hashes for different subjects", () => {
      const hash1 = hashSubject("Subject One");
      const hash2 = hashSubject("Subject Two");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("database operations", () => {
    let db: Database;

    beforeEach(() => {
      db = initDb(":memory:");
    });

    describe("initDb", () => {
      test("creates sessions table", () => {
        const tables = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='sessions'"
          )
          .all();

        expect(tables.length).toBe(1);
      });

      test("creates subject_hash index", () => {
        const indexes = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_subject_hash'"
          )
          .all();

        expect(indexes.length).toBe(1);
      });
    });

    describe("createSession and getSession", () => {
      test("creates and retrieves a session", () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "test-session-id",
          subjectHash: "abc123def456",
          project: "test-project",
          branchName: "email-claude-test",
          claudeSessionId: null,
          prNumber: null,
        };

        createSession(db, session);
        const retrieved = getSession(db, "abc123def456");

        expect(retrieved).not.toBeNull();
        expect(retrieved!.id).toBe("test-session-id");
        expect(retrieved!.subjectHash).toBe("abc123def456");
        expect(retrieved!.project).toBe("test-project");
        expect(retrieved!.branchName).toBe("email-claude-test");
        expect(retrieved!.claudeSessionId).toBeNull();
        expect(retrieved!.prNumber).toBeNull();
        expect(retrieved!.createdAt).toBeTruthy();
        expect(retrieved!.lastActivity).toBeTruthy();
      });

      test("returns null for non-existent session", () => {
        const retrieved = getSession(db, "nonexistent");

        expect(retrieved).toBeNull();
      });

      test("stores optional fields correctly", () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "test-session-2",
          subjectHash: "xyz789abc012",
          project: "another-project",
          branchName: "email-claude-test2",
          claudeSessionId: "claude-sess-123",
          prNumber: 42,
        };

        createSession(db, session);
        const retrieved = getSession(db, "xyz789abc012");

        expect(retrieved!.claudeSessionId).toBe("claude-sess-123");
        expect(retrieved!.prNumber).toBe(42);
      });
    });

    describe("updateSession", () => {
      test("updates claudeSessionId", () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "update-test-1",
          subjectHash: "upd123456789",
          project: "test-project",
          branchName: "email-claude-upd",
          claudeSessionId: null,
          prNumber: null,
        };

        createSession(db, session);
        updateSession(db, "update-test-1", { claudeSessionId: "new-claude-id" });

        const retrieved = getSession(db, "upd123456789");
        expect(retrieved!.claudeSessionId).toBe("new-claude-id");
      });

      test("updates prNumber", () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "update-test-2",
          subjectHash: "prn123456789",
          project: "test-project",
          branchName: "email-claude-prn",
          claudeSessionId: null,
          prNumber: null,
        };

        createSession(db, session);
        updateSession(db, "update-test-2", { prNumber: 99 });

        const retrieved = getSession(db, "prn123456789");
        expect(retrieved!.prNumber).toBe(99);
      });

      test("updates multiple fields at once", () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "update-test-3",
          subjectHash: "mul123456789",
          project: "test-project",
          branchName: "email-claude-mul",
          claudeSessionId: null,
          prNumber: null,
        };

        createSession(db, session);
        updateSession(db, "update-test-3", {
          claudeSessionId: "multi-claude-id",
          prNumber: 123,
          branchName: "new-branch-name",
        });

        const retrieved = getSession(db, "mul123456789");
        expect(retrieved!.claudeSessionId).toBe("multi-claude-id");
        expect(retrieved!.prNumber).toBe(123);
        expect(retrieved!.branchName).toBe("new-branch-name");
      });

      test("updates lastActivity timestamp", async () => {
        const session: Omit<Session, "createdAt" | "lastActivity"> = {
          id: "update-test-4",
          subjectHash: "tim123456789",
          project: "test-project",
          branchName: "email-claude-tim",
          claudeSessionId: null,
          prNumber: null,
        };

        createSession(db, session);
        const before = getSession(db, "tim123456789");
        const beforeActivity = before!.lastActivity;

        // Small delay to ensure time difference
        await Bun.sleep(10);

        updateSession(db, "update-test-4", {});
        const after = getSession(db, "tim123456789");

        expect(after!.lastActivity).not.toBe(beforeActivity);
      });
    });

    describe("getOrCreateSession", () => {
      test("creates new session for new subject", () => {
        const email: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "New Feature Request",
          text: "Please add a new feature",
        };

        const session = getOrCreateSession(db, email, "my-project");

        expect(session.id).toBeTruthy();
        expect(session.id.length).toBe(32);
        expect(session.subjectHash).toBe(hashSubject("New Feature Request"));
        expect(session.project).toBe("my-project");
        expect(session.branchName).toMatch(/^email-claude-[a-f0-9]{8}$/);
        expect(session.claudeSessionId).toBeNull();
        expect(session.prNumber).toBeNull();
        expect(session.createdAt).toBeTruthy();
        expect(session.lastActivity).toBeTruthy();
      });

      test("returns existing session for same subject", () => {
        const email: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "Existing Thread",
          text: "First message",
        };

        const session1 = getOrCreateSession(db, email, "my-project");

        const replyEmail: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "Re: Existing Thread",
          text: "Reply message",
        };

        const session2 = getOrCreateSession(db, replyEmail, "my-project");

        expect(session1.id).toBe(session2.id);
        expect(session1.subjectHash).toBe(session2.subjectHash);
        expect(session1.branchName).toBe(session2.branchName);
      });

      test("returns existing session regardless of Re:/Fwd: prefix", () => {
        const email1: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "Important Task",
          text: "Message 1",
        };

        const session1 = getOrCreateSession(db, email1, "project-a");

        const email2: InboundEmail = {
          from: "other@example.com",
          to: "claude@code.patch.agency",
          subject: "Fwd: Important Task",
          text: "Forwarded message",
        };

        const session2 = getOrCreateSession(db, email2, "project-a");

        expect(session1.id).toBe(session2.id);
      });

      test("creates different sessions for different subjects", () => {
        const email1: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "First Topic",
          text: "Message 1",
        };

        const email2: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "Second Topic",
          text: "Message 2",
        };

        const session1 = getOrCreateSession(db, email1, "project-a");
        const session2 = getOrCreateSession(db, email2, "project-a");

        expect(session1.id).not.toBe(session2.id);
        expect(session1.subjectHash).not.toBe(session2.subjectHash);
      });

      test("updates lastActivity when retrieving existing session", async () => {
        const email: InboundEmail = {
          from: "test@example.com",
          to: "claude@code.patch.agency",
          subject: "Activity Test",
          text: "First message",
        };

        const session1 = getOrCreateSession(db, email, "my-project");
        const firstActivity = session1.lastActivity;

        // Small delay to ensure time difference
        await Bun.sleep(10);

        const session2 = getOrCreateSession(db, email, "my-project");

        expect(session2.lastActivity).not.toBe(firstActivity);
      });
    });
  });
});
