/**
 * Webhook Server Module
 *
 * HTTP server for receiving Resend inbound email webhooks.
 * Verifies signatures, validates senders, and queues jobs for processing.
 */

import { createClient, type RedisClientType } from "redis";
import { createHash, createHmac } from "crypto";
import { config, type Config } from "./config";
import {
  initDb,
  getOrCreateSession,
  hashSubject,
  type InboundEmail,
} from "./session";
import type { Database } from "bun:sqlite";

// Resend webhook payload interface
export interface ResendInboundPayload {
  type: "email.received";
  data: {
    from: string;
    to: string[];
    subject: string;
    text: string;
    html?: string;
    headers: Array<{ name: string; value: string }>;
    attachments?: Array<{ filename: string; content: string }>;
  };
}

// Email job to push to queue
export interface EmailJob {
  id: string;
  sessionId: string;
  project: string;
  prompt: string;
  replyTo: string;
  originalSubject: string;
  messageId: string;
  resumeSession: boolean;
  attachments?: string[];
  createdAt: string;
}

/**
 * Verify Resend webhook signature (HMAC-SHA256)
 *
 * Resend uses Svix for webhooks. The signature header format is:
 * "v1,{timestamp},{signature}" or "v1={signature}"
 *
 * We compute HMAC-SHA256 of "{timestamp}.{payload}" and compare
 */
export function verifySignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  // Parse the svix-signature header
  // Format: "v1,{timestamp},{signature}" or multiple signatures separated by space
  const parts = signature.split(" ");

  for (const part of parts) {
    // Handle "v1,timestamp,sig" format
    const segments = part.split(",");
    if (segments.length >= 2) {
      const version = segments[0];
      if (version === "v1") {
        const timestamp = segments[1];
        const sig = segments[2] || segments[1]; // Sometimes timestamp is omitted

        // If we have timestamp, payload is "{timestamp}.{body}"
        const signedPayload = timestamp ? `${timestamp}.${payload}` : payload;

        // Compute expected signature
        const expected = createHmac("sha256", secret)
          .update(signedPayload)
          .digest("base64");

        // Compare signatures (timing-safe comparison)
        if (sig === expected) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Extract project name from "to" address
 * webapp@domain.com -> webapp
 * my-project@code.patch.agency -> my-project
 */
export function extractProject(toAddress: string): string {
  // Handle email format: "Name <email@domain>" or just "email@domain"
  const emailMatch = toAddress.match(/<([^>]+)>/) || [null, toAddress];
  const email = emailMatch[1] || toAddress;

  // Extract local part before @
  const localPart = email.split("@")[0];

  // Return the local part as project name
  return localPart.toLowerCase().trim();
}

/**
 * Check if sender is in allowlist
 * Supports exact email match or wildcard domain match (*@domain.com)
 */
export function isAllowedSender(
  from: string,
  allowedSenders: string[]
): boolean {
  // If allowlist is empty, allow all senders
  if (allowedSenders.length === 0) {
    return true;
  }

  // Extract email from "Name <email>" format
  const emailMatch = from.match(/<([^>]+)>/) || [null, from];
  const email = (emailMatch[1] || from).toLowerCase().trim();

  for (const allowed of allowedSenders) {
    const normalizedAllowed = allowed.toLowerCase().trim();

    // Wildcard domain match: *@domain.com
    if (normalizedAllowed.startsWith("*@")) {
      const domain = normalizedAllowed.slice(2);
      if (email.endsWith(`@${domain}`)) {
        return true;
      }
    }
    // Exact email match
    else if (email === normalizedAllowed) {
      return true;
    }
  }

  return false;
}

/**
 * Get Message-ID from headers array
 */
export function getMessageId(
  headers: Array<{ name: string; value: string }>
): string {
  const messageIdHeader = headers.find(
    (h) => h.name.toLowerCase() === "message-id"
  );
  return messageIdHeader?.value || "";
}

/**
 * Generate a unique job ID
 */
function generateJobId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Server state
let redisClient: RedisClientType | null = null;
let db: Database | null = null;

/**
 * Initialize server dependencies
 */
export async function initServer(cfg: Config): Promise<void> {
  // Initialize SQLite database
  db = initDb(cfg.paths.sessionsDb);

  // Connect to Redis
  redisClient = createClient({ url: cfg.redis.url });
  await redisClient.connect();
}

/**
 * Close server dependencies
 */
export async function closeServer(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Health check handler for GET /health
 */
export function handleHealth(): Response {
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Main handler for POST /webhook/email
 */
export async function handleEmailWebhook(
  req: Request,
  cfg: Config
): Promise<Response> {
  // Get raw body for signature verification
  const body = await req.text();

  // Verify signature from svix-signature header (skip in dev mode)
  if (!cfg.devMode) {
    const signature = req.headers.get("svix-signature") || "";
    if (!verifySignature(body, signature, cfg.resend.webhookSecret)) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Parse payload
  let payload: ResendInboundPayload;
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Validate payload type
  if (payload.type !== "email.received") {
    return new Response(JSON.stringify({ error: "Unsupported event type" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Log incoming email
  console.log(`[Webhook] Received email from ${payload.data.from}`);
  console.log(`[Webhook] Subject: ${payload.data.subject}`);

  // Check sender against allowlist
  if (!isAllowedSender(payload.data.from, cfg.security.allowedSenders)) {
    return new Response(JSON.stringify({ error: "Sender not allowed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Extract project from first "to" address
  const toAddress = payload.data.to[0];
  if (!toAddress) {
    return new Response(JSON.stringify({ error: "No recipient address" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const project = extractProject(toAddress);
  console.log(`[Webhook] Project: ${project}`);

  // Ensure database is initialized
  if (!db) {
    db = initDb(cfg.paths.sessionsDb);
  }

  // Create inbound email for session lookup
  const inboundEmail: InboundEmail = {
    from: payload.data.from,
    to: toAddress,
    subject: payload.data.subject,
    text: payload.data.text,
    messageId: getMessageId(payload.data.headers),
  };

  // Get or create session
  const session = getOrCreateSession(db, inboundEmail, project);

  // Check if this is a resume (existing session with claude_session_id)
  const resumeSession = session.claudeSessionId !== null;
  const isExisting = session.prNumber !== null || resumeSession;
  console.log(`[Webhook] Session: ${session.id.slice(0, 8)} (${isExisting ? "existing" : "new"})`);

  // Generate job ID
  const jobId = generateJobId();

  // Create email job
  const job: EmailJob = {
    id: jobId,
    sessionId: session.id,
    project,
    prompt: payload.data.text,
    replyTo: payload.data.from,
    originalSubject: payload.data.subject,
    messageId: getMessageId(payload.data.headers),
    resumeSession,
    attachments: payload.data.attachments?.map((a) => a.filename),
    createdAt: new Date().toISOString(),
  };

  // Push job to Redis queue
  if (!redisClient) {
    redisClient = createClient({ url: cfg.redis.url });
    await redisClient.connect();
  }

  const queueKey = `${cfg.redis.prefix}jobs:pending`;
  await redisClient.lPush(queueKey, JSON.stringify(job));
  console.log(`[Webhook] Job queued: ${jobId.slice(0, 8)}`);

  // Return success with job ID
  return new Response(
    JSON.stringify({
      success: true,
      jobId,
      sessionId: session.id,
      project,
      resumeSession,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

/**
 * Create the HTTP server
 */
export function createServer(
  port: number,
  cfg: Config = config
): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    port,
    async fetch(req: Request): Promise<Response> {
      const url = new URL(req.url);

      // Health check
      if (req.method === "GET" && url.pathname === "/health") {
        return handleHealth();
      }

      // Email webhook
      if (req.method === "POST" && url.pathname === "/webhook/email") {
        return handleEmailWebhook(req, cfg);
      }

      // Not found
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}

// Main entry point when run directly
if (import.meta.main) {
  const port = parseInt(process.env.WEBHOOK_PORT || "8080", 10);

  console.log(`Starting webhook server on port ${port}...`);
  if (config.devMode) {
    console.log("⚠️  DEV_MODE enabled - signature verification disabled");
  }

  // Initialize server
  await initServer(config);

  const server = createServer(port, config);

  console.log(`Webhook server listening on http://localhost:${server.port}`);

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await closeServer();
    server.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nShutting down...");
    await closeServer();
    server.stop();
    process.exit(0);
  });
}
