/**
 * Prompt Loader Module
 *
 * Loads markdown prompt templates from the prompts/ folder.
 */

import { readFileSync } from "fs";
import { join } from "path";

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
  const userContent = body.trim()
    ? `Subject: ${subject}\n\n${body}`
    : subject; // If no body, just use subject directly
  return `${system}\n\n---\n\n${userContent}`;
}
