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

Create a `.env` file:

```bash
# Redis
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=email_claude_

# Resend
RESEND_API_KEY=re_xxxxx
RESEND_WEBHOOK_SECRET=whsec_xxxxx
RESEND_FROM_EMAIL=claude@code.patch.agency

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
│   └── config.ts             # Environment configuration
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
- [x] Full test coverage (105 tests)

### Phase 2: Sessions & Threading
- [x] Subject-based session tracking (via subject hash)
- [ ] `claude --resume` integration
- [x] Proper email threading (In-Reply-To headers)
- [x] SQLite session storage

### Phase 3: Polish
- [ ] HTML email replies with syntax highlighting
- [ ] Preview deployment URL extraction
- [ ] Attachment handling (images to Claude vision)
- [ ] Error handling & retry logic
