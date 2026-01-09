# Email-Driven Claude Code

Command Claude Code via email. Send a task, receive a PR link and preview URL in response.

## Architecture

```
Email → Resend Webhook → Bun Worker → Claude Code → GitHub PR → Email Reply
```

See [spec.md](./spec.md) for full design documentation.

## Quick Start

### Prerequisites

- Bun 1.x (`curl -fsSL https://bun.sh/install | bash`)
- Redis (via Laravel Herd or standalone)
- Claude Code CLI (authenticated)
- GitHub CLI (`gh`) authenticated
- Resend account with inbound email configured

### Environment Variables

Create a `.env` file (see `.env.example`):

```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=email_claude_

# Resend
RESEND_API_KEY=re_xxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxx
RESEND_FROM_DOMAIN=code.patch.agency  # Responses sent from {project}@{domain}

# GitHub (for auto-cloning repos)
# email-claude@code.patch.agency -> github.com/GITHUB_OWNER/email-claude
GITHUB_OWNER=chrisvasey

# Security
ALLOWED_SENDERS=chris@patch.agency,grace@patch.agency

# Paths
PROJECTS_DIR=/home/claude/projects
SESSIONS_DB=./db/sessions.db
```

### Install Dependencies

```bash
bun install
```

### Running

```bash
# Start the worker (processes jobs from Redis queue)
bun run start

# Development mode with watch
bun run dev

# Start webhook server (receives emails from Resend)
bun run webhook
```

## Project Structure

```
email-claude/
├── src/
│   ├── services/
│   │   └── claude-code.ts    # Claude CLI wrapper (Bun.spawn)
│   ├── handlers/
│   │   └── email-job.ts      # Email job processor
│   ├── worker.ts             # Redis queue consumer
│   ├── webhook.ts            # Resend webhook handler (Bun.serve)
│   ├── session.ts            # SQLite session manager (bun:sqlite)
│   ├── mailer.ts             # Email reply composer (Resend API)
│   ├── git.ts                # Git/GitHub CLI utilities
│   ├── prompts.ts            # Prompt template loader
│   └── config.ts             # Environment configuration
├── prompts/
│   └── system.md             # System instructions for Claude (atomic commits)
├── db/
│   └── sessions.db           # SQLite database (created on first run)
├── package.json
├── spec.md                   # Full specification
└── README.md
```

## Reused Code

Ported from `patch-workbench-laravel/deno-worker/` (Deno → Bun):

| File | Source | Changes |
|------|--------|---------|
| `src/services/claude-code.ts` | `deno-worker/services/claude-code.ts` | `Deno.Command` → `Bun.spawn`, added `autoApprove` |
| `src/worker.ts` | `deno-worker/worker.ts` | `Deno.env` → `process.env`, email job structure |

## Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test src/config.test.ts
```

## Implementation Status

### Phase 1: Basic Flow (MVP) - Complete
- [x] Resend inbound webhook (`src/webhook.ts`)
- [x] Single project support
- [x] Session tracking with SQLite (`src/session.ts`)
- [x] Plain text email replies (`src/mailer.ts`)
- [x] Auto PR creation via `gh` CLI (`src/git.ts`)
- [x] Email job processing (`src/handlers/email-job.ts`)
- [x] Full test coverage (150 tests)

### Phase 2: Sessions & Threading - Complete
- [x] Subject-based session tracking (via subject hash)
- [x] Proper email threading (In-Reply-To headers)
- [x] SQLite session storage
- [x] PR body contains original email text
- [x] Follow-up emails add comments to existing PR
- [x] Atomic commits via system instructions (`prompts/system.md`)

### Phase 3: Polish - Complete
- [x] Auto-clone repos (`GITHUB_OWNER` config)
- [x] Docker deployment (`Dockerfile`, `docker-compose.yml`)
- [x] HTML email formatting with React Email
- [x] Error email response when sender not on whitelist
- [x] Email subject passed to Claude as context
- [x] GitHub Actions CI
- [x] Branch safety - always branch from main/master for new threads
- [x] `claude --resume` integration (session ID extracted and persisted)
- [x] Preview deployment URL extraction (vercel.app, netlify.app, etc.)
- [x] Attachment handling (saved to disk, paths passed to Claude)
- [x] Error handling & retry logic (exponential backoff, max 3 retries)
- [x] Special commands ([merge], [close], [status])
- [x] Dynamic from email - responses come from `{project}@{domain}` for thread continuity

## Docker Deployment

Run the service in Docker while storing repos on the host filesystem:

```bash
# 1. Copy and edit environment file
cp .env.example .env

# 2. Ensure auth is configured on host
# - SSH keys in ~/.ssh/
# - Claude Code: claude auth
# - GitHub CLI: gh auth login

# 3. Start services
docker compose up -d

# 4. Check logs
docker compose logs -f worker
```

### Volume Mounts

| Host | Container | Purpose |
|------|-----------|---------|
| `${PROJECTS_DIR}` | `/projects` | Git repos |
| `~/.ssh` | `/root/.ssh` | SSH keys (ro) |
| `~/.claude` | `/root/.claude` | Claude auth (ro) |
| `~/.config/gh` | `/root/.config/gh` | GitHub CLI (ro) |

### Auto-Clone

Projects are automatically cloned on first email:
- `email-claude@code.patch.agency` → clones `github.com/${GITHUB_OWNER}/email-claude`

No need to pre-clone repos!
