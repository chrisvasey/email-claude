/**
 * Email command parsing module
 *
 * Parses special commands from email subjects to control PR operations
 * and plan mode workflow.
 */

export type Command =
	| { type: "merge" }
	| { type: "close" }
	| { type: "status" }
	| { type: "plan" }
	| { type: "confirm" }
	| { type: "cancel" }
	| null;

/**
 * Parse a command from an email subject line.
 * Commands are case-insensitive and can appear anywhere in the subject.
 *
 * Supported commands:
 * - [merge] - Merge the PR
 * - [close] - Close the PR without merging
 * - [status] - Get PR status
 * - [plan] - Request a plan before execution
 * - [confirm] - Approve and execute a pending plan
 * - [cancel] - Cancel a pending plan
 *
 * @param subject - The email subject line
 * @returns The parsed command or null if no command found
 */
export function parseCommand(subject: string): Command {
	const lowerSubject = subject.toLowerCase();

	if (lowerSubject.includes("[merge]")) {
		return { type: "merge" };
	}

	if (lowerSubject.includes("[close]")) {
		return { type: "close" };
	}

	if (lowerSubject.includes("[status]")) {
		return { type: "status" };
	}

	if (lowerSubject.includes("[plan]")) {
		return { type: "plan" };
	}

	if (lowerSubject.includes("[confirm]")) {
		return { type: "confirm" };
	}

	if (lowerSubject.includes("[cancel]")) {
		return { type: "cancel" };
	}

	return null;
}

/**
 * Natural language patterns that indicate a plan request
 */
const PLAN_TRIGGER_PATTERNS = [
	/\bplan\s+(for|out|to)\b/i,
	/\bwrite\s+(me\s+)?a\s+plan\b/i,
	/\bcreate\s+(me\s+)?a\s+plan\b/i,
	/\bdraft\s+(me\s+)?a\s+plan\b/i,
	/\boutline\s+(the|a)\b/i,
	/\bdesign\s+(an?\s+)?approach\b/i,
	/\bpropose\s+(an?\s+)?approach\b/i,
	/\bbefore\s+you\s+(start|begin|implement)\b/i,
	/\bdon'?t\s+(start|begin|implement)\s+yet\b/i,
	/\bwait\s+for\s+(my\s+)?approval\b/i,
	/\bjust\s+plan\b/i,
	/\bonly\s+plan\b/i,
];

/**
 * Detect if an email is requesting a plan (natural language detection).
 * This is used in addition to the explicit [plan] command.
 *
 * @param subject - The email subject line
 * @param body - The email body content
 * @returns true if the email is requesting a plan
 */
export function detectPlanTrigger(subject: string, body: string): boolean {
	const combined = `${subject} ${body}`;
	return PLAN_TRIGGER_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Natural language patterns that indicate approval
 */
const APPROVAL_PATTERNS = [
	/\b(looks?\s+good|lgtm)\b/i,
	/\bapproved?\b/i,
	/\bgo\s+ahead\b/i,
	/\bproceed\b/i,
	/\bship\s+it\b/i,
	/\bdo\s+it\b/i,
	/\bexecute\b/i,
	/\bimplement\s+(it|this|that)\b/i,
	/\bmake\s+(the\s+)?changes?\b/i,
	/\b(yes|ok|okay|yep|yup|sure|perfect|great|awesome)[.!]*\s*$/i, // Short approvals at end
];

/**
 * Patterns that indicate revision, not approval.
 * If these are present, the message is a revision request even if
 * approval patterns are also present.
 */
const REVISION_PATTERNS = [
	/\bbut\s+(first|also|instead|can|could|please|add|remove|change)\b/i,
	/\bwait\b/i,
	/\bhold\s+on\b/i,
	/\bchange\b/i,
	/\bmodify\b/i,
	/\bupdate\b/i,
	/\bno[,.]?\s/i,
	/\bdon'?t\b/i,
	/\binstead\b/i,
	/\brather\b/i,
	/\bactually\b/i,
	/\bhowever\b/i,
	/\balso\s+add\b/i,
	/\?/, // Questions typically indicate revision
];

/**
 * Detect if an email is approving a pending plan.
 * Returns false if revision patterns are detected, even if approval
 * patterns are also present (e.g., "looks good but add X").
 *
 * @param subject - The email subject line
 * @param body - The email body content
 * @returns true if the email is approving the plan
 */
export function detectApproval(subject: string, body: string): boolean {
	const combined = `${subject} ${body}`;

	// Check for explicit [confirm] command first
	if (subject.toLowerCase().includes("[confirm]")) {
		return true;
	}

	// Check for revision patterns - if present, not an approval
	if (REVISION_PATTERNS.some((pattern) => pattern.test(combined))) {
		return false;
	}

	// Check for approval patterns
	return APPROVAL_PATTERNS.some((pattern) => pattern.test(combined));
}
