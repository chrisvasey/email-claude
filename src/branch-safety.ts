/**
 * Branch Safety Module
 *
 * Ensures new email sessions branch from the default branch (main/master),
 * and notifies users when the repo was on a different branch.
 */

import { checkoutBranch, getCurrentBranch, getDefaultBranch } from "./git";
import {
	type BranchNoticeInfo,
	type EmailJob,
	formatBranchNoticeEmail,
	sendReply,
} from "./mailer";

export interface BranchSafetyResult {
	notificationSent: boolean;
	previousBranch: string;
	defaultBranch: string;
}

/**
 * Ensure the repository is on the default branch before creating a new feature branch.
 * Sends a notification email if the repo was on a different branch.
 *
 * @param projectPath - Path to the git repository
 * @param projectName - Name of the project (for email)
 * @param newBranchName - The new branch that will be created
 * @param job - Email job info for sending notification
 * @param fromEmail - From address for notification email
 * @returns Info about whether notification was sent and branch state
 */
export async function ensureOnDefaultBranch(
	projectPath: string,
	projectName: string,
	newBranchName: string,
	job: EmailJob,
	fromEmail: string,
): Promise<BranchSafetyResult> {
	const defaultBranch = await getDefaultBranch(projectPath);
	const currentBranch = await getCurrentBranch(projectPath);

	const result: BranchSafetyResult = {
		notificationSent: false,
		previousBranch: currentBranch,
		defaultBranch,
	};

	// If not on default branch, switch and notify
	if (currentBranch !== defaultBranch) {
		// Switch to default branch
		await checkoutBranch(projectPath, defaultBranch);

		// Send notification email (non-blocking - fire and forget with error logging)
		const noticeInfo: BranchNoticeInfo = {
			previousBranch: currentBranch,
			defaultBranch,
			newBranch: newBranchName,
			projectName,
		};

		try {
			const noticeEmail = await formatBranchNoticeEmail(noticeInfo, job);
			await sendReply(noticeEmail, fromEmail);
			result.notificationSent = true;
		} catch (error) {
			// Log but don't fail the job - this is informational only
			console.error("Failed to send branch notice email:", error);
		}
	}

	return result;
}
