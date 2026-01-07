/**
 * Email Job Handler Tests
 */

import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import {
  handleEmailJob,
  extractSummary,
  extractFilesChanged,
  type JobContext,
} from "./email-job";
import type { EmailJob, ClaudeResult } from "../mailer";
import type { Session } from "../session";
import type { ClaudeCodeMessage } from "../services/claude-code";

// Mock modules
let mockEnsureBranch: ReturnType<typeof mock>;
let mockCommitAndPush: ReturnType<typeof mock>;
let mockCreatePR: ReturnType<typeof mock>;
let mockGetPRUrl: ReturnType<typeof mock>;
let mockHasChanges: ReturnType<typeof mock>;
let mockSendReply: ReturnType<typeof mock>;
let mockFormatSuccessReply: ReturnType<typeof mock>;
let mockFormatErrorReply: ReturnType<typeof mock>;
let mockUpdateSession: ReturnType<typeof mock>;
let mockClaudeStart: ReturnType<typeof mock>;
let mockClaudeOnMessage: ReturnType<typeof mock>;
let mockClaudeOnComplete: ReturnType<typeof mock>;

// Store callbacks for simulating Claude behavior
let messageCallback: ((msg: ClaudeCodeMessage) => void) | null = null;
let completeCallback: (() => void) | null = null;

// Mock ClaudeCodeService
const MockClaudeCodeService = mock((options: unknown) => {
  return {
    options,
    start: mockClaudeStart,
    onMessage: (cb: (msg: ClaudeCodeMessage) => void) => {
      messageCallback = cb;
      return mockClaudeOnMessage(cb);
    },
    onComplete: (cb: () => void) => {
      completeCallback = cb;
      return mockClaudeOnComplete(cb);
    },
    stop: mock(() => Promise.resolve()),
  };
});

// Import the module to be tested (will be replaced with mocked version)
mock.module("../services/claude-code", () => ({
  ClaudeCodeService: MockClaudeCodeService,
}));

mock.module("../git", () => ({
  ensureBranch: (...args: unknown[]) => mockEnsureBranch(...args),
  commitAndPush: (...args: unknown[]) => mockCommitAndPush(...args),
  createPR: (...args: unknown[]) => mockCreatePR(...args),
  getPRUrl: (...args: unknown[]) => mockGetPRUrl(...args),
  hasChanges: (...args: unknown[]) => mockHasChanges(...args),
}));

mock.module("../mailer", () => ({
  sendReply: (...args: unknown[]) => mockSendReply(...args),
  formatSuccessReply: (...args: unknown[]) => mockFormatSuccessReply(...args),
  formatErrorReply: (...args: unknown[]) => mockFormatErrorReply(...args),
}));

mock.module("../session", () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
}));

describe("email-job handler", () => {
  let db: Database;
  let ctx: JobContext;
  let job: EmailJob;
  let session: Session;

  beforeEach(() => {
    // Reset all mocks
    mockEnsureBranch = mock(() => Promise.resolve());
    mockCommitAndPush = mock(() => Promise.resolve());
    mockCreatePR = mock(() => Promise.resolve(42));
    mockGetPRUrl = mock(() =>
      Promise.resolve("https://github.com/test/repo/pull/42")
    );
    mockHasChanges = mock(() => Promise.resolve(true));
    mockSendReply = mock(() => Promise.resolve());
    mockFormatSuccessReply = mock(() => ({
      to: "user@example.com",
      subject: "Re: Test",
      text: "Success",
    }));
    mockFormatErrorReply = mock(() => ({
      to: "user@example.com",
      subject: "Re: Test",
      text: "Error",
    }));
    mockUpdateSession = mock(() => {});
    mockClaudeOnMessage = mock(() => () => {});
    mockClaudeOnComplete = mock(() => () => {});

    // Reset callbacks
    messageCallback = null;
    completeCallback = null;

    // Setup Claude start mock to simulate successful completion
    mockClaudeStart = mock(() => {
      // Simulate async Claude response
      setTimeout(() => {
        if (messageCallback) {
          messageCallback({
            type: "assistant",
            content: "I completed the task successfully.",
          });
        }
        if (completeCallback) {
          completeCallback();
        }
      }, 10);
      return Promise.resolve();
    });

    // Create in-memory database
    db = new Database(":memory:");

    ctx = {
      db,
      projectsDir: "/projects",
      fromEmail: "claude@example.com",
    };

    job = {
      id: "job-123",
      sessionId: "session-456",
      project: "my-project",
      prompt: "Add a new feature",
      replyTo: "user@example.com",
      originalSubject: "Add feature request",
      messageId: "<msg-123@example.com>",
      resumeSession: false,
      createdAt: new Date().toISOString(),
    };

    session = {
      id: "session-456",
      subjectHash: "abc123",
      project: "my-project",
      branchName: "email-claude-12345678",
      claudeSessionId: null,
      prNumber: null,
      createdAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
    };
  });

  afterEach(() => {
    db.close();
  });

  describe("handleEmailJob", () => {
    it("creates branch, runs claude, commits, creates PR, and sends reply", async () => {
      await handleEmailJob(job, session, ctx);

      // Verify branch was created
      expect(mockEnsureBranch).toHaveBeenCalledWith(
        "/projects/my-project",
        "email-claude-12345678"
      );

      // Verify commit and push
      expect(mockCommitAndPush).toHaveBeenCalledWith(
        "/projects/my-project",
        "Email task: Add feature request"
      );

      // Verify PR was created
      expect(mockCreatePR).toHaveBeenCalledWith(
        "/projects/my-project",
        "[Email] Add feature request",
        expect.stringContaining("session-456")
      );

      // Verify session was updated with PR number
      expect(mockUpdateSession).toHaveBeenCalledWith(db, "session-456", {
        prNumber: 42,
      });

      // Verify success reply was sent
      expect(mockFormatSuccessReply).toHaveBeenCalled();
      expect(mockSendReply).toHaveBeenCalledWith(
        expect.objectContaining({ to: "user@example.com" }),
        "claude@example.com"
      );
    });

    it("skips commit when no changes exist", async () => {
      mockHasChanges = mock(() => Promise.resolve(false));

      await handleEmailJob(job, session, ctx);

      // Verify branch was created
      expect(mockEnsureBranch).toHaveBeenCalled();

      // Verify commit was NOT called
      expect(mockCommitAndPush).not.toHaveBeenCalled();

      // Verify PR was NOT created
      expect(mockCreatePR).not.toHaveBeenCalled();

      // Verify success reply was still sent
      expect(mockSendReply).toHaveBeenCalled();
    });

    it("reuses existing PR and does not create new one", async () => {
      // Session already has a PR
      session.prNumber = 99;

      await handleEmailJob(job, session, ctx);

      // Verify commit was called (changes exist)
      expect(mockCommitAndPush).toHaveBeenCalled();

      // Verify new PR was NOT created
      expect(mockCreatePR).not.toHaveBeenCalled();

      // Verify existing PR URL was fetched
      expect(mockGetPRUrl).toHaveBeenCalledWith("/projects/my-project", 99);

      // Verify success reply was sent
      expect(mockSendReply).toHaveBeenCalled();
    });

    it("sends error reply on Claude failure", async () => {
      mockClaudeStart = mock(() => {
        setTimeout(() => {
          if (messageCallback) {
            messageCallback({
              type: "error",
              content: "Claude encountered an error",
            });
          }
        }, 10);
        return Promise.resolve();
      });

      await expect(handleEmailJob(job, session, ctx)).rejects.toThrow(
        "Claude error"
      );

      // Verify error reply was sent
      expect(mockFormatErrorReply).toHaveBeenCalled();
      expect(mockSendReply).toHaveBeenCalled();
    });

    it("sends error reply on git failure", async () => {
      mockEnsureBranch = mock(() =>
        Promise.reject(new Error("Git branch failed"))
      );

      await expect(handleEmailJob(job, session, ctx)).rejects.toThrow(
        "Git branch failed"
      );

      // Verify error reply was sent
      expect(mockFormatErrorReply).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Git branch failed" }),
        job
      );
      expect(mockSendReply).toHaveBeenCalled();
    });

    it("sends error reply on commit failure", async () => {
      mockCommitAndPush = mock(() =>
        Promise.reject(new Error("Commit failed"))
      );

      await expect(handleEmailJob(job, session, ctx)).rejects.toThrow(
        "Commit failed"
      );

      // Verify error reply was sent
      expect(mockFormatErrorReply).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Commit failed" }),
        job
      );
      expect(mockSendReply).toHaveBeenCalled();
    });

    it("sends error reply on PR creation failure", async () => {
      mockCreatePR = mock(() =>
        Promise.reject(new Error("PR creation failed"))
      );

      await expect(handleEmailJob(job, session, ctx)).rejects.toThrow(
        "PR creation failed"
      );

      // Verify error reply was sent
      expect(mockFormatErrorReply).toHaveBeenCalled();
      expect(mockSendReply).toHaveBeenCalled();
    });
  });

  describe("extractSummary", () => {
    it("extracts summary from result message", () => {
      const messages: ClaudeCodeMessage[] = [
        { type: "assistant", content: "Working on it..." },
        { type: "result", result: "Task completed successfully!" },
      ];

      expect(extractSummary(messages)).toBe("Task completed successfully!");
    });

    it("extracts summary from assistant message with direct content", () => {
      const messages: ClaudeCodeMessage[] = [
        { type: "assistant", content: "First message" },
        { type: "assistant", content: "Final summary of changes" },
      ];

      expect(extractSummary(messages)).toBe("Final summary of changes");
    });

    it("extracts summary from assistant message with nested content", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "assistant",
          from: "assistant",
          message: {
            content: [{ type: "text", text: "Nested content summary" }],
          },
        },
      ];

      expect(extractSummary(messages)).toBe("Nested content summary");
    });

    it("returns default message when no content found", () => {
      const messages: ClaudeCodeMessage[] = [
        { type: "tool_use", tool_name: "write" },
      ];

      expect(extractSummary(messages)).toBe("Task completed.");
    });
  });

  describe("extractFilesChanged", () => {
    it("extracts files from tool_use messages", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "tool_use",
          tool_name: "Write",
          tool_input: { file_path: "/src/index.ts" },
        },
        {
          type: "tool_use",
          tool_name: "Edit",
          tool_input: { path: "/src/utils.ts" },
        },
      ];

      const files = extractFilesChanged(messages);
      expect(files).toContain("/src/index.ts");
      expect(files).toContain("/src/utils.ts");
    });

    it("ignores non-write tool operations", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "tool_use",
          tool_name: "Read",
          tool_input: { file_path: "/src/read-only.ts" },
        },
        {
          type: "tool_use",
          tool_name: "Write",
          tool_input: { file_path: "/src/written.ts" },
        },
      ];

      const files = extractFilesChanged(messages);
      expect(files).not.toContain("/src/read-only.ts");
      expect(files).toContain("/src/written.ts");
    });

    it("deduplicates files", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "tool_use",
          tool_name: "Write",
          tool_input: { file_path: "/src/index.ts" },
        },
        {
          type: "tool_use",
          tool_name: "Edit",
          tool_input: { file_path: "/src/index.ts" },
        },
      ];

      const files = extractFilesChanged(messages);
      expect(files.filter((f) => f === "/src/index.ts").length).toBe(1);
    });

    it("extracts files from tool_result content", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "tool_result",
          content: 'Successfully wrote to "/src/new-file.ts"',
        },
      ];

      const files = extractFilesChanged(messages);
      expect(files).toContain("/src/new-file.ts");
    });

    it("returns empty array when no files changed", () => {
      const messages: ClaudeCodeMessage[] = [
        { type: "assistant", content: "No changes needed" },
      ];

      expect(extractFilesChanged(messages)).toEqual([]);
    });

    it("handles str_replace_editor tool", () => {
      const messages: ClaudeCodeMessage[] = [
        {
          type: "tool_use",
          tool_name: "str_replace_editor",
          tool_input: { path: "/src/component.tsx" },
        },
      ];

      const files = extractFilesChanged(messages);
      expect(files).toContain("/src/component.tsx");
    });
  });
});
