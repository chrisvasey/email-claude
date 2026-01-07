# Email-Driven Claude Code

**A system for commanding Claude Code via email, receiving PRs and preview links in response.**

## Overview

Instead of SSH-ing into a VPS from your phone to interact with Claude Code, this approach uses email as the interface. Send an email describing what you want built or changed, and receive a reply with what was done, a PR link, and a preview deployment URL.

```
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Email     │────▶│  Resend Inbound │────▶│  VPS Webhook     │
│   Client    │     │  (MX Records)   │     │  Handler         │
└─────────────┘     └─────────────────┘     └────────┬─────────┘
                                                     │
                                                     ▼
┌─────────────┐     ┌─────────────────┐     ┌──────────────────┐
│   Reply     │◀────│  Resend Send    │◀────│  Job Runner      │
│   Email     │     │  API            │     │  (Bun Scripts)   │
└─────────────┘     └─────────────────┘     └────────┬─────────┘
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │  Claude Code     │
                                            │  (--yes mode)    │
                                            └────────┬─────────┘
                                                     │
                                                     ▼
                                            ┌──────────────────┐
                                            │  GitHub PR +     │
                                            │  Preview Deploy  │
                                            └──────────────────┘
```

## Key Design Decisions

### Session Per Subject Line

The email subject acts as a session identifier. All replies to the same thread continue the same Claude Code session, enabling multi-turn conversations:

```
Subject: projectname - Add dark mode toggle
────────────────────────────────────────────
Email 1: "Add a dark mode toggle to the settings page"
  └── Claude works, creates PR, replies with link

Email 2 (reply): "Actually make it persist to localStorage"
  └── Claude resumes session, updates PR, replies

Email 3 (reply): "Looks good, merge it"
  └── Claude merges PR, replies with confirmation
```

### Project Routing

The "To" address determines which project to work on:

- `webapp@code.patch.agency` → `/projects/webapp`
- `mobile-app@code.patch.agency` → `/projects/mobile-app`
- `client-site@code.patch.agency` → `/projects/client-site`

## Components to Build

### 1. Inbound Email Handler (Webhook)

**Location:** VPS running Deno

**Responsibilities:**
- Receive webhook POST from Resend
- Validate webhook signature (security)
- Parse sender, subject, body, attachments
- Extract project name from "to" address
- Generate/lookup session ID from subject line hash
- Queue job for processing

```typescript
// POST /webhook/email
interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments: Attachment[];
  headers: Record<string, string>;
}
```

### 2. Session Manager

**Responsibilities:**
- Map subject lines to Claude Code session IDs
- Store session state (project path, branch name, PR number)
- Handle session resumption with `claude --resume`

```typescript
interface Session {
  id: string;
  subjectHash: string;
  project: string;
  branchName: string;
  prNumber?: number;
  createdAt: Date;
  lastActivity: Date;
}
```

**Storage:** SQLite file on VPS (simple, no external deps)

### 3. Job Queue Integration

**Leverages:** Your existing Deno job queue scripts

**Job payload:**
```typescript
interface ClaudeJob {
  sessionId: string;
  project: string;
  prompt: string;
  replyTo: string;        // sender email
  originalSubject: string;
  resumeSession: boolean;
  attachments?: string[]; // paths to saved attachments
}
```

### 4. Claude Code Runner

**Responsibilities:**
- Execute Claude Code in project directory
- Capture output (summary, file changes, PR URL)
- Handle errors gracefully
- Create/update PRs via `gh` CLI

```bash
# New session
cd /projects/$PROJECT
git checkout -b email/$SESSION_ID
claude -p "$PROMPT" --yes --output-format json

# Resume session  
claude --resume $SESSION_ID -p "$PROMPT" --yes --output-format json
```

### 5. Reply Composer

**Responsibilities:**
- Format Claude's output into readable email
- Include PR link, preview link, summary
- Attach relevant screenshots if available
- Send via Resend API

```typescript
interface EmailReply {
  to: string;
  subject: string;  // Re: original subject
  inReplyTo: string; // Message-ID header for threading
  text: string;
  html: string;
}
```

## Infrastructure Requirements

### VPS Setup

- **OS:** Ubuntu 22.04+
- **Runtime:** Bun 1.x
- **Dependencies:**
  - Claude Code CLI (authenticated)
  - GitHub CLI (`gh`) authenticated
  - Git configured with SSH keys
- **Storage:** 50GB+ for project repos
- **Memory:** 4GB+ recommended

### Resend Configuration

1. **Inbound domain:** `code.patch.agency` (or subdomain)
2. **MX records:** Point to Resend's inbound servers
3. **Webhook URL:** `https://your-vps.com/webhook/email`
4. **Webhook signing secret:** For validation

### GitHub Setup

- GitHub App or PAT with repo access
- Webhook for PR status updates (optional, for deployment URLs)

### Preview Deployments

Options:
- **Vercel:** Auto-deploys on PR, provides preview URL
- **Netlify:** Same as Vercel
- **Coolify:** Self-hosted option on same VPS
- **Custom:** Simple static file server per branch

## Security Considerations

### Authentication

| Method | Pros | Cons |
|--------|------|------|
| Sender allowlist | Simple, effective | Can't add new users easily |
| DKIM verification | Proves sender domain | Doesn't prove individual |
| Secret in subject | Works anywhere | Ugly, can leak in forwards |
| GPG signed emails | Most secure | Complex setup |

**Recommendation:** Start with sender allowlist (your email + Grace's), add webhook signature verification from Resend.

### Rate Limiting

- Max N emails per hour per sender
- Max concurrent Claude jobs
- Timeout long-running jobs (30 min default)

### Sandboxing

- Each project in its own directory
- Consider Docker containers per job (overkill for personal use)
- Never run arbitrary shell commands from email body

## Pros and Cons

### Pros

| Benefit | Details |
|---------|---------|
| **Universal client** | Works from any email app, any device, any OS |
| **Async by design** | Perfect for "fire and forget" tasks |
| **Built-in threading** | Email clients handle conversation history |
| **No VPN needed** | No Tailscale, no port forwarding |
| **Offline composition** | Write emails on plane, send when connected |
| **Attachments** | Send images, docs, specs directly |
| **Audit trail** | Full history in your inbox |
| **Delegation ready** | Forward to team members, CC stakeholders |
| **Low friction** | No app to install, no terminal to navigate |

### Cons

| Drawback | Details |
|----------|---------|
| **Not real-time** | Can't watch Claude work, no immediate feedback |
| **Email latency** | 5-30 second delays each direction |
| **No intervention** | Can't stop Claude mid-task if it's going wrong |
| **Debugging harder** | Can't inspect terminal output live |
| **Attachment limits** | Large files may not work |
| **Spam risk** | Need good filtering to avoid noise |
| **Context limits** | Long threads may exceed token limits |
| **Security surface** | Email is inherently less secure than SSH |

### When Email Works Best

✅ Small, well-defined tasks ("Add a contact form to the homepage")  
✅ Bug fixes with clear reproduction steps  
✅ Content updates ("Update the pricing to £99/month")  
✅ Feature requests while traveling  
✅ Tasks you'd otherwise forget  

### When SSH is Better

❌ Complex debugging sessions  
❌ Exploratory work ("Let's try a few approaches")  
❌ Anything requiring back-and-forth iteration  
❌ Time-sensitive fixes  
❌ Large refactors needing oversight  

## Email Format Conventions

### Subject Line

```
{project} - {task description}
```

Examples:
- `webapp - Add newsletter signup form`
- `api - Fix authentication timeout bug`
- `docs - Update deployment guide`

### Body Structure

```
{main prompt}

---
Context: {optional context}
Branch: {optional specific branch to base off}
Priority: {optional: high/normal/low}
```

### Special Commands (in subject)

- `[merge]` - Merge the current PR
- `[close]` - Close PR without merging
- `[status]` - Get current status without running Claude

## Response Format

```
Subject: Re: webapp - Add newsletter signup form

## Summary
Added a newsletter signup form to the homepage footer with email 
validation and Resend integration.

## Changes
- Created `components/NewsletterForm.tsx`
- Added form to `app/page.tsx`  
- Added `/api/subscribe` endpoint
- Updated environment variables

## Links
- PR: https://github.com/patch/webapp/pull/42
- Preview: https://webapp-pr-42.vercel.app
- Branch: `email/abc123`

## Claude's Notes
The form uses your existing Resend API key from env. I added basic 
rate limiting but you may want to add CAPTCHA for production.

---
Reply to this email to continue the conversation.
Approximate tokens used: 12,450
```

## File Structure

```
email-claude/
├── src/
│   ├── webhook.ts          # Resend webhook handler
│   ├── session.ts          # Session management
│   ├── queue.ts            # Job queue (Redis BLPOP)
│   ├── runner.ts           # Claude Code execution
│   ├── mailer.ts           # Reply composition & sending
│   └── config.ts           # Environment config
├── db/
│   └── sessions.db         # SQLite database (bun:sqlite)
├── projects/               # Cloned project repos
│   ├── webapp/
│   ├── mobile-app/
│   └── client-site/
├── logs/
│   └── jobs/               # Per-job output logs
├── package.json
└── .env
```

## Implementation Phases

### Phase 1: Basic Flow (MVP) - COMPLETE
- [x] Resend inbound webhook
- [x] Single project support
- [x] Session tracking with SQLite
- [x] Plain text replies
- [x] Auto PR creation via `gh` CLI

### Phase 2: Sessions & Threading - COMPLETE
- [x] Subject-based session tracking (via subject hash)
- [x] Proper email threading (In-Reply-To headers)
- [x] SQLite session storage
- [x] PR body contains original email text
- [x] Follow-up emails add PR comments
- [x] Atomic commits via system instructions

### Phase 3: Polish
- [ ] `claude --resume` integration
- [ ] Preview deployment URL extraction
- [ ] Attachment handling (images → Claude vision)
- [ ] Error handling & retry logic
- [ ] Special commands ([merge], [close], [status])

### Phase 4: Nice-to-haves
- [ ] Web dashboard for monitoring
- [ ] Slack/Discord notifications
- [ ] Cost tracking per session
- [ ] Multiple user support

## Environment Variables

```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=email_claude_

# Resend
RESEND_API_KEY=re_xxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxx
RESEND_FROM_EMAIL=claude@code.patch.agency

# GitHub
# Owner/org for auto-cloning: email-claude@domain -> github.com/GITHUB_OWNER/email-claude
GITHUB_OWNER=chrisvasey

# Security
ALLOWED_SENDERS=chris@patch.agency,grace@patch.agency

# Paths
PROJECTS_DIR=/home/claude/projects
SESSIONS_DB=/home/claude/db/sessions.db

# Server
WEBHOOK_PORT=8080

# Development
DEV_MODE=false
```

## Docker Deployment

The service can run in Docker while storing project repos on the host filesystem.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         VPS Host                             │
├─────────────────────────────────────────────────────────────┤
│  ~/.ssh/          (SSH keys for git)                        │
│  ~/.claude/       (Claude Code auth)                        │
│  ~/.config/gh/    (GitHub CLI auth)                         │
│  /projects/       (Cloned repos - persists on host)         │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                   Docker Compose                      │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐          │   │
│  │  │ webhook  │  │  worker  │  │  redis   │          │   │
│  │  │ :8080    │  │          │  │  :6379   │          │   │
│  │  └────┬─────┘  └────┬─────┘  └──────────┘          │   │
│  │       │             │                               │   │
│  │       └─────────────┴───── mounts ─────────────────│   │
│  └─────────────────────────────────────────────────────┘   │
│                            │                                │
│                            ▼                                │
│              /projects/email-claude/                        │
│              /projects/webapp/                              │
│              /projects/api/                                 │
└─────────────────────────────────────────────────────────────┘
```

### Auto-Clone Behavior

When an email arrives for a project that doesn't exist locally:

1. Extract project name from recipient: `email-claude@code.patch.agency` → `email-claude`
2. Build clone URL: `git@github.com:${GITHUB_OWNER}/email-claude.git`
3. Clone to `${PROJECTS_DIR}/email-claude`
4. Continue with normal job processing

### Volume Mounts

| Host Path | Container Path | Purpose |
|-----------|----------------|---------|
| `${PROJECTS_DIR}` | `/projects` | Git repos (read/write) |
| `~/.ssh` | `/root/.ssh` | SSH keys for git (read-only) |
| `~/.claude` | `/root/.claude` | Claude Code auth (read-only) |
| `~/.config/gh` | `/root/.config/gh` | GitHub CLI auth (read-only) |
| `./db` | `/app/db` | SQLite database (read/write) |

### Quick Start

```bash
# 1. Copy environment file
cp .env.example .env
# Edit .env with your values

# 2. Start services
docker compose up -d

# 3. Check logs
docker compose logs -f worker
```

### VPS Setup Checklist

Before running Docker:

- [ ] SSH keys configured (`~/.ssh/id_rsa` or similar)
- [ ] GitHub CLI authenticated (`gh auth login`)
- [ ] Claude Code authenticated (`claude auth`)
- [ ] Projects directory exists (`mkdir -p /home/claude/projects`)
- [ ] Firewall allows port 8080 (or your webhook port)

## Prior Art & References

- [doom-coding](https://github.com/rberg27/doom-coding) - Original "vibe code from phone" guide
- [HN Discussion](https://news.ycombinator.com/item?id=46517458) - Where email idea originated
- [miranda](https://github.com/cloud-atlas-ai/miranda) - Telegram bot approach (similar concept)
- [Resend Inbound](https://resend.com/docs/dashboard/webhooks/inbound-emails) - Email webhook docs

## Open Questions

1. **Session expiry:** How long to keep sessions active? 24h? 7d? Never?
2. **Branch cleanup:** Auto-delete branches after merge? Or keep for reference?
3. **Cost visibility:** Include API costs in reply? Or separate daily summary?
4. **Failure handling:** Retry failed jobs? Alert via separate channel?
5. **Multi-repo tasks:** Support tasks spanning multiple projects?

---

*This is a fun project. The HN commenter was right that it won't replace SSH for serious work, but for "I'm on a beach and just thought of a quick fix" scenarios, email hits different.*

---

## Adaptation Notes (from patch-workbench-laravel)

This section documents what was adapted from `patch-workbench-laravel/deno-worker/` for Bun.

### Ported Files

| Source | Destination | Changes |
|--------|-------------|---------|
| `deno-worker/services/claude-code.ts` | `src/services/claude-code.ts` | `Deno.Command` → `Bun.spawn`, added `autoApprove` |
| `deno-worker/worker.ts` | `src/worker.ts` | `Deno.env` → `process.env`, email job structure |
| `deno-worker/deno.json` | `package.json` | Bun scripts + npm dependencies |

### API Changes (Deno → Bun)

| Deno | Bun |
|------|-----|
| `Deno.Command` | `Bun.spawn` |
| `Deno.env.get()` | `process.env` |
| `Deno.serve()` | `Bun.serve()` |
| `@db/sqlite` (JSR) | `bun:sqlite` (built-in, faster) |
| `Deno.addSignalListener` | `process.on("SIGINT", ...)` |

### ClaudeCodeService Changes

```typescript
// Bun subprocess API
const proc = Bun.spawn(["claude", ...args], {
  cwd: this.options.cwd,
  stdout: "pipe",
  stderr: "pipe",
});

// Read streaming output
const reader = proc.stdout.getReader();
```

**Usage for email automation:**
```typescript
const service = new ClaudeCodeService({
  cwd: `/projects/${projectName}`,
  sessionId: subjectHash,
  resumeSession: hasExistingSession,
  autoApprove: true, // --yes flag for unattended operation
});
```

### Worker Changes

The Redis BLPOP pattern is identical. Key differences:

| Original (Laravel) | Email Version |
|--------------------|---------------|
| Fetches job via HTTP to Laravel | Fetches from SQLite |
| Updates status via HTTP callback | Sends email reply |
| `chat_id`, `user_id` fields | `replyTo`, `messageId` fields |
| WebSocket broadcasting | No real-time needed |

### Files Completed

- [x] `src/webhook.ts` - Resend inbound webhook (`Bun.serve`)
- [x] `src/session.ts` - SQLite session manager (`bun:sqlite`)
- [x] `src/mailer.ts` - Resend email sender
- [x] `src/handlers/email-job.ts` - Email job processor
- [x] `src/config.ts` - Environment configuration
- [x] `src/git.ts` - Git/GitHub CLI utilities
- [x] `src/prompts.ts` - Prompt template loader
- [x] `prompts/system.md` - System instructions for atomic commits

### Implementation Checklist

**Phase 1 - MVP:** COMPLETE
- [x] Port `ClaudeCodeService` to Bun APIs
- [x] Port Redis BLPOP worker to Bun
- [x] Create `package.json` with dependencies
- [x] Create `src/webhook.ts` - HTTP server for Resend webhooks
- [x] Create `src/session.ts` - SQLite session CRUD
- [x] Create `src/handlers/email-job.ts` - Wire up ClaudeCodeService
- [x] Create `src/mailer.ts` - Send replies via Resend API
- [x] Create `src/git.ts` - Git/GitHub CLI utilities
- [x] Create `src/config.ts` - Environment configuration

**Phase 2 - Sessions:** COMPLETE
- [x] Implement subject line → session ID hashing
- [x] PR body contains original email text
- [x] Follow-up emails add comments to existing PR
- [x] Atomic commits via `prompts/system.md` instructions

**Phase 3 - Polish:**
- [ ] Pass `--resume` flag for multi-turn conversations
- [ ] Store Claude session ID after first run
- [ ] Parse Claude output for preview URLs
- [ ] Handle attachments (save to disk, pass to Claude)
- [ ] Special commands ([merge], [close], [status])
