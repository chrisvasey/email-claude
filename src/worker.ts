/**
 * Bun Worker for Email-Driven Claude Code
 *
 * This worker connects to Redis via BLPOP to efficiently wait for new jobs
 * and processes them using the Claude Code CLI, sending email replies.
 *
 * Features:
 * - Retry logic with exponential backoff (max 3 retries)
 * - Dead letter queue for permanently failed jobs
 * - Delayed retry queue using Redis sorted sets
 *
 * Ported from: deno-worker/worker.ts (Deno → Bun)
 */

import { createClient, type RedisClientType } from "redis";
import { Database } from "bun:sqlite";
import { handleEmailJob, type JobContext } from "./handlers/email-job";
import { initDb, type Session } from "./session";
import { config } from "./config";
import type { EmailJob } from "./mailer";
import { sendReply, formatErrorReply } from "./mailer";

const REDIS_URL = config.redis.url;
const REDIS_PREFIX = config.redis.prefix;
const QUEUE_NAME = `${REDIS_PREFIX}jobs:pending`;
const RETRY_QUEUE_NAME = `${REDIS_PREFIX}jobs:retry`;
const FAILED_QUEUE_NAME = `${REDIS_PREFIX}jobs:failed`;

const MAX_RETRIES = 3;
const RETRY_PROCESSOR_INTERVAL_MS = 1000; // Check retry queue every second

// Database instance
let db: Database | null = null;

/**
 * Get or initialize the database
 */
function getDb(): Database {
  if (!db) {
    db = initDb(config.paths.sessionsDb);
  }
  return db;
}

/**
 * Get session from database by ID
 */
function getSessionById(sessionId: string): Session | null {
  const database = getDb();
  const stmt = database.prepare(`
    SELECT
      id,
      subject_hash as subjectHash,
      project,
      branch_name as branchName,
      claude_session_id as claudeSessionId,
      pr_number as prNumber,
      created_at as createdAt,
      last_activity as lastActivity
    FROM sessions
    WHERE id = ?
  `);
  return stmt.get(sessionId) as Session | null;
}

/**
 * Calculate delay for retry with exponential backoff
 * Formula: 2^retryCount * 1000ms
 * Retry 0: 1s, Retry 1: 2s, Retry 2: 4s
 */
function calculateRetryDelay(retryCount: number): number {
  return Math.pow(2, retryCount) * 1000;
}

/**
 * Schedule a job for retry
 */
async function scheduleRetry(
  redis: RedisClientType,
  job: EmailJob,
  error: Error
): Promise<void> {
  const currentRetryCount = job.retryCount ?? 0;

  if (currentRetryCount >= MAX_RETRIES) {
    // Max retries exceeded, move to dead letter queue
    console.log(
      `[Worker] Job ${job.id} exceeded max retries (${MAX_RETRIES}), moving to failed queue`
    );
    const failedJob = {
      ...job,
      failedAt: new Date().toISOString(),
      lastError: error.message,
    };
    await redis.lPush(FAILED_QUEUE_NAME, JSON.stringify(failedJob));

    // Send final error email to user
    try {
      await sendReply(
        await formatErrorReply(
          new Error(
            `Job failed after ${MAX_RETRIES} retries. Last error: ${error.message}`
          ),
          job
        ),
        config.resend.fromEmail
      );
    } catch (emailError) {
      console.error(`[Worker] Failed to send final error email:`, emailError);
    }
    return;
  }

  // Schedule retry with exponential backoff
  const delay = calculateRetryDelay(currentRetryCount);
  const retryAt = Date.now() + delay;
  const retryJob: EmailJob = {
    ...job,
    retryCount: currentRetryCount + 1,
  };

  console.log(
    `[Worker] Scheduling retry ${currentRetryCount + 1}/${MAX_RETRIES} for job ${job.id} in ${delay}ms`
  );

  // Add to retry sorted set with score = timestamp when to retry
  await redis.zAdd(RETRY_QUEUE_NAME, {
    score: retryAt,
    value: JSON.stringify(retryJob),
  });
}

/**
 * Process jobs from the retry queue that are ready
 */
async function processRetryQueue(redis: RedisClientType): Promise<number> {
  const now = Date.now();

  // Get all jobs that are ready to be retried (score <= now)
  const readyJobs = await redis.zRangeByScore(RETRY_QUEUE_NAME, 0, now);

  if (readyJobs.length === 0) {
    return 0;
  }

  let movedCount = 0;

  for (const jobJson of readyJobs) {
    // Remove from retry queue
    const removed = await redis.zRem(RETRY_QUEUE_NAME, jobJson);

    if (removed > 0) {
      // Add to pending queue for processing
      await redis.rPush(QUEUE_NAME, jobJson);
      movedCount++;

      try {
        const job = JSON.parse(jobJson) as EmailJob;
        console.log(
          `[Worker] Moved job ${job.id} (retry ${job.retryCount}/${MAX_RETRIES}) from retry queue to pending`
        );
      } catch {
        console.log(`[Worker] Moved job from retry queue to pending`);
      }
    }
  }

  return movedCount;
}

/**
 * Process an email job
 */
async function processJob(job: EmailJob): Promise<void> {
  const retryInfo = job.retryCount ? ` (retry ${job.retryCount}/${MAX_RETRIES})` : "";
  console.log(`[Worker] Processing email job ${job.id}${retryInfo}`);
  console.log(`[Worker] Project: ${job.project}`);
  console.log(`[Worker] Reply to: ${job.replyTo}`);
  console.log(`[Worker] Subject: ${job.originalSubject}`);

  // Get session from database
  const session = getSessionById(job.sessionId);
  if (!session) {
    throw new Error(`Session ${job.sessionId} not found`);
  }

  // Create job context
  const ctx: JobContext = {
    db: getDb(),
    projectsDir: config.paths.projectsDir,
    fromEmail: config.resend.fromEmail,
    githubOwner: config.github.owner,
  };

  // Handle the job
  await handleEmailJob(job, session, ctx);
}

/**
 * Start the retry processor loop
 * This runs alongside the main job loop and checks for jobs ready to retry
 */
async function startRetryProcessor(redis: RedisClientType): Promise<void> {
  console.log("[Worker] Starting retry processor loop");

  while (true) {
    try {
      const movedCount = await processRetryQueue(redis);
      if (movedCount > 0) {
        console.log(`[Worker] Retry processor moved ${movedCount} job(s) to pending queue`);
      }
    } catch (error) {
      console.error("[Worker] Error in retry processor:", error);
    }

    await Bun.sleep(RETRY_PROCESSOR_INTERVAL_MS);
  }
}

async function runWorker(): Promise<void> {
  console.log("[Worker] Starting Email-Claude Bun worker...");
  console.log(`[Worker] Redis URL: ${REDIS_URL}`);
  console.log(`[Worker] Queue: ${QUEUE_NAME}`);
  console.log(`[Worker] Retry Queue: ${RETRY_QUEUE_NAME}`);
  console.log(`[Worker] Failed Queue: ${FAILED_QUEUE_NAME}`);
  console.log(`[Worker] Max Retries: ${MAX_RETRIES}`);
  console.log(`[Worker] Projects dir: ${config.paths.projectsDir}`);

  // Initialize database
  getDb();
  console.log("[Worker] Database initialized");

  const redis = createClient({ url: REDIS_URL });

  redis.on("error", (err) => {
    console.error("[Worker] Redis error:", err);
  });

  await redis.connect();
  console.log("[Worker] Connected to Redis");

  // Start retry processor in the background
  startRetryProcessor(redis as RedisClientType);

  console.log("[Worker] Waiting for jobs...");

  while (true) {
    try {
      // Block waiting for a job (BLPOP with 30s timeout)
      const result = await redis.blPop(QUEUE_NAME, 30);

      if (result) {
        // Parse job JSON from Redis (webhook pushes full job object)
        let job: EmailJob;
        try {
          job = JSON.parse(result.element);
        } catch {
          console.error(`[Worker] Invalid job JSON: ${result.element}`);
          continue;
        }

        console.log(`[Worker] Received job: ${job.id}`);

        try {
          await processJob(job);
          console.log(`[Worker] Job ${job.id} completed successfully`);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          console.error(`[Worker] Error processing job ${job.id}:`, err.message);

          // Schedule retry instead of dropping the job
          await scheduleRetry(redis as RedisClientType, job, err);
        }
      }
    } catch (error) {
      console.error("[Worker] Error in main loop:", error);
      // Back off on error
      await Bun.sleep(5000);
    }
  }
}

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("[Worker] Received SIGINT, shutting down...");
  if (db) {
    db.close();
  }
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("[Worker] Received SIGTERM, shutting down...");
  if (db) {
    db.close();
  }
  process.exit(0);
});

// Start the worker
runWorker().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  process.exit(1);
});

// Export for testing
export {
  calculateRetryDelay,
  scheduleRetry,
  processRetryQueue,
  processJob,
  MAX_RETRIES,
  RETRY_QUEUE_NAME,
  FAILED_QUEUE_NAME,
};
