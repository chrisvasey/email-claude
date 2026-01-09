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
} from "../../src/handlers/email-job";
import type { EmailJob, ClaudeResult } from "../../src/mailer";
import type { Session } from "../../src/session";
import type { ClaudeCodeMessage } from "../../src/services/claude-code";

// Mock modules
let mockEnsureBranch: ReturnType<typeof mock>;
let mockCreatePR: ReturnType<typeof mock>;
let mockGetPRUrl: ReturnType<typeof mock>;
let mockCommentOnPR: ReturnType<typeof mock>;
let mockSendReply: ReturnType<typeof mock>;
let mockFormatSuccessReply: ReturnType<typeof mock>;
let mockFormatErrorReply: ReturnType<typeof mock>;
let mockUpdateSession: ReturnType<typeof mock>;
let mockClaudeStart: ReturnType<typeof mock>;
let mockClaudeOnMessage: ReturnType<typeof mock>;
let mockClaudeOnComplete: ReturnType<typeof mock>;
let mockBuildFullPrompt: ReturnType<typeof mock>;

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
mock.module("../../src/services/claude-code", () => ({
  ClaudeCodeService: MockClaudeCodeService,
}));

let mockHasCommitsAhead: ReturnType<typeof mock>;

mock.module("../../src/git", () => ({
  ensureBranch: (...args: unknown[]) => mockEnsureBranch(...args),
  createPR: (...args: unknown[]) => mockCreatePR(...args),
  getPRUrl: (...args: unknown[]) => mockGetPRUrl(...args),
  commentOnPR: (...args: unknown[]) => mockCommentOnPR(...args),
  hasCommitsAhead: (...args: unknown[]) => mockHasCommitsAhead(...args),
}));

mock.module("../../src/prompts", () => ({
  buildFullPrompt: (...args: unknown[]) => mockBuildFullPrompt(...args),
}));

// Mock mailer - must export ALL functions to prevent polluting module cache
mock.module("../../src/mailer", () => ({
  sendReply: (...args: unknown[]) => mockSendReply(...args),
  formatSuccessReply: (...args: unknown[]) => mockFormatSuccessReply(...args),
  formatErrorReply: (...args: unknown[]) => mockFormatErrorReply(...args),
  // Include all other exports to prevent module cache pollution
  sendNotAllowedEmail: mock(() => Promise.resolve()),
  formatBranchNoticeEmail: mock(() => Promise.resolve({ to: "", subject: "", text: "" })),
  getResend: mock(() => ({ emails: { send: mock(() => Promise.resolve()) } })),
  _resetResendClient: mock(() => {}),
}));

let mockAddSessionMessage: ReturnType<typeof mock>;
let mockGetSessionMessages: ReturnType<typeof mock>;

mock.module("../../src/session", () => ({
  updateSession: (...args: unknown[]) => mockUpdateSession(...args),
  addSessionMessage: (...args: unknown[]) => mockAddSessionMessage(...args),
  getSessionMessages: (...args: unknown[]) => mockGetSessionMessages(...args),
}));

// Mock branch-safety module
let mockEnsureOnDefaultBranch: ReturnType<typeof mock>;

mock.module("../../src/branch-safety", () => ({
  ensureOnDefaultBranch: (...args: unknown[]) => mockEnsureOnDefaultBranch(...args),
}));

// Mock ensureRepo to always succeed (repo exists)
// Note: We forward opts to allow repo.test.ts to use dependency injection
mock.module("../../src/services/repo", () => ({
  ensureRepo: async (project: string, projectsDir: string, owner: string, opts?: { fileExists?: (path: string) => Promise<boolean>; spawn?: typeof Bun.spawn }) => {
    // If opts.fileExists is provided, use it (for repo.test.ts)
    if (opts?.fileExists) {
      const exists = await opts.fileExists(`${projectsDir}/${project}/.git/config`);
      if (!exists) {
        if (!owner) {
          throw new Error(`Cannot clone ${project}: GITHUB_OWNER is not configured`);
        }
        if (opts?.spawn) {
          const proc = opts.spawn(["git", "clone", `git@github.com:${owner}/${project}.git`, `${projectsDir}/${project}`], { stdout: "pipe", stderr: "pipe" });
          const exitCode = await proc.exited;
          if (exitCode !== 0) {
            throw new Error(`Failed to clone git@github.com:${owner}/${project}.git`);
          }
        }
      }
    }
    return `${projectsDir}/${project}`;
  },
  getRepoUrl: (project: string, owner: string) => `git@github.com:${owner}/${project}.git`,
  repoExists: async (projectPath: string, opts?: { fileExists?: (path: string) => Promise<boolean> }) => {
    // If opts.fileExists is provided, use it (for repo.test.ts)
    if (opts?.fileExists) {
      return opts.fileExists(`${projectPath}/.git/config`);
    }
    return true;
  },
}));

describe("email-job handler", () => {
  let db: Database;
  let ctx: JobContext;
  let job: EmailJob;
  let session: Session;

  beforeEach(() => {
    // Reset all mocks
    mockEnsureOnDefaultBranch = mock(() => Promise.resolve({
      notificationSent: false,
      previousBranch: "main",
      defaultBranch: "main",
    }));
    mockEnsureBranch = mock(() => Promise.resolve());
    mockCreatePR = mock(() => Promise.resolve(42));
    mockGetPRUrl = mock(() =>
      Promise.resolve("https://github.com/test/repo/pull/42")
    );
    mockCommentOnPR = mock(() => Promise.resolve());
    mockHasCommitsAhead = mock(() => Promise.resolve(true));
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
    mockAddSessionMessage = mock(() => {});
    mockGetSessionMessages = mock(() => [
      { id: 1, sessionId: "session-456", role: "user", content: "Add a new feature", createdAt: new Date().toISOString() },
      { id: 2, sessionId: "session-456", role: "assistant", content: "I completed the task successfully.", createdAt: new Date().toISOString() },
    ]);
    mockClaudeOnMessage = mock(() => () => {});
    mockClaudeOnComplete = mock(() => () => {});
    mockBuildFullPrompt = mock((subject: string, body: string) => {
      const userContent = body.trim() ? `Subject: ${subject}\n\n${body}` : subject;
      return `SYSTEM INSTRUCTIONS\n\n---\n\n${userContent}`;
    });

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
      githubOwner: "testowner",
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
    it("creates branch, runs claude, creates PR with original email, and sends reply", async () => {
      await handleEmailJob(job, session, ctx);

      // Verify branch was created
      expect(mockEnsureBranch).toHaveBeenCalledWith(
        "/projects/my-project",
        "email-claude-12345678"
      );

      // Verify prompt was built with subject and body
      expect(mockBuildFullPrompt).toHaveBeenCalledWith("Add feature request", "Add a new feature");

      // Verify PR was created with conversation history
      expect(mockCreatePR).toHaveBeenCalledWith(
        "/projects/my-project",
        "[Email] Add feature request",
        expect.stringContaining("## Conversation")
      );
      expect(mockCreatePR).toHaveBeenCalledWith(
        "/projects/my-project",
        "[Email] Add feature request",
        expect.stringContaining("**User:**")
      );
      expect(mockCreatePR).toHaveBeenCalledWith(
        "/projects/my-project",
        "[Email] Add feature request",
        expect.stringContaining("**Claude:**")
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

    it("adds comment to existing PR on subsequent emails", async () => {
      // Session already has a PR (subsequent email)
      session.prNumber = 99;

      await handleEmailJob(job, session, ctx);

      // Verify new PR was NOT created
      expect(mockCreatePR).not.toHaveBeenCalled();

      // Verify comment was added to existing PR with subject and body
      expect(mockCommentOnPR).toHaveBeenCalledWith(
        "/projects/my-project",
        99,
        expect.stringContaining("## Follow-up Request")
      );
      expect(mockCommentOnPR).toHaveBeenCalledWith(
        "/projects/my-project",
        99,
        expect.stringContaining("Subject: Add feature request")
      );
      expect(mockCommentOnPR).toHaveBeenCalledWith(
        "/projects/my-project",
        99,
        expect.stringContaining("Add a new feature")
      );

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

    it("sends error reply on PR comment failure", async () => {
      session.prNumber = 99;
      mockCommentOnPR = mock(() =>
        Promise.reject(new Error("Comment failed"))
      );

      await expect(handleEmailJob(job, session, ctx)).rejects.toThrow(
        "Comment failed"
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
