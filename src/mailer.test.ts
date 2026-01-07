/**
 * Mailer Module Tests
 *
 * Tests for email reply functionality using mocked Resend
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import type { EmailJob, ClaudeResult } from "./mailer.ts";

// Mock Resend before importing mailer
const mockSend = mock(() => Promise.resolve({ id: "mock-email-id" }));

mock.module("resend", () => ({
  Resend: class MockResend {
    emails = {
      send: mockSend,
    };
  },
}));

describe("mailer module", () => {
  // Store original env
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "re_test_api_key";
    mockSend.mockClear();
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.RESEND_API_KEY = originalEnv;
    } else {
      delete process.env.RESEND_API_KEY;
    }
  });

  const createMockJob = (overrides: Partial<EmailJob> = {}): EmailJob => ({
    id: "job-123",
    sessionId: "session-abc",
    project: "test-project",
    prompt: "Fix the bug",
    replyTo: "user@example.com",
    originalSubject: "Bug fix request",
    messageId: "<msg-123@mail.example.com>",
    resumeSession: false,
    createdAt: "2024-01-15T10:00:00Z",
    ...overrides,
  });

  const createMockResult = (overrides: Partial<ClaudeResult> = {}): ClaudeResult => ({
    summary: "Fixed the authentication bug",
    filesChanged: ["src/auth.ts", "tests/auth.test.ts"],
    prUrl: "https://github.com/owner/repo/pull/42",
    prNumber: 42,
    ...overrides,
  });

  describe("formatSuccessReply", () => {
    test("generates correct text format", async () => {
      const { formatSuccessReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const job = createMockJob();
      const result = createMockResult();

      const reply = formatSuccessReply(result, job);

      expect(reply.to).toBe("user@example.com");
      expect(reply.subject).toBe("Re: Bug fix request");
      expect(reply.inReplyTo).toBe("<msg-123@mail.example.com>");

      expect(reply.text).toContain("## Summary");
      expect(reply.text).toContain("Fixed the authentication bug");
      expect(reply.text).toContain("## Changes");
      expect(reply.text).toContain("- src/auth.ts");
      expect(reply.text).toContain("- tests/auth.test.ts");
      expect(reply.text).toContain("## Links");
      expect(reply.text).toContain("- PR: https://github.com/owner/repo/pull/42");
      expect(reply.text).toContain("- Branch: email/session-abc");
      expect(reply.text).toContain("Reply to this email to continue the conversation.");
    });

    test("handles missing PR URL", async () => {
      const { formatSuccessReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const job = createMockJob();
      const result = createMockResult({ prUrl: undefined, prNumber: undefined });

      const reply = formatSuccessReply(result, job);

      expect(reply.text).not.toContain("- PR:");
      expect(reply.text).toContain("## Links");
      expect(reply.text).toContain("- Branch: email/session-abc");
    });

    test("handles empty filesChanged array", async () => {
      const { formatSuccessReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const job = createMockJob();
      const result = createMockResult({ filesChanged: [] });

      const reply = formatSuccessReply(result, job);

      expect(reply.text).not.toContain("## Changes");
    });
  });

  describe("formatErrorReply", () => {
    test("includes error message", async () => {
      const { formatErrorReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const job = createMockJob();
      const error = new Error("Connection timeout");

      const reply = formatErrorReply(error, job);

      expect(reply.to).toBe("user@example.com");
      expect(reply.subject).toBe("Re: Bug fix request");
      expect(reply.inReplyTo).toBe("<msg-123@mail.example.com>");
      expect(reply.text).toContain("## Error");
      expect(reply.text).toContain("An error occurred while processing your request:");
      expect(reply.text).toContain("Connection timeout");
      expect(reply.text).toContain("Reply to try again or start a new task.");
    });
  });

  describe("sendReply", () => {
    test("calls Resend with correct params", async () => {
      const { sendReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const reply = {
        to: "user@example.com",
        subject: "Re: Test",
        text: "Test message",
      };

      await sendReply(reply, "claude@code.patch.agency");

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        from: "claude@code.patch.agency",
        to: "user@example.com",
        subject: "Re: Test",
        text: "Test message",
        html: undefined,
        headers: undefined,
      });
    });

    test("sets In-Reply-To header when inReplyTo provided", async () => {
      const { sendReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const reply = {
        to: "user@example.com",
        subject: "Re: Test",
        inReplyTo: "<original-msg-id@mail.example.com>",
        text: "Test message",
      };

      await sendReply(reply, "claude@code.patch.agency");

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith({
        from: "claude@code.patch.agency",
        to: "user@example.com",
        subject: "Re: Test",
        text: "Test message",
        html: undefined,
        headers: {
          "In-Reply-To": "<original-msg-id@mail.example.com>",
          "References": "<original-msg-id@mail.example.com>",
        },
      });
    });

    test("includes html when provided", async () => {
      const { sendReply, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const reply = {
        to: "user@example.com",
        subject: "Re: Test",
        text: "Test message",
        html: "<p>Test message</p>",
      };

      await sendReply(reply, "claude@code.patch.agency");

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          html: "<p>Test message</p>",
        })
      );
    });
  });

  describe("getResend", () => {
    test("throws when RESEND_API_KEY is not set", async () => {
      delete process.env.RESEND_API_KEY;

      const { getResend, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      expect(() => getResend()).toThrow(
        "RESEND_API_KEY environment variable is not set"
      );
    });

    test("returns Resend client when API key is set", async () => {
      process.env.RESEND_API_KEY = "re_test_key";

      const { getResend, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const client = getResend();
      expect(client).toBeDefined();
      expect(client.emails).toBeDefined();
    });

    test("reuses client on subsequent calls", async () => {
      process.env.RESEND_API_KEY = "re_test_key";

      const { getResend, _resetResendClient } = await import("./mailer.ts");
      _resetResendClient();

      const client1 = getResend();
      const client2 = getResend();

      expect(client1).toBe(client2);
    });
  });
});
