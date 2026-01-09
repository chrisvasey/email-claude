# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- Branch safety: New email threads always branch from main/master
- Notification email sent when repo was on a different branch
- New git helpers: `getDefaultBranch()`, `getCurrentBranch()`, `checkoutBranch()`
- New module: `src/branch-safety.ts` for branch safety logic
- New email template: `src/emails/branch-notice-email.tsx`

## [0.3.0] - 2026-01-09

### Added - Phase 3 Complete
- **`--resume` integration**: Claude session ID extracted from output and persisted for multi-turn conversations
- **Preview URL extraction**: Automatically detects deployment URLs (vercel.app, netlify.app, pages.dev, fly.dev, railway.app, render.com, herokuapp.com) in Claude's responses
- **Attachment handling**:
  - Fetches attachment content from Resend download URLs
  - Saves files to `.attachments/{sessionId}/` in project directory
  - Passes file paths to Claude in the prompt
- **Retry logic with exponential backoff**:
  - Max 3 retries per job
  - Exponential backoff: 1s, 2s, 4s delays
  - Dead letter queue for permanently failed jobs
  - Retry queue using Redis sorted sets
- **Special commands** via `src/commands.ts`:
  - `[merge]` - Merge the PR
  - `[close]` - Close the PR without merging
  - `[status]` - Get session/PR status

### Changed
- Updated `EmailJob` interface with `retryCount` and proper `EmailAttachment` type
- Updated `ClaudeResult` interface with `previewUrls` and `claudeSessionId`
- Worker now handles retries instead of dropping failed jobs
- Test count increased from 112 to 150

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
