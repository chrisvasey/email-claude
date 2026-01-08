/**
 * Git Module Tests
 *
 * Tests for git operations using mocked Bun.spawn
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";

// We'll use a different approach - mock at the module level
// by creating a wrapper that can be mocked

describe("git module", () => {
  // Store original Bun.spawn
  const originalSpawn = Bun.spawn;
  let spawnMock: ReturnType<typeof mock>;
  let spawnCalls: Array<{ cmd: string[]; cwd: string }>;

  // Helper to create a mock subprocess
  function createMockProc(stdout: string, exitCode: number = 0, stderr: string = "") {
    return {
      exited: Promise.resolve(exitCode),
      stdout: new Response(stdout).body,
      stderr: new Response(stderr).body,
    };
  }

  beforeEach(() => {
    spawnCalls = [];
    spawnMock = mock((cmd: string[], options: { cwd: string }) => {
      spawnCalls.push({ cmd, cwd: options.cwd });
      // Default: return empty success
      return createMockProc("");
    });

    // @ts-expect-error - we're mocking Bun.spawn
    Bun.spawn = spawnMock;
  });

  afterEach(() => {
    // Restore original
    Bun.spawn = originalSpawn;
  });

  describe("ensureBranch", () => {
    test("checks out existing branch", async () => {
      // First call (rev-parse) succeeds, second call (checkout) succeeds
      let callIndex = 0;
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        callIndex++;
        return createMockProc("");
      });

      // Import after mocking
      const { ensureBranch } = await import("../src/git.ts");
      await ensureBranch("/test/project", "feature-branch");

      expect(spawnCalls.length).toBe(2);
      expect(spawnCalls[0].cmd).toEqual(["git", "rev-parse", "--verify", "feature-branch"]);
      expect(spawnCalls[1].cmd).toEqual(["git", "checkout", "feature-branch"]);
      expect(spawnCalls[0].cwd).toBe("/test/project");
    });

    test("creates new branch when it doesn't exist", async () => {
      let callIndex = 0;
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        callIndex++;
        // First call (rev-parse) fails, second call (checkout -b) succeeds
        if (callIndex === 1) {
          return createMockProc("", 1, "fatal: Needed a single revision");
        }
        return createMockProc("");
      });

      const { ensureBranch } = await import("../src/git.ts");
      await ensureBranch("/test/project", "new-branch");

      expect(spawnCalls.length).toBe(2);
      expect(spawnCalls[0].cmd).toEqual(["git", "rev-parse", "--verify", "new-branch"]);
      expect(spawnCalls[1].cmd).toEqual(["git", "checkout", "-b", "new-branch"]);
    });
  });

  describe("commitAndPush", () => {
    test("runs add, commit, push in sequence", async () => {
      let callIndex = 0;
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        callIndex++;
        // Third call returns branch name
        if (callIndex === 3) {
          return createMockProc("feature-branch");
        }
        return createMockProc("");
      });

      const { commitAndPush } = await import("../src/git.ts");
      await commitAndPush("/test/project", "Test commit message");

      expect(spawnCalls.length).toBe(4);
      expect(spawnCalls[0].cmd).toEqual(["git", "add", "-A"]);
      expect(spawnCalls[1].cmd).toEqual(["git", "commit", "-m", "Test commit message"]);
      expect(spawnCalls[2].cmd).toEqual(["git", "rev-parse", "--abbrev-ref", "HEAD"]);
      expect(spawnCalls[3].cmd).toEqual(["git", "push", "-u", "origin", "feature-branch"]);
    });
  });

  describe("createPR", () => {
    test("parses PR number from gh output when no existing PR", async () => {
      let callIndex = 0;
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        callIndex++;
        // First call: gh pr view (check existing) - fails with exit 1
        if (callIndex === 1) {
          return createMockProc("", 1, "no pull requests found");
        }
        // Second call: gh pr create - returns PR URL
        return createMockProc("https://github.com/owner/repo/pull/42");
      });

      const { createPR } = await import("../src/git.ts");
      const prNumber = await createPR("/test/project", "PR Title", "PR Body");

      expect(prNumber).toBe(42);
      expect(spawnCalls[0].cmd).toEqual([
        "gh", "pr", "view",
        "--json", "number",
        "--jq", ".number",
      ]);
      expect(spawnCalls[1].cmd).toEqual([
        "gh", "pr", "create",
        "--title", "PR Title",
        "--body", "PR Body",
      ]);
    });

    test("returns existing PR number if PR already exists", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        // gh pr view returns existing PR number
        return createMockProc("42");
      });

      const { createPR } = await import("../src/git.ts");
      const prNumber = await createPR("/test/project", "PR Title", "PR Body");

      expect(prNumber).toBe(42);
      // Should only call gh pr view, not gh pr create
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0].cmd).toEqual([
        "gh", "pr", "view",
        "--json", "number",
        "--jq", ".number",
      ]);
    });

    test("throws when PR number cannot be parsed", async () => {
      let callIndex = 0;
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        callIndex++;
        // First call: gh pr view - fails (no existing PR)
        if (callIndex === 1) {
          return createMockProc("", 1, "no pull requests found");
        }
        // Second call: gh pr create - returns invalid output
        return createMockProc("Invalid output");
      });

      const { createPR } = await import("../src/git.ts");
      await expect(createPR("/test/project", "Title", "Body"))
        .rejects.toThrow("Failed to parse PR number");
    });
  });

  describe("getPRUrl", () => {
    test("returns PR URL from gh output", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("https://github.com/owner/repo/pull/123");
      });

      const { getPRUrl } = await import("../src/git.ts");
      const url = await getPRUrl("/test/project", 123);

      expect(url).toBe("https://github.com/owner/repo/pull/123");
      expect(spawnCalls[0].cmd).toEqual([
        "gh", "pr", "view", "123",
        "--json", "url",
        "--jq", ".url",
      ]);
    });
  });

  describe("mergePR", () => {
    test("runs gh pr merge command", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("");
      });

      const { mergePR } = await import("../src/git.ts");
      await mergePR("/test/project", 99);

      expect(spawnCalls[0].cmd).toEqual(["gh", "pr", "merge", "99", "--merge"]);
    });
  });

  describe("closePR", () => {
    test("runs gh pr close command", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("");
      });

      const { closePR } = await import("../src/git.ts");
      await closePR("/test/project", 77);

      expect(spawnCalls[0].cmd).toEqual(["gh", "pr", "close", "77"]);
    });
  });

  describe("commentOnPR", () => {
    test("runs gh pr comment command", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("");
      });

      const { commentOnPR } = await import("../src/git.ts");
      await commentOnPR("/test/project", 42, "This is a test comment");

      expect(spawnCalls[0].cmd).toEqual([
        "gh", "pr", "comment", "42",
        "--body", "This is a test comment",
      ]);
    });
  });

  describe("hasChanges", () => {
    test("returns true when there are changes", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc(" M src/file.ts\n?? new-file.ts");
      });

      const { hasChanges } = await import("../src/git.ts");
      const result = await hasChanges("/test/project");

      expect(result).toBe(true);
      expect(spawnCalls[0].cmd).toEqual(["git", "status", "--porcelain"]);
    });

    test("returns false when there are no changes", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("");
      });

      const { hasChanges } = await import("../src/git.ts");
      const result = await hasChanges("/test/project");

      expect(result).toBe(false);
    });
  });

  describe("runGit error handling", () => {
    test("throws on non-zero exit code", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("", 128, "fatal: not a git repository");
      });

      const { runGit } = await import("../src/git.ts");
      await expect(runGit("/test/project", ["status"]))
        .rejects.toThrow("git status failed: fatal: not a git repository");
    });
  });

  describe("runGh error handling", () => {
    test("throws on non-zero exit code", async () => {
      spawnMock.mockImplementation((cmd: string[], options: { cwd: string }) => {
        spawnCalls.push({ cmd, cwd: options.cwd });
        return createMockProc("", 1, "error: not authenticated");
      });

      const { runGh } = await import("../src/git.ts");
      await expect(runGh("/test/project", ["pr", "list"]))
        .rejects.toThrow("gh pr failed: error: not authenticated");
    });
  });
});
