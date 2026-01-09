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
} from "../git";
import { ensureRepo } from "../services/repo";
import {
  sendReply,
  formatSuccessReply,
  formatErrorReply,
  type EmailJob,
  type ClaudeResult,
} from "../mailer";
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
  fromEmail: string;
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
    // 1. Ensure repo exists (clone if needed)
    await ensureRepo(job.project, ctx.projectsDir, ctx.githubOwner);

    // 2. Branch safety: For NEW sessions only, ensure we're on default branch
    if (session.prNumber === null) {
      await ensureOnDefaultBranch(
        projectPath,
        job.project,
        session.branchName,
        job,
        ctx.fromEmail
      );
    }

    // 3. Setup git branch
    await ensureBranch(projectPath, session.branchName);

    // 4. Save user's message to conversation history (include subject for context)
    const userMessage = job.prompt.trim()
      ? `Subject: ${job.originalSubject}\n\n${job.prompt}`
      : job.originalSubject;
    addSessionMessage(ctx.db, session.id, "user", userMessage);

    // 5. Run Claude Code with prompt (includes system instructions for atomic commits)
    const fullPrompt = buildFullPrompt(job.originalSubject, job.prompt);
    const result = await runClaude(projectPath, fullPrompt, session);

    // 6. Save Claude's response to conversation history
    addSessionMessage(ctx.db, session.id, "assistant", result.summary);

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
    await sendReply(await formatSuccessReply(result, job), ctx.fromEmail);
  } catch (error) {
    // On error: send error email reply
    const err = error instanceof Error ? error : new Error(String(error));
    await sendReply(await formatErrorReply(err, job), ctx.fromEmail);
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
