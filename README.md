# Email-Driven Claude Code

Command Claude Code via email. Send a task, receive a PR link and preview URL in response.

## Architecture

```
Email → Resend Webhook → Deno Worker → Claude Code → GitHub PR → Email Reply
```

See [spec.md](./spec.md) for full design documentation.

## Quick Start

### Prerequisites

- Deno 2.x
- Redis
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

### Running

```bash
# Start the worker (processes jobs from Redis queue)
deno task start

# Development mode with watch
deno task dev

# Start webhook server (receives emails from Resend)
deno task webhook
```

## Project Structure

```
email-claude/
├── src/
│   ├── services/
│   │   └── claude-code.ts    # Claude CLI wrapper
│   ├── handlers/
│   │   └── email-job.ts      # Email job processor (TODO)
│   ├── worker.ts             # Redis queue consumer
│   ├── webhook.ts            # Resend webhook handler (TODO)
│   ├── session.ts            # SQLite session manager (TODO)
│   └── mailer.ts             # Email reply composer (TODO)
├── db/
│   └── sessions.db           # SQLite database
├── logs/
│   └── jobs/                 # Per-job output logs
├── deno.json
├── spec.md                   # Full specification
└── README.md
```

## Reused Code

The following was adapted from `patch-workbench-laravel/deno-worker/`:

| File | Source | Changes |
|------|--------|---------|
| `src/services/claude-code.ts` | `deno-worker/services/claude-code.ts` | Added `autoApprove` option for `--yes` flag |
| `src/worker.ts` | `deno-worker/worker.ts` | Replaced Laravel callbacks with email job structure |

## Implementation Status

### Phase 1: Basic Flow (MVP)
- [ ] Resend inbound webhook
- [ ] Single project support
- [ ] New sessions only (no resume)
- [ ] Plain text replies
- [ ] Manual PR creation

### Phase 2: Sessions & Threading
- [ ] Subject-based session tracking
- [ ] `claude --resume` integration
- [ ] Proper email threading (In-Reply-To headers)
- [ ] SQLite session storage

### Phase 3: Polish
- [ ] HTML email replies
- [ ] Preview deployment URL extraction
- [ ] Attachment handling
- [ ] Error handling & retry logic
