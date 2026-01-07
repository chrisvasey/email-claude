/**
 * Deno Worker for Email-Driven Claude Code
 *
 * This worker connects to Redis via BLPOP to efficiently wait for new jobs
 * and processes them using the Claude Code CLI, sending email replies.
 *
 * Adapted from: deno-worker/worker.ts
 */

import { createClient } from "npm:redis@4";
// TODO: Import handlers when implemented
// import { handleEmailJob } from "./handlers/email-job.ts";

const REDIS_URL = Deno.env.get("REDIS_URL") || "redis://localhost:6379";
const REDIS_PREFIX = Deno.env.get("REDIS_PREFIX") || "email_claude_";
const QUEUE_NAME = `${REDIS_PREFIX}jobs:pending`;

// Email-specific job interface (replaces Laravel job structure)
interface EmailJob {
  id: string;
  sessionId: string;
  project: string;
  prompt: string;
  replyTo: string; // sender email
  originalSubject: string;
  messageId: string; // for In-Reply-To header
  resumeSession: boolean;
  attachments?: string[]; // paths to saved attachments
  createdAt: string;
}

// TODO: Replace with SQLite session storage
async function fetchJob(jobId: string): Promise<EmailJob | null> {
  // Placeholder: Will be implemented with SQLite
  console.log(`[Worker] TODO: Fetch job ${jobId} from SQLite`);
  return null;
}

// TODO: Implement email job processing
async function processJob(job: EmailJob): Promise<void> {
  console.log(`[Worker] Processing email job ${job.id}`);
  console.log(`[Worker] Project: ${job.project}`);
  console.log(`[Worker] Reply to: ${job.replyTo}`);
  console.log(`[Worker] Subject: ${job.originalSubject}`);

  // TODO: Implement with handleEmailJob handler
  // await handleEmailJob(job);
}

async function runWorker(): Promise<void> {
  console.log("[Worker] Starting Email-Claude Deno worker...");
  console.log(`[Worker] Redis URL: ${REDIS_URL}`);
  console.log(`[Worker] Queue: ${QUEUE_NAME}`);

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
        const jobId = result.element;
        console.log(`[Worker] Received job ID: ${jobId}`);

        try {
          const job = await fetchJob(jobId);
          if (job) {
            await processJob(job);
          } else {
            console.error(`[Worker] Job ${jobId} not found`);
          }
        } catch (error) {
          console.error(`[Worker] Error processing job ${jobId}:`, error);
          // TODO: Implement error handling (send error email, update job status)
        }
      }
    } catch (error) {
      console.error("[Worker] Error in main loop:", error);
      // Back off on error
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

// Handle shutdown gracefully
Deno.addSignalListener("SIGINT", () => {
  console.log("[Worker] Received SIGINT, shutting down...");
  Deno.exit(0);
});

Deno.addSignalListener("SIGTERM", () => {
  console.log("[Worker] Received SIGTERM, shutting down...");
  Deno.exit(0);
});

// Start the worker
runWorker().catch((error) => {
  console.error("[Worker] Fatal error:", error);
  Deno.exit(1);
});
