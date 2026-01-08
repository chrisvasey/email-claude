/**
 * Email Reply Module
 *
 * Handles sending email replies via Resend API
 */

import { Resend } from "resend";
import { render } from "@react-email/components";
import { SuccessEmail } from "./emails/success-email.tsx";
import { ErrorEmail } from "./emails/error-email.tsx";

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
  error?: string;
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
  attachments?: string[];
  createdAt: string;
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
  lines.push(`- Branch: email/${job.sessionId}`);
  lines.push("");

  lines.push("---");
  lines.push("Reply to this email to continue the conversation.");

  const html = await render(
    SuccessEmail({
      summary: result.summary,
      filesChanged: result.filesChanged,
      prUrl: result.prUrl,
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

// Allow resetting the client for testing
export function _resetResendClient(): void {
  resendClient = null;
}
