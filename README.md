# Email-Driven Claude Code

Command Claude Code via email. Send a task, receive a PR link and preview URL in response.

Perfect for quick tasks from your phone, on the go, or when you don't have terminal access.

## How It Works

```
Email → Resend Inbound → Webhook → Redis Queue → Worker → Claude Code → GitHub PR → Email Reply
```

1. **Resend Inbound** receives email via MX records on your domain
2. **Webhook** (`src/webhook.ts`) validates the signature and extracts project name from the recipient address
3. **Redis Queue** holds the job for processing
4. **Worker** (`src/worker.ts`) picks up jobs, manages sessions in SQLite, and spawns Claude Code
5. **Claude Code** runs with `--yes` flag for autonomous operation, creates commits and PRs via `gh` CLI
6. **Email Reply** sent via Resend API with PR link, preview URL, and summary

**The email address determines the project.** Send to `webapp@code.patch.agency` and Claude works on the `webapp` repo. Send to `api@code.patch.agency` and it works on the `api` repo.

Projects are auto-cloned from GitHub on first use - no setup required.

See [spec.md](./spec.md) for full design documentation.

## Example Workflow

### 1. Send an Email

```
To: webapp@code.patch.agency
From: chris@patch.agency
Subject: Add dark mode toggle

Add a dark mode toggle to the settings page.
Store the preference in localStorage and apply
it on page load.
```

### 2. Receive a Response

Claude processes your request, creates a PR, and replies:

```
From: webapp@code.patch.agency
Subject: Re: Add dark mode toggle

## Summary
Added a dark mode toggle to the settings page with localStorage
persistence. The theme applies immediately on toggle and persists
across page reloads.

## Changes
- Created `components/DarkModeToggle.tsx`
- Added theme context in `contexts/ThemeContext.tsx`
- Updated `app/layout.tsx` to apply theme class
- Added dark mode styles to `globals.css`

## Links
- PR: https://github.com/chrisvasey/webapp/pull/42
- Preview: https://webapp-git-email-abc123.vercel.app
- Branch: `email/abc123`

---
Reply to continue this conversation.
```

### 3. Continue the Conversation

Just reply to the email thread:

```
To: webapp@code.patch.agency
Subject: Re: Add dark mode toggle

Can you also add a system preference option that follows
the OS dark mode setting?
```

Claude resumes the same session, updates the existing PR, and replies with the changes.

### 4. Merge When Ready

```
To: webapp@code.patch.agency
Subject: Re: Add dark mode toggle [merge]

Looks good, merge it!
```

## Features

### Project Routing

The recipient email address maps directly to a GitHub repository:

| Email | Repository |
|-------|------------|
| `webapp@code.patch.agency` | `github.com/GITHUB_OWNER/webapp` |
| `api@code.patch.agency` | `github.com/GITHUB_OWNER/api` |
| `docs@code.patch.agency` | `github.com/GITHUB_OWNER/docs` |

Repos are auto-cloned on first email. Configure `GITHUB_OWNER` in your environment.

### Conversation Threading

Replies to the same email thread continue the same Claude session:

- First email creates a new branch and PR
- Follow-up emails update the existing PR
- Claude remembers context from previous messages
- Uses `claude --resume` under the hood

### Attachments

Attach files directly to your email:

- Images (screenshots, mockups, designs)
- Documents (specs, requirements)
- Code files

Attachments are saved to disk and their paths passed to Claude as context.

### Special Commands

Commands can be triggered via brackets in the subject or natural language in the body:

| Command | Bracket | Natural Language |
|---------|---------|------------------|
| Merge PR | `[merge]` | "merge it", "ship it", "looks good, merge" |
| Close PR | `[close]` | "close this", "nevermind" |
| Get status | `[status]` | "what's the status?" |
| Plan only | `[plan]` | "write me a plan", "create a plan" |

**Plan mode** returns a detailed implementation plan without making changes. Reply to approve and execute, or provide feedback to refine the plan.

Example subjects:
- `Re: Add dark mode toggle [merge]`
- `Add user authentication [plan]`

### Preview URLs

Claude automatically extracts preview deployment URLs from its output:
- Vercel previews (`*.vercel.app`)
- Netlify previews (`*.netlify.app`)
- Custom preview domains

## Setup

### Prerequisites

- Bun 1.x (`curl -fsSL https://bun.sh/install | bash`)
- Redis
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
RESEND_FROM_DOMAIN=code.patch.agency

# GitHub
GITHUB_OWNER=chrisvasey

# Security - only these senders can use the service
ALLOWED_SENDERS=chris@patch.agency,grace@patch.agency

# Paths
PROJECTS_DIR=/home/claude/projects
SESSIONS_DB=./db/sessions.db
```

### Running

```bash
bun install

# Start the worker (processes jobs from Redis queue)
bun run start

# Start webhook server (receives emails from Resend)
bun run webhook

# Development mode with watch
bun run dev
```

## Docker Deployment

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

## Deployment Options

The webhook server needs a public URL for Resend to send emails to. Three options:

### Option 1: VPS (Recommended for Production)

Deploy to any VPS (Hetzner, DigitalOcean, etc.) with a public IP:

```bash
# On your VPS
docker compose up -d

# Configure Resend webhook URL
https://your-vps-ip:8080/webhook/email
# Or use a domain with nginx/caddy reverse proxy
https://code.yourdomain.com/webhook/email
```

### Option 2: Cloudflare Tunnel (Local Machine)

Run on your local machine and expose via Cloudflare Tunnel:

```bash
# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Start the webhook server
bun run webhook

# In another terminal, create a tunnel
cloudflared tunnel --url http://localhost:8080

# Use the generated URL (e.g., https://abc123.trycloudflare.com)
# Set this as your Resend webhook URL
```

For a permanent tunnel, create a named tunnel in the Cloudflare dashboard.

### Option 3: Tailscale Funnel (Local Machine)

Run locally and expose via Tailscale Funnel:

```bash
# Enable Funnel (one-time setup in Tailscale admin)
# https://tailscale.com/kb/1223/tailscale-funnel

# Start the webhook server
bun run webhook

# Expose port 8080 via Funnel
tailscale funnel 8080

# Use the generated URL (e.g., https://your-machine.tail-scale.ts.net)
# Set this as your Resend webhook URL
```

## Testing

```bash
bun test
```

## When to Use Email vs Terminal

**Email works great for:**
- Small, well-defined tasks from your phone
- Bug fixes with clear reproduction steps
- Content updates while traveling
- Tasks you'd otherwise forget

**Use terminal for:**
- Complex debugging sessions
- Exploratory work requiring iteration
- Large refactors needing oversight
