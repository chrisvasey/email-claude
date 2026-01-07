/**
 * Bun Worker for Email-Driven Claude Code
 *
 * This worker connects to Redis via BLPOP to efficiently wait for new jobs
 * and processes them using the Claude Code CLI, sending email replies.
 *
 * Ported from: deno-worker/worker.ts (Deno → Bun)
 */

import { createClient } from "redis";
import { Database } from "bun:sqlite";
import { handleEmailJob, type JobContext } from "./handlers/email-job";
import { initDb, getSession, type Session } from "./session";
import { config } from "./config";
import type { EmailJob } from "./mailer";

const REDIS_URL = config.redis.url;
const REDIS_PREFIX = config.redis.prefix;
const QUEUE_NAME = `${REDIS_PREFIX}jobs:pending`;

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
 * Process an email job
 */
async function processJob(job: EmailJob): Promise<void> {
  console.log(`[Worker] Processing email job ${job.id}`);
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
  };

  // Handle the job
  await handleEmailJob(job, session, ctx);
}

async function runWorker(): Promise<void> {
  console.log("[Worker] Starting Email-Claude Bun worker...");
  console.log(`[Worker] Redis URL: ${REDIS_URL}`);
  console.log(`[Worker] Queue: ${QUEUE_NAME}`);
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
          console.error(`[Worker] Error processing job ${job.id}:`, error);
          // Error email is sent by handleEmailJob, just log here
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
