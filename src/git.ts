/**
 * Git Operations Module
 *
 * Provides git operations via shell commands using Bun.spawn.
 * Used for branch management, commits, PRs, and change detection.
 */

/**
 * Run a git command and return stdout
 */
async function runGit(projectPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: projectPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args[0]} failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

/**
 * Run a gh CLI command and return stdout
 */
async function runGh(projectPath: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["gh", ...args], {
    cwd: projectPath,
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`gh ${args[0]} failed: ${stderr.trim() || `exit code ${exitCode}`}`);
  }

  const stdout = await new Response(proc.stdout).text();
  return stdout.trim();
}

/**
 * Ensure we're on a branch (create if needed, checkout if exists)
 */
export async function ensureBranch(projectPath: string, branchName: string): Promise<void> {
  // Check if branch exists locally
  try {
    await runGit(projectPath, ["rev-parse", "--verify", branchName]);
    // Branch exists, checkout
    await runGit(projectPath, ["checkout", branchName]);
  } catch {
    // Branch doesn't exist, create and checkout
    await runGit(projectPath, ["checkout", "-b", branchName]);
  }
}

/**
 * Stage all changes, commit with message, push to origin
 */
export async function commitAndPush(projectPath: string, message: string): Promise<void> {
  await runGit(projectPath, ["add", "-A"]);
  await runGit(projectPath, ["commit", "-m", message]);

  // Get current branch name
  const branchName = await runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
  await runGit(projectPath, ["push", "-u", "origin", branchName]);
}

/**
 * Get existing PR number for current branch, or null if none exists
 */
export async function getExistingPR(projectPath: string): Promise<number | null> {
  try {
    const output = await runGh(projectPath, [
      "pr", "view",
      "--json", "number",
      "--jq", ".number",
    ]);
    return parseInt(output, 10);
  } catch {
    // No PR exists for this branch
    return null;
  }
}

/**
 * Create a PR using gh CLI, return PR number
 * If a PR already exists for this branch, return the existing PR number
 */
export async function createPR(projectPath: string, title: string, body: string): Promise<number> {
  // First check if a PR already exists for this branch
  const existingPR = await getExistingPR(projectPath);
  if (existingPR !== null) {
    return existingPR;
  }

  const output = await runGh(projectPath, [
    "pr", "create",
    "--title", title,
    "--body", body,
  ]);

  // gh pr create outputs the PR URL, extract the number from it
  // e.g., "https://github.com/owner/repo/pull/123"
  const match = output.match(/\/pull\/(\d+)/);
  if (!match) {
    throw new Error(`Failed to parse PR number from output: ${output}`);
  }

  return parseInt(match[1], 10);
}

/**
 * Get PR URL from gh CLI
 */
export async function getPRUrl(projectPath: string, prNumber: number): Promise<string> {
  const output = await runGh(projectPath, [
    "pr", "view", prNumber.toString(),
    "--json", "url",
    "--jq", ".url",
  ]);

  return output;
}

/**
 * Merge a PR
 */
export async function mergePR(projectPath: string, prNumber: number): Promise<void> {
  await runGh(projectPath, [
    "pr", "merge", prNumber.toString(),
    "--merge",
  ]);
}

/**
 * Close a PR without merging
 */
export async function closePR(projectPath: string, prNumber: number): Promise<void> {
  await runGh(projectPath, [
    "pr", "close", prNumber.toString(),
  ]);
}

/**
 * Check if there are uncommitted changes
 */
export async function hasChanges(projectPath: string): Promise<boolean> {
  const output = await runGit(projectPath, ["status", "--porcelain"]);
  return output.length > 0;
}

// Export runGit and runGh for testing
export { runGit, runGh };
