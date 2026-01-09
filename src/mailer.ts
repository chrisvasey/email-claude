/**
 * Email Reply Module
 *
 * Handles sending email replies via Resend API
 */

import { Resend } from "resend";
import { render } from "@react-email/components";
import { SuccessEmail } from "./emails/success-email.tsx";
import { ErrorEmail } from "./emails/error-email.tsx";
import { BranchNoticeEmail } from "./emails/branch-notice-email.tsx";
import { PlanEmail } from "./emails/plan-email.tsx";

export interface EmailReply {
  to: string;
  subject: string;
  inReplyTo?: string;
  text: string;
  html?: string;
}

export interface ClaudeResult {
  summary: string;
  filesChanged: string[];
  prUrl?: string;
  prNumber?: number;
  previewUrls?: string[];
  claudeSessionId?: string | null;
  error?: string;
}

export interface EmailAttachment {
  filename: string;
  content: string;  // Base64 encoded
  contentType?: string;
}

export interface EmailJob {
  id: string;
  sessionId: string;
  project: string;
  prompt: string;
  replyTo: string;
  originalSubject: string;
  messageId: string;
  resumeSession: boolean;
  attachments?: EmailAttachment[];
  createdAt: string;
  retryCount?: number;
}

// Create Resend client (lazy initialization)
let resendClient: Resend | null = null;

export function getResend(): Resend {
  if (!resendClient) {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error("RESEND_API_KEY environment variable is not set");
    }
    resendClient = new Resend(apiKey);
  }
  return resendClient;
}

/**
 * Send an email reply via Resend
 */
export async function sendReply(
  reply: EmailReply,
  fromEmail: string
): Promise<void> {
  const resend = getResend();

  const headers: Record<string, string> = {};
  if (reply.inReplyTo) {
    headers["In-Reply-To"] = reply.inReplyTo;
    headers["References"] = reply.inReplyTo;
  }

  await resend.emails.send({
    from: fromEmail,
    to: reply.to,
    subject: reply.subject,
    text: reply.text,
    html: reply.html,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

/**
 * Format a success reply from Claude result
 */
export async function formatSuccessReply(
  result: ClaudeResult,
  job: EmailJob
): Promise<EmailReply> {
  const lines: string[] = [];

  lines.push("Summary");
  lines.push(result.summary);
  lines.push("");

  if (result.filesChanged.length > 0) {
    lines.push("Changes");
    for (const file of result.filesChanged) {
      lines.push(`- ${file}`);
    }
    lines.push("");
  }

  lines.push("Links");
  if (result.prUrl) {
    lines.push(`- PR: ${result.prUrl}`);
  }
  if (result.previewUrls && result.previewUrls.length > 0) {
    for (const url of result.previewUrls) {
      lines.push(`- Preview: ${url}`);
    }
  }
  lines.push(`- Branch: email/${job.sessionId}`);
  lines.push("");

  lines.push("---");
  lines.push("Reply to this email to continue the conversation.");

  const html = await render(
    SuccessEmail({
      summary: result.summary,
      filesChanged: result.filesChanged,
      prUrl: result.prUrl,
      previewUrls: result.previewUrls,
      branchName: `email/${job.sessionId}`,
    })
  );

  return {
    to: job.replyTo,
    subject: `Re: ${job.originalSubject}`,
    inReplyTo: job.messageId,
    text: lines.join("\n"),
    html,
  };
}

/**
 * Format an error reply
 */
export async function formatErrorReply(
  error: Error,
  job: EmailJob
): Promise<EmailReply> {
  const lines: string[] = [];

  lines.push("Error");
  lines.push("");
  lines.push("An error occurred while processing your request:");
  lines.push("");
  lines.push(error.message);
  lines.push("");
  lines.push("---");
  lines.push("Reply to try again or start a new task.");

  const html = await render(
    ErrorEmail({
      errorMessage: error.message,
    })
  );

  return {
    to: job.replyTo,
    subject: `Re: ${job.originalSubject}`,
    inReplyTo: job.messageId,
    text: lines.join("\n"),
    html,
  };
}

/**
 * Send a "sender not allowed" error email
 */
export async function sendNotAllowedEmail(
  to: string,
  subject: string,
  messageId: string,
  fromEmail: string
): Promise<void> {
  const errorMessage =
    "Your email address is not in the allowed senders list. Please contact the administrator to be added.";

  const html = await render(
    ErrorEmail({
      errorMessage,
    })
  );

  const reply: EmailReply = {
    to,
    subject: `Re: ${subject}`,
    inReplyTo: messageId,
    text: `Error\n\n${errorMessage}`,
    html,
  };

  await sendReply(reply, fromEmail);
}

export interface BranchNoticeInfo {
  previousBranch: string;
  defaultBranch: string;
  newBranch: string;
  projectName: string;
}

/**
 * Format a branch notice email (sent when repo was on wrong branch)
 */
export async function formatBranchNoticeEmail(
  info: BranchNoticeInfo,
  job: EmailJob
): Promise<EmailReply> {
  const lines: string[] = [];

  lines.push("Notice: Branch Reset");
  lines.push("");
  lines.push(
    `The repository ${info.projectName} was on branch "${info.previousBranch}" instead of "${info.defaultBranch}".`
  );
  lines.push("");
  lines.push(
    `For safety, we switched to "${info.defaultBranch}" before creating your feature branch "${info.newBranch}".`
  );
  lines.push("");
  lines.push("Your request is being processed normally.");
  lines.push("");
  lines.push("---");
  lines.push("This is an informational notice. No action is required.");

  const html = await render(
    BranchNoticeEmail({
      previousBranch: info.previousBranch,
      defaultBranch: info.defaultBranch,
      newBranch: info.newBranch,
      projectName: info.projectName,
    })
  );

  return {
    to: job.replyTo,
    subject: `Re: ${job.originalSubject}`,
    inReplyTo: job.messageId,
    text: lines.join("\n"),
    html,
  };
}

/**
 * Format a plan approval request email
 */
export async function formatPlanReply(
  plan: string,
  job: EmailJob,
  isRevision: boolean = false
): Promise<EmailReply> {
  const title = isRevision ? "Revised Plan" : "Implementation Plan";

  const lines: string[] = [];
  lines.push(title);
  lines.push("");
  lines.push(plan);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("To approve this plan, reply with:");
  lines.push("- [confirm] in the subject, OR");
  lines.push('- "Looks good", "Approved", "Go ahead", etc.');
  lines.push("");
  lines.push("To request changes, simply reply with your feedback.");
  lines.push("To cancel, reply with [cancel] in the subject.");

  const html = await render(
    PlanEmail({
      plan,
      isRevision,
    })
  );

  return {
    to: job.replyTo,
    subject: `Re: ${job.originalSubject}`,
    inReplyTo: job.messageId,
    text: lines.join("\n"),
    html,
  };
}

// Allow resetting the client for testing
export function _resetResendClient(): void {
  resendClient = null;
}
