# Implementation Plan

A step-by-step guide to building email-driven Claude Code with **Bun**.

**Status:** Phase 1 & 2 COMPLETE (106 tests passing)

---

## Phase 1: MVP (End-to-end Flow) - COMPLETE

**Goal:** Send an email → Claude runs → Receive reply with results.

### Step 1.1: Config Module
**File:** `src/config.ts`

```typescript
export const config = {
  redis: {
    url: process.env.REDIS_URL || "redis://localhost:6379",
    prefix: process.env.REDIS_PREFIX || "email_claude_",
  },
  resend: {
    apiKey: process.env.RESEND_API_KEY!,
    webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    fromEmail: process.env.RESEND_FROM_EMAIL!,
  },
  security: {
    allowedSenders: (process.env.ALLOWED_SENDERS || "").split(","),
  },
  paths: {
    projectsDir: process.env.PROJECTS_DIR || "./projects",
    sessionsDb: process.env.SESSIONS_DB || "./db/sessions.db",
  },
};
```

**Test:** `bun run src/config.ts` prints config (with secrets masked).

---

### Step 1.2: Webhook Server
**File:** `src/webhook.ts`

**Endpoints:**
- `POST /webhook/email` - Receive inbound emails from Resend
- `GET /health` - Health check

**Flow:**
```
1. Receive POST from Resend
2. Verify webhook signature (HMAC)
3. Parse email: from, to, subject, body
4. Check sender against allowlist
5. Extract project from "to" address (webapp@domain → webapp)
6. Push job ID to Redis queue
7. Return 200 OK
```

**Key functions:**
```typescript
function verifyWebhookSignature(payload: string, signature: string): boolean
function parseInboundEmail(body: unknown): InboundEmail
function extractProject(toAddress: string): string
function isAllowedSender(from: string): boolean
async function queueJob(job: EmailJob): Promise<string>
```

**Test:**
```bash
# Start webhook server
bun run webhook

# Send test request
curl -X POST http://localhost:8080/webhook/email \
  -H "Content-Type: application/json" \
  -d '{"from":"chris@patch.agency","to":"webapp@code.patch.agency","subject":"Test","text":"Hello"}'
```

---

### Step 1.3: Mailer Module
**File:** `src/mailer.ts`

**Functions:**
```typescript
import { Resend } from "resend";

const resend = new Resend(config.resend.apiKey);

interface EmailReply {
  to: string;
  subject: string;
  inReplyTo?: string;
  text: string;
  html?: string;
}

export async function sendReply(reply: EmailReply): Promise<void> {
  await resend.emails.send({
    from: config.resend.fromEmail,
    to: reply.to,
    subject: reply.subject,
    text: reply.text,
    html: reply.html,
    headers: reply.inReplyTo ? { "In-Reply-To": reply.inReplyTo } : undefined,
  });
}

export function formatSuccessReply(result: ClaudeResult): EmailReply { ... }
export function formatErrorReply(error: Error): EmailReply { ... }
```

**Test:** Send a test email to yourself.

---

### Step 1.4: Email Job Handler
**File:** `src/handlers/email-job.ts`

**Flow:**
```
1. Receive job from worker
2. cd to project directory
3. git checkout -b email/{sessionId} (or switch to existing branch)
4. Run ClaudeCodeService with prompt
5. Collect response
6. Send email reply
7. Mark job complete
```

**Code structure:**
```typescript
import { ClaudeCodeService } from "../services/claude-code.ts";
import { sendReply, formatSuccessReply, formatErrorReply } from "../mailer.ts";

export async function handleEmailJob(job: EmailJob): Promise<void> {
  const projectPath = `${config.paths.projectsDir}/${job.project}`;

  // Git setup
  await setupBranch(projectPath, job.sessionId);

  // Run Claude
  const service = new ClaudeCodeService({
    cwd: projectPath,
    autoApprove: true,
    sessionId: job.sessionId,
    resumeSession: job.resumeSession,
  });

  const result = await runClaude(service, job.prompt);

  // Send reply
  const reply = formatSuccessReply(result);
  reply.to = job.replyTo;
  reply.subject = `Re: ${job.originalSubject}`;
  reply.inReplyTo = job.messageId;

  await sendReply(reply);
}
```

---

### Step 1.5: Wire Up Worker
**File:** `src/worker.ts` (update existing)

**Changes:**
```typescript
import { handleEmailJob } from "./handlers/email-job.ts";

// In processJob():
async function processJob(job: EmailJob): Promise<void> {
  console.log(`[Worker] Processing email job ${job.id}`);
  await handleEmailJob(job);
}
```

---

### Step 1.6: End-to-End Test

```bash
# Terminal 1: Start Redis
redis-server

# Terminal 2: Start worker
bun run start

# Terminal 3: Start webhook
bun run webhook

# Terminal 4: Simulate email
curl -X POST http://localhost:8080/webhook/email \
  -H "Content-Type: application/json" \
  -d '{
    "from": "chris@patch.agency",
    "to": "test-project@code.patch.agency",
    "subject": "test-project - Add hello world",
    "text": "Create a hello.txt file with Hello World",
    "headers": {"message-id": "<test123@mail.com>"}
  }'
```

**Expected:** Email reply with Claude's response.

---

## Phase 2: Session Management - COMPLETE

**Goal:** Reply to an email thread → Claude resumes the session.

**Implemented:**
- Subject-based session tracking via hash
- PR body contains original email text
- Follow-up emails add comments to existing PR
- Atomic commits via `prompts/system.md` instructions

### Step 2.1: SQLite Session Storage
**File:** `src/session.ts`

**Schema:**
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  subject_hash TEXT UNIQUE NOT NULL,
  project TEXT NOT NULL,
  branch_name TEXT NOT NULL,
  claude_session_id TEXT,
  pr_number INTEGER,
  created_at TEXT NOT NULL,
  last_activity TEXT NOT NULL
);

CREATE INDEX idx_subject_hash ON sessions(subject_hash);
```

**Functions:**
```typescript
import { Database } from "bun:sqlite";

const db = new Database(config.paths.sessionsDb);

export function hashSubject(subject: string): string {
  // Normalize: strip "Re:", "Fwd:", trim, lowercase
  const normalized = subject.replace(/^(Re|Fwd):\s*/gi, "").trim().toLowerCase();
  const hash = new Bun.CryptoHasher("sha256").update(normalized).digest("hex");
  return hash.slice(0, 12);
}

export function getSession(subjectHash: string): Session | null
export function createSession(session: Session): void
export function updateSession(id: string, updates: Partial<Session>): void
export function getOrCreateSession(email: InboundEmail): Session
```

---

### Step 2.2: Update Webhook
**File:** `src/webhook.ts`

```typescript
// After parsing email:
const subjectHash = hashSubject(email.subject);
const session = getOrCreateSession({
  subjectHash,
  project: extractProject(email.to),
  ...
});

const job: EmailJob = {
  sessionId: session.id,
  resumeSession: session.claudeSessionId !== null,
  ...
};
```

---

### Step 2.3: Update Handler
**File:** `src/handlers/email-job.ts`

```typescript
// After Claude completes:
if (!job.resumeSession) {
  // First run - save Claude's session ID
  const claudeSessionId = extractClaudeSessionId(result);
  updateSession(job.sessionId, { claudeSessionId });
}
```

---

### Step 2.4: Test Session Resume

```bash
# Email 1: Start task
curl ... -d '{"subject": "webapp - Add dark mode", "text": "Add dark mode toggle"}'

# Check SQLite
sqlite3 db/sessions.db "SELECT * FROM sessions"

# Email 2: Continue (reply)
curl ... -d '{"subject": "Re: webapp - Add dark mode", "text": "Also persist to localStorage"}'

# Verify Claude resumed (check logs for --resume flag)
```

---

## Phase 3: Git & PR Integration - COMPLETE

**Goal:** Auto-create branches and PRs.

### Step 3.1: Git Utilities
**File:** `src/git.ts`

```typescript
export async function ensureBranch(projectPath: string, branchName: string): Promise<void> {
  // git fetch
  // git checkout -b {branch} OR git checkout {branch}
}

export async function commitAndPush(projectPath: string, message: string): Promise<void> {
  // git add -A
  // git commit -m {message}
  // git push -u origin {branch}
}

export async function createPR(projectPath: string, title: string, body: string): Promise<number> {
  // gh pr create --title --body
  // Return PR number
}

export async function getPRUrl(projectPath: string, prNumber: number): Promise<string> {
  // gh pr view {number} --json url
}
```

---

### Step 3.2: Update Handler for PR Creation
**File:** `src/handlers/email-job.ts`

```typescript
// After Claude completes:
await commitAndPush(projectPath, `Email task: ${job.originalSubject}`);

if (!session.prNumber) {
  const prNumber = await createPR(projectPath, job.originalSubject, job.prompt);
  updateSession(job.sessionId, { prNumber });
}

const prUrl = await getPRUrl(projectPath, session.prNumber);
// Include prUrl in reply
```

---

## Phase 4: Polish - TODO

### Remaining Items
- [ ] `claude --resume` integration for multi-turn conversations
- [ ] Preview deployment URL extraction
- [ ] Attachment handling (images to Claude vision)
- [ ] Error handling & retry logic
- [ ] Special commands ([merge], [close], [status])

### Step 4.1: Error Handling & Retries
**File:** `src/handlers/email-job.ts`

```typescript
const MAX_RETRIES = 2;

export async function handleEmailJob(job: EmailJob, attempt = 1): Promise<void> {
  try {
    // ... existing logic
  } catch (error) {
    if (attempt < MAX_RETRIES && isRetryable(error)) {
      console.log(`[Handler] Retry ${attempt + 1}/${MAX_RETRIES}`);
      await delay(5000 * attempt);
      return handleEmailJob(job, attempt + 1);
    }

    // Send error email
    await sendReply(formatErrorReply(error, job));
    throw error;
  }
}
```

---

### Step 4.3: Special Commands
**File:** `src/commands.ts`

```typescript
export function parseCommand(subject: string): Command | null {
  if (subject.includes("[merge]")) return { type: "merge" };
  if (subject.includes("[close]")) return { type: "close" };
  if (subject.includes("[status]")) return { type: "status" };
  return null;
}
```

**Update webhook:**
```typescript
const command = parseCommand(email.subject);
if (command) {
  await handleCommand(command, session);
  return; // Skip Claude
}
```

---

## File Dependency Graph

```
config.ts (no deps)
    ↓
session.ts (config)
    ↓
mailer.ts (config, resend)
    ↓
git.ts (no deps, shell commands)
    ↓
services/claude-code.ts (no deps)
    ↓
handlers/email-job.ts (all above)
    ↓
worker.ts (handlers, config, session)
webhook.ts (config, session, queue)
```

---

## Implementation Order

| Order | File | Est. Lines | Depends On |
|-------|------|------------|------------|
| 1 | `src/config.ts` | ~30 | - |
| 2 | `src/session.ts` | ~80 | config |
| 3 | `src/mailer.ts` | ~60 | config |
| 4 | `src/webhook.ts` | ~120 | config, session |
| 5 | `src/handlers/email-job.ts` | ~100 | claude-code, mailer |
| 6 | Update `src/worker.ts` | ~20 | handlers |
| 7 | `src/git.ts` | ~80 | - |
| 8 | `src/commands.ts` | ~40 | - |
| 9 | `src/templates/*.html` | ~50 | - |

**Total:** ~580 lines of new code

---

## Deployment Checklist

- [ ] VPS with Bun installed (`curl -fsSL https://bun.sh/install | bash`)
- [ ] Redis running
- [ ] Claude Code CLI authenticated (`claude auth`)
- [ ] GitHub CLI authenticated (`gh auth login`)
- [ ] Git SSH keys configured
- [ ] Resend inbound domain configured
- [ ] MX records pointing to Resend
- [ ] Webhook URL accessible (HTTPS)
- [ ] Projects cloned to `PROJECTS_DIR`
- [ ] Environment variables set in `.env`
- [ ] Systemd services for worker + webhook
