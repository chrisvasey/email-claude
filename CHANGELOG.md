# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Remaining
- `claude --resume` integration (session ID persistence)
- Preview deployment URL extraction
- Attachment handling (images to Claude vision)
- Error handling & retry logic
- Special commands ([merge], [close], [status])

## [0.2.0] - 2026-01-08

### Added
- HTML email formatting using React Email components
- Error email response when sender is not on whitelist
- Email subject passed to Claude as context for better task understanding
- GitHub Actions workflow for automated testing
- Webhook now fetches full email content from Resend API (was metadata only)

### Changed
- Moved test files to `/tests` directory for better organization
- Improved test mocking for webhook handler

## [0.1.0] - 2026-01-07

### Added
- **Phase 1: MVP (Complete)**
  - Resend inbound webhook handler (`src/webhook.ts`)
  - Redis job queue integration (`src/worker.ts`)
  - Claude Code CLI wrapper with streaming output (`src/services/claude-code.ts`)
  - Email reply composition via Resend API (`src/mailer.ts`)
  - SQLite session management (`src/session.ts`)
  - Git/GitHub CLI utilities for branch and PR management (`src/git.ts`)
  - Environment configuration (`src/config.ts`)

- **Phase 2: Sessions & Threading (Complete)**
  - Subject-based session tracking via SHA256 hash
  - Email threading with In-Reply-To headers
  - PR body contains original email text
  - Follow-up emails add comments to existing PR
  - Atomic commits via system prompt instructions (`prompts/system.md`)
  - Conversation history storage in SQLite

- **Infrastructure**
  - Docker and Docker Compose deployment support
  - Auto-clone repos on first email (`GITHUB_OWNER` config)
  - Sender allowlist with wildcard domain support
  - Webhook signature verification (HMAC-SHA256)
  - Graceful worker shutdown handling

### Technical Details
- Ported from `patch-workbench-laravel/deno-worker/` (Deno to Bun)
- Uses `Bun.spawn` for subprocess management
- Uses `bun:sqlite` for session storage
- 112 tests across 7 test files
