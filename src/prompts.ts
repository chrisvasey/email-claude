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
 */
export function buildFullPrompt(userPrompt: string): string {
  const system = loadPrompt("system");
  return `${system}\n\n---\n\n${userPrompt}`;
}
