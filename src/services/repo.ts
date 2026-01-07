/**
 * Repository Service
 *
 * Handles auto-cloning of repositories when they don't exist locally.
 * Uses the GITHUB_OWNER config to build clone URLs from project names.
 */

/**
 * Build the git clone URL for a project
 * email-claude -> git@github.com:chrisvasey/email-claude.git
 */
export function getRepoUrl(project: string, owner: string): string {
  return `git@github.com:${owner}/${project}.git`;
}

/**
 * Check if a repository exists at the given path
 */
export async function repoExists(projectPath: string): Promise<boolean> {
  const gitConfig = Bun.file(`${projectPath}/.git/config`);
  return gitConfig.exists();
}

/**
 * Ensure the repository exists locally, cloning if needed
 *
 * @param project - Project name (e.g., "email-claude")
 * @param projectsDir - Base directory for projects (e.g., "/home/claude/projects")
 * @param owner - GitHub owner/org (e.g., "chrisvasey")
 * @returns The full path to the project
 */
export async function ensureRepo(
  project: string,
  projectsDir: string,
  owner: string
): Promise<string> {
  const projectPath = `${projectsDir}/${project}`;

  // Check if repo already exists
  if (await repoExists(projectPath)) {
    console.log(`[Repo] ${project} exists at ${projectPath}`);
    return projectPath;
  }

  // Validate owner is configured
  if (!owner) {
    throw new Error(
      `Cannot clone ${project}: GITHUB_OWNER is not configured`
    );
  }

  // Clone the repo
  const repoUrl = getRepoUrl(project, owner);
  console.log(`[Repo] Cloning ${repoUrl} to ${projectPath}...`);

  const proc = Bun.spawn(["git", "clone", repoUrl, projectPath], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(
      `Failed to clone ${repoUrl}: ${stderr.trim() || `exit code ${exitCode}`}`
    );
  }

  console.log(`[Repo] Successfully cloned ${project}`);
  return projectPath;
}
