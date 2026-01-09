/**
 * Prompt Loader Module
 *
 * Loads markdown prompt templates from the prompts/ folder.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const PROMPTS_DIR = join(import.meta.dir, "../prompts");

/**
 * Load a prompt template by name (without .md extension)
 */
export function loadPrompt(name: string): string {
	const path = join(PROMPTS_DIR, `${name}.md`);
	return readFileSync(path, "utf-8");
}

/**
 * Build the full prompt by prepending system instructions
 * @param subject - Email subject line (provides context/instructions)
 * @param body - Email body content (may be empty if subject contains full instructions)
 */
export function buildFullPrompt(subject: string, body: string): string {
	const system = loadPrompt("system");
	const userContent = body.trim() ? `Subject: ${subject}\n\n${body}` : subject; // If no body, just use subject directly
	return `${system}\n\n---\n\n${userContent}`;
}

/**
 * Build a plan-only prompt (no execution)
 * @param subject - Email subject line
 * @param body - Email body content
 */
export function buildPlanPrompt(subject: string, body: string): string {
	const planInstructions = loadPrompt("plan-mode");
	const userContent = body.trim() ? `Subject: ${subject}\n\n${body}` : subject;
	return `${planInstructions}\n\n---\n\n${userContent}`;
}

/**
 * Build an execution prompt with an approved plan
 * @param subject - Email subject line
 * @param body - Email body content (approval message)
 * @param approvedPlan - The plan that was approved
 */
export function buildExecutionPrompt(
	subject: string,
	body: string,
	approvedPlan: string,
): string {
	const system = loadPrompt("system");
	const userContent = body.trim() ? `Subject: ${subject}\n\n${body}` : subject;

	return `${system}

---

## Approved Plan

The user has reviewed and approved the following plan. Execute it now:

${approvedPlan}

---

## User's Approval Message

${userContent}`;
}

/**
 * Build a revision prompt for updating an existing plan
 * @param subject - Email subject line
 * @param body - Email body content (revision request)
 * @param currentPlan - The current plan to be revised
 */
export function buildRevisionPrompt(
	subject: string,
	body: string,
	currentPlan: string,
): string {
	const planInstructions = loadPrompt("plan-mode");
	const userContent = body.trim() ? `Subject: ${subject}\n\n${body}` : subject;

	return `${planInstructions}

---

## Current Plan

${currentPlan}

---

## Revision Request

The user wants changes to this plan:

${userContent}

---

Please revise the plan based on the user's feedback. Remember: DO NOT implement anything, only update the plan.`;
}
