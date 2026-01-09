/**
 * Email Job Handler
 *
 * Orchestrates the full email job flow:
 * 1. Setup git branch
 * 2. Run Claude Code with the prompt (Claude handles atomic commits)
 * 3. Create PR if needed (first time only), or add comment to existing PR
 * 4. Send success/error email reply
 */

import { Database } from "bun:sqlite";
import {
  ClaudeCodeService,
  type ClaudeCodeMessage,
} from "../services/claude-code";
import {
  ensureBranch,
  createPR,
  getPRUrl,
  commentOnPR,
  hasCommitsAhead,
  mergePR,
  closePR,
} from "../git";
import { parseCommand, type Command } from "../commands";
import { ensureRepo } from "../services/repo";
import {
  sendReply,
  formatSuccessReply,
  formatErrorReply,
  type EmailJob,
  type ClaudeResult,
  type EmailAttachment,
} from "../mailer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  updateSession,
  addSessionMessage,
  getSessionMessages,
  type Session,
} from "../session";
import { buildFullPrompt } from "../prompts";
import { ensureOnDefaultBranch } from "../branch-safety";

export interface JobContext {
  db: Database;
  projectsDir: string;
  fromDomain: string;
  githubOwner: string;
}

/**
 * Main handler - orchestrates the full email job flow
 */
export async function handleEmailJob(
  job: EmailJob,
  session: Session,
  ctx: JobContext
): Promise<void> {
  const projectPath = `${ctx.projectsDir}/${job.project}`;

  try {
    // 0. Check for special commands before running Claude
    const command = parseCommand(job.originalSubject);
    if (command) {
      await handleCommand(command, session, job, projectPath, ctx);
      return;
    }

    // 1. Ensure repo exists (clone if needed)
    await ensureRepo(job.project, ctx.projectsDir, ctx.githubOwner);

    // 2. Branch safety: For NEW sessions only, ensure we're on default branch
    if (session.prNumber === null) {
      const fromEmail = `${job.project}@${ctx.fromDomain}`;
      await ensureOnDefaultBranch(
        projectPath,
        job.project,
        session.branchName,
        job,
        fromEmail
      );
    }

    // 3. Setup git branch
    await ensureBranch(projectPath, session.branchName);

    // 3.5. Save attachments (if any)
    const attachmentPaths = await saveAttachments(
      job.attachments,
      session.id,
      projectPath
    );

    // 4. Save user's message to conversation history (include subject for context)
    const userMessage = job.prompt.trim()
      ? `Subject: ${job.originalSubject}\n\n${job.prompt}`
      : job.originalSubject;
    addSessionMessage(ctx.db, session.id, "user", userMessage);

    // 5. Run Claude Code with prompt (includes system instructions for atomic commits)
    // Append attachment info to prompt if files were saved
    let promptWithAttachments = buildFullPrompt(job.originalSubject, job.prompt);
    if (attachmentPaths.length > 0) {
      promptWithAttachments += `\n\n---\n\nAttached files (saved to disk):\n${attachmentPaths.map(p => `- ${p}`).join('\n')}`;
    }
    const result = await runClaude(projectPath, promptWithAttachments, session);

    // 6. Save Claude's response to conversation history
    addSessionMessage(ctx.db, session.id, "assistant", result.summary);

    // 6.5. Save Claude session ID for --resume support (first run only)
    if (result.claudeSessionId && session.claudeSessionId === null) {
      updateSession(ctx.db, session.id, { claudeSessionId: result.claudeSessionId });
    }

    // 7. Handle PR creation or commenting (only if there are commits)
    const hasCommits = await hasCommitsAhead(projectPath);

    if (hasCommits) {
      if (session.prNumber === null) {
        // First PR: Include full conversation history
        const messages = getSessionMessages(ctx.db, session.id);
        const conversationHistory = messages
          .map((msg) => {
            const label = msg.role === "user" ? "**User:**" : "**Claude:**";
            return `${label}\n\n${msg.content}`;
          })
          .join("\n\n---\n\n");

        const prBody = [
          "## Conversation",
          "",
          conversationHistory,
          "",
          "---",
          "",
          `Session: \`${session.id}\``,
        ].join("\n");

        const prNumber = await createPR(
          projectPath,
          `[Email] ${job.originalSubject}`,
          prBody
        );

        // Update session with PR number
        updateSession(ctx.db, session.id, { prNumber });
        result.prNumber = prNumber;
      } else {
        // Subsequent email: Add comment to existing PR
        const requestContent = job.prompt.trim()
          ? `Subject: ${job.originalSubject}\n\n${job.prompt}`
          : job.originalSubject;
        const comment = [
          "## Follow-up Request",
          "",
          "```",
          requestContent,
          "```",
          "",
          "## Claude's Response",
          "",
          result.summary,
        ].join("\n");

        await commentOnPR(projectPath, session.prNumber, comment);
        result.prNumber = session.prNumber;
      }

      // 8. Get PR URL
      if (result.prNumber !== null && result.prNumber !== undefined) {
        result.prUrl = await getPRUrl(projectPath, result.prNumber);
      }
    }

    // 9. Send success email reply
    const fromEmail = `${job.project}@${ctx.fromDomain}`;
    await sendReply(await formatSuccessReply(result, job), fromEmail);
  } catch (error) {
    // On error: send error email reply
    const fromEmail = `${job.project}@${ctx.fromDomain}`;
    const err = error instanceof Error ? error : new Error(String(error));
    await sendReply(await formatErrorReply(err, job), fromEmail);
    throw error; // Re-throw to allow caller to handle
  }
}

/**
 * Run Claude Code and collect result
 */
async function runClaude(
  projectPath: string,
  prompt: string,
  session: Session
): Promise<ClaudeResult> {
  const messages: ClaudeCodeMessage[] = [];

  const claude = new ClaudeCodeService({
    cwd: projectPath,
    autoApprove: true,
    sessionId: session.claudeSessionId ?? undefined,
    resumeSession: session.claudeSessionId !== null,
  });

  return new Promise((resolve, reject) => {
    // Collect all messages
    claude.onMessage((message) => {
      messages.push(message);

      // Check for errors
      if (message.type === "error") {
        const errorMessage = message.content || message.error || "Unknown error";
        reject(new Error(`Claude error: ${errorMessage}`));
      }
    });

    // On complete, extract summary, files changed, preview URLs, and session ID
    claude.onComplete(() => {
      const summary = extractSummary(messages);
      const filesChanged = extractFilesChanged(messages);
      const previewUrls = extractPreviewUrls(messages);
      const claudeSessionId = extractClaudeSessionId(messages);

      resolve({
        summary,
        filesChanged,
        previewUrls: previewUrls.length > 0 ? previewUrls : undefined,
        claudeSessionId,
      });
    });

    // Start Claude with the prompt
    claude.start(prompt).catch(reject);
  });
}

/**
 * Extract summary from Claude messages
 * Looks for result messages or assistant messages with content
 */
export function extractSummary(messages: ClaudeCodeMessage[]): string {
  // First, look for a result message
  const resultMessage = messages.find((m) => m.type === "result");
  if (resultMessage?.result) {
    return resultMessage.result;
  }

  // Otherwise, find the last assistant message with content
  const assistantMessages = messages.filter(
    (m) => m.type === "assistant" || m.from === "assistant"
  );

  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const msg = assistantMessages[i];

    // Check direct content
    if (msg.content && typeof msg.content === "string") {
      return msg.content;
    }

    // Check message.content array
    if (msg.message?.content) {
      const textContent = msg.message.content.find((c) => c.type === "text");
      if (textContent?.text) {
        return textContent.text;
      }
    }
  }

  return "Task completed.";
}

/**
 * Extract changed files from Claude messages
 * Looks for tool_use/tool_result messages related to file operations
 */
export function extractFilesChanged(messages: ClaudeCodeMessage[]): string[] {
  const files = new Set<string>();

  for (const msg of messages) {
    // Look for tool_use messages with file-related tools
    if (msg.type === "tool_use" && msg.tool_input) {
      const input = msg.tool_input as Record<string, unknown>;

      // Common file path fields
      const filePath =
        input.file_path ||
        input.path ||
        input.filename ||
        input.target_file ||
        input.destination;

      if (typeof filePath === "string" && filePath.length > 0) {
        // Check if it's a write/edit operation
        const writeTools = [
          "write",
          "edit",
          "create",
          "Write",
          "Edit",
          "str_replace_editor",
        ];
        if (
          msg.tool_name &&
          writeTools.some(
            (t) =>
              msg.tool_name?.toLowerCase().includes(t.toLowerCase())
          )
        ) {
          files.add(filePath);
        }
      }
    }

    // Look for tool_result messages that might contain file paths
    if (msg.type === "tool_result" && msg.content) {
      // Try to extract file paths from content
      const filePathMatches = String(msg.content).match(
        /(?:wrote|created|modified|updated|edited).*?["']?([^\s"']+\.[a-z]{1,10})["']?/gi
      );
      if (filePathMatches) {
        for (const match of filePathMatches) {
          const pathMatch = match.match(/([^\s"']+\.[a-z]{1,10})/i);
          if (pathMatch) {
            files.add(pathMatch[1]);
          }
        }
      }
    }
  }

  return Array.from(files);
}

/**
 * Extract preview URLs from Claude messages
 * Looks for URLs in assistant messages that match deployment domains
 */
export function extractPreviewUrls(messages: ClaudeCodeMessage[]): string[] {
  const urls = new Set<string>();
  const deploymentDomains = [
    'vercel.app',
    'netlify.app',
    'pages.dev',
    'fly.dev',
    'railway.app',
    'render.com',
    'herokuapp.com',
  ];

  // URL regex pattern
  const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g;

  for (const msg of messages) {
    // Check assistant messages
    if (msg.type === 'assistant' || msg.from === 'assistant') {
      let textContent = '';

      // Get text from direct content
      if (msg.content && typeof msg.content === 'string') {
        textContent = msg.content;
      }

      // Get text from message.content array
      if (msg.message?.content) {
        for (const c of msg.message.content) {
          if (c.type === 'text' && c.text) {
            textContent += ' ' + c.text;
          }
        }
      }

      // Extract URLs
      const matches = textContent.match(urlPattern) || [];
      for (const url of matches) {
        // Check if URL matches a deployment domain
        if (deploymentDomains.some(domain => url.includes(domain))) {
          // Clean up the URL (remove trailing punctuation)
          const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
          urls.add(cleanUrl);
        }
      }
    }

    // Also check result messages
    if (msg.type === 'result' && msg.result) {
      const matches = msg.result.match(urlPattern) || [];
      for (const url of matches) {
        if (deploymentDomains.some(domain => url.includes(domain))) {
          const cleanUrl = url.replace(/[.,;:!?)]+$/, '');
          urls.add(cleanUrl);
        }
      }
    }
  }

  return Array.from(urls);
}

/**
 * Extract Claude session ID from messages for --resume support
 * Claude Code returns session_id in system messages
 */
export function extractClaudeSessionId(messages: ClaudeCodeMessage[]): string | null {
  for (const msg of messages) {
    // Check for session_id in the message
    if (msg.session_id) {
      return msg.session_id;
    }

    // Check in system messages
    if (msg.type === 'system' && msg.session_id) {
      return msg.session_id;
    }
  }

  return null;
}

/**
 * Save email attachments to disk and return their paths
 */
async function saveAttachments(
  attachments: EmailAttachment[] | undefined,
  sessionId: string,
  projectPath: string
): Promise<string[]> {
  if (!attachments || attachments.length === 0) {
    return [];
  }

  const attachmentDir = join(projectPath, '.attachments', sessionId);
  await mkdir(attachmentDir, { recursive: true });

  const savedPaths: string[] = [];

  for (const attachment of attachments) {
    const filePath = join(attachmentDir, attachment.filename);

    // Decode base64 content and write to file
    const buffer = Buffer.from(attachment.content, 'base64');
    await writeFile(filePath, buffer);

    savedPaths.push(filePath);
    console.log(`[Handler] Saved attachment: ${filePath}`);
  }

  return savedPaths;
}

/**
 * Handle special commands (merge, close, status)
 */
async function handleCommand(
  command: Command,
  session: Session,
  job: EmailJob,
  projectPath: string,
  ctx: JobContext
): Promise<void> {
  if (!command) return;

  const fromEmail = `${job.project}@${ctx.fromDomain}`;

  // Commands require an existing PR
  if (session.prNumber === null) {
    const reply = {
      to: job.replyTo,
      subject: `Re: ${job.originalSubject}`,
      inReplyTo: job.messageId,
      text: `Error: No PR exists for this session yet. Send a task email first to create a PR.`,
    };
    await sendReply(reply, fromEmail);
    return;
  }

  try {
    switch (command.type) {
      case 'merge': {
        await mergePR(projectPath, session.prNumber);
        const reply = {
          to: job.replyTo,
          subject: `Re: ${job.originalSubject}`,
          inReplyTo: job.messageId,
          text: `PR #${session.prNumber} has been merged successfully.`,
        };
        await sendReply(reply, fromEmail);
        break;
      }

      case 'close': {
        await closePR(projectPath, session.prNumber);
        const reply = {
          to: job.replyTo,
          subject: `Re: ${job.originalSubject}`,
          inReplyTo: job.messageId,
          text: `PR #${session.prNumber} has been closed without merging.`,
        };
        await sendReply(reply, fromEmail);
        break;
      }

      case 'status': {
        const prUrl = await getPRUrl(projectPath, session.prNumber);
        const reply = {
          to: job.replyTo,
          subject: `Re: ${job.originalSubject}`,
          inReplyTo: job.messageId,
          text: [
            `Status for session: ${session.id}`,
            ``,
            `Project: ${job.project}`,
            `Branch: ${session.branchName}`,
            `PR: #${session.prNumber}`,
            `PR URL: ${prUrl}`,
          ].join('\n'),
        };
        await sendReply(reply, fromEmail);
        break;
      }
    }
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await sendReply(await formatErrorReply(err, job), fromEmail);
    throw error;
  }
}

// Export for testing
export { runClaude, handleCommand };
