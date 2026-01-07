/**
 * Email Job Handler
 *
 * Orchestrates the full email job flow:
 * 1. Setup git branch
 * 2. Run Claude Code with the prompt
 * 3. Commit and push changes if any
 * 4. Create PR if needed (first time only)
 * 5. Send success/error email reply
 */

import { Database } from "bun:sqlite";
import {
  ClaudeCodeService,
  type ClaudeCodeMessage,
} from "../services/claude-code";
import {
  ensureBranch,
  commitAndPush,
  createPR,
  getPRUrl,
  hasChanges,
} from "../git";
import {
  sendReply,
  formatSuccessReply,
  formatErrorReply,
  type EmailJob,
  type ClaudeResult,
} from "../mailer";
import { updateSession, type Session } from "../session";

export interface JobContext {
  db: Database;
  projectsDir: string;
  fromEmail: string;
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
    // 1. Setup git branch
    await ensureBranch(projectPath, session.branchName);

    // 2. Run Claude Code with job.prompt
    const result = await runClaude(projectPath, job.prompt, session);

    // 3. If changes, commit & push
    const changesExist = await hasChanges(projectPath);
    if (changesExist) {
      await commitAndPush(projectPath, `Email task: ${job.originalSubject}`);
    }

    // 4. Create PR if needed (first time only)
    if (changesExist && session.prNumber === null) {
      const prNumber = await createPR(
        projectPath,
        `[Email] ${job.originalSubject}`,
        `Automated changes from email thread.\n\nSession: ${session.id}`
      );

      // Update session with PR number
      updateSession(ctx.db, session.id, { prNumber });
      result.prNumber = prNumber;
    }

    // 5. Get PR URL if prNumber exists
    const prNumber = result.prNumber ?? session.prNumber;
    if (prNumber !== null && prNumber !== undefined) {
      result.prUrl = await getPRUrl(projectPath, prNumber);
      result.prNumber = prNumber;
    }

    // 6. Send success email reply
    await sendReply(formatSuccessReply(result, job), ctx.fromEmail);
  } catch (error) {
    // On error: send error email reply
    const err = error instanceof Error ? error : new Error(String(error));
    await sendReply(formatErrorReply(err, job), ctx.fromEmail);
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

    // On complete, extract summary and files changed
    claude.onComplete(() => {
      const summary = extractSummary(messages);
      const filesChanged = extractFilesChanged(messages);

      resolve({
        summary,
        filesChanged,
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

// Export for testing
export { runClaude };
