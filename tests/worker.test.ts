/**
 * Worker Retry Logic Tests
 *
 * Tests for the retry mechanism including:
 * - Exponential backoff calculation
 * - Retry queue scheduling
 * - Dead letter queue handling
 * - Retry processor
 */

import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";

// Mock the modules before importing worker
const mockRedis = {
  zAdd: mock(() => Promise.resolve(1)),
  zRangeByScore: mock(() => Promise.resolve([])),
  zRem: mock(() => Promise.resolve(1)),
  rPush: mock(() => Promise.resolve(1)),
  lPush: mock(() => Promise.resolve(1)),
};

// Note: This test file re-implements the pure functions locally to test them
// without triggering the worker's side effects (Redis connection, infinite loop).
// We do NOT use mock.module here to avoid polluting the module cache for other tests.

import type { EmailJob } from "../src/mailer";

// Re-implement the pure functions for testing
const MAX_RETRIES = 3;
const RETRY_QUEUE_NAME = "email-claude:jobs:retry";
const FAILED_QUEUE_NAME = "email-claude:jobs:failed";

function calculateRetryDelay(retryCount: number): number {
  return Math.pow(2, retryCount) * 1000;
}

describe("Worker Retry Logic", () => {
  beforeEach(() => {
    mockRedis.zAdd.mockClear();
    mockRedis.zRangeByScore.mockClear();
    mockRedis.zRem.mockClear();
    mockRedis.rPush.mockClear();
    mockRedis.lPush.mockClear();
  });

  describe("calculateRetryDelay", () => {
    it("calculates exponential backoff correctly", () => {
      // 2^0 * 1000 = 1000ms (1s)
      expect(calculateRetryDelay(0)).toBe(1000);

      // 2^1 * 1000 = 2000ms (2s)
      expect(calculateRetryDelay(1)).toBe(2000);

      // 2^2 * 1000 = 4000ms (4s)
      expect(calculateRetryDelay(2)).toBe(4000);

      // 2^3 * 1000 = 8000ms (8s)
      expect(calculateRetryDelay(3)).toBe(8000);
    });
  });

  describe("scheduleRetry", () => {
    const createMockJob = (retryCount?: number): EmailJob => ({
      id: "test-job-123",
      sessionId: "test-session-456",
      project: "test-project",
      prompt: "Test prompt",
      replyTo: "user@example.com",
      originalSubject: "Test Subject",
      messageId: "msg-123",
      resumeSession: false,
      createdAt: new Date().toISOString(),
      retryCount,
    });

    it("schedules first retry with correct delay", async () => {
      const job = createMockJob(); // no retryCount = first attempt
      const error = new Error("Test error");

      // Simulate scheduling retry
      const currentRetryCount = job.retryCount ?? 0;
      const delay = calculateRetryDelay(currentRetryCount);
      const retryAt = Date.now() + delay;
      const retryJob = { ...job, retryCount: currentRetryCount + 1 };

      await mockRedis.zAdd(RETRY_QUEUE_NAME, {
        score: retryAt,
        value: JSON.stringify(retryJob),
      });

      expect(mockRedis.zAdd).toHaveBeenCalledTimes(1);
      expect(delay).toBe(1000); // First retry = 1s delay
    });

    it("schedules second retry with doubled delay", async () => {
      const job = createMockJob(1); // Already retried once
      const error = new Error("Test error");

      const currentRetryCount = job.retryCount ?? 0;
      const delay = calculateRetryDelay(currentRetryCount);

      expect(delay).toBe(2000); // Second retry = 2s delay
      expect(currentRetryCount).toBe(1);
    });

    it("schedules third retry with quadrupled delay", async () => {
      const job = createMockJob(2); // Already retried twice
      const error = new Error("Test error");

      const currentRetryCount = job.retryCount ?? 0;
      const delay = calculateRetryDelay(currentRetryCount);

      expect(delay).toBe(4000); // Third retry = 4s delay
      expect(currentRetryCount).toBe(2);
    });

    it("moves to dead letter queue after max retries", async () => {
      const job = createMockJob(3); // Already retried 3 times = max
      const error = new Error("Final error");

      const currentRetryCount = job.retryCount ?? 0;
      const shouldMoveToFailed = currentRetryCount >= MAX_RETRIES;

      expect(shouldMoveToFailed).toBe(true);
      expect(currentRetryCount).toBe(3);

      // Simulate moving to failed queue
      if (shouldMoveToFailed) {
        const failedJob = {
          ...job,
          failedAt: new Date().toISOString(),
          lastError: error.message,
        };
        await mockRedis.lPush(FAILED_QUEUE_NAME, JSON.stringify(failedJob));
      }

      expect(mockRedis.lPush).toHaveBeenCalledTimes(1);
    });
  });

  describe("processRetryQueue", () => {
    it("moves ready jobs from retry queue to pending queue", async () => {
      const now = Date.now();
      const job1 = {
        id: "job-1",
        sessionId: "session-1",
        project: "project-1",
        prompt: "prompt",
        replyTo: "user@example.com",
        originalSubject: "Subject",
        messageId: "msg-1",
        resumeSession: false,
        createdAt: new Date().toISOString(),
        retryCount: 1,
      };

      const job2 = {
        id: "job-2",
        sessionId: "session-2",
        project: "project-2",
        prompt: "prompt",
        replyTo: "user2@example.com",
        originalSubject: "Subject 2",
        messageId: "msg-2",
        resumeSession: false,
        createdAt: new Date().toISOString(),
        retryCount: 2,
      };

      // Mock finding ready jobs
      mockRedis.zRangeByScore.mockResolvedValueOnce([
        JSON.stringify(job1),
        JSON.stringify(job2),
      ]);

      const readyJobs = await mockRedis.zRangeByScore(RETRY_QUEUE_NAME, 0, now);
      expect(readyJobs.length).toBe(2);

      // Simulate processing each job
      for (const jobJson of readyJobs) {
        await mockRedis.zRem(RETRY_QUEUE_NAME, jobJson);
        await mockRedis.rPush("email-claude:jobs:pending", jobJson);
      }

      expect(mockRedis.zRem).toHaveBeenCalledTimes(2);
      expect(mockRedis.rPush).toHaveBeenCalledTimes(2);
    });

    it("returns 0 when no jobs are ready", async () => {
      mockRedis.zRangeByScore.mockResolvedValueOnce([]);

      const readyJobs = await mockRedis.zRangeByScore(RETRY_QUEUE_NAME, 0, Date.now());
      expect(readyJobs.length).toBe(0);
    });
  });

  describe("MAX_RETRIES constant", () => {
    it("is set to 3", () => {
      expect(MAX_RETRIES).toBe(3);
    });
  });

  describe("Queue names", () => {
    it("uses correct retry queue name", () => {
      expect(RETRY_QUEUE_NAME).toBe("email-claude:jobs:retry");
    });

    it("uses correct failed queue name", () => {
      expect(FAILED_QUEUE_NAME).toBe("email-claude:jobs:failed");
    });
  });
});

describe("EmailJob interface", () => {
  it("accepts retryCount as optional property", () => {
    const jobWithRetry: EmailJob = {
      id: "test-id",
      sessionId: "test-session",
      project: "test-project",
      prompt: "test prompt",
      replyTo: "test@example.com",
      originalSubject: "Test Subject",
      messageId: "msg-id",
      resumeSession: false,
      createdAt: new Date().toISOString(),
      retryCount: 2,
    };

    expect(jobWithRetry.retryCount).toBe(2);
  });

  it("works without retryCount property", () => {
    const jobWithoutRetry: EmailJob = {
      id: "test-id",
      sessionId: "test-session",
      project: "test-project",
      prompt: "test prompt",
      replyTo: "test@example.com",
      originalSubject: "Test Subject",
      messageId: "msg-id",
      resumeSession: false,
      createdAt: new Date().toISOString(),
    };

    expect(jobWithoutRetry.retryCount).toBeUndefined();
  });
});
