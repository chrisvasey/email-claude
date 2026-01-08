/**
 * Repository Service Tests
 *
 * Tests for auto-cloning repositories
 */

import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
// Note: We import dynamically inside tests to ensure mocks are set up first

describe("repo service", () => {
  // Store original Bun.spawn and Bun.file
  const originalSpawn = Bun.spawn;
  const originalFile = Bun.file;
  let spawnMock: ReturnType<typeof mock>;
  let fileMock: ReturnType<typeof mock>;
  let spawnCalls: Array<{ cmd: string[] }>;

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
    spawnMock = mock((cmd: string[]) => {
      spawnCalls.push({ cmd });
      return createMockProc("");
    });
  });

  afterEach(() => {
    // Restore originals
    Bun.spawn = originalSpawn;
    Bun.file = originalFile;
  });

  describe("getRepoUrl", () => {
    test("builds SSH URL from project and owner", async () => {
      const { getRepoUrl } = await import("../../src/services/repo");
      expect(getRepoUrl("email-claude", "chrisvasey")).toBe(
        "git@github.com:chrisvasey/email-claude.git"
      );
    });

    test("handles project names with hyphens", async () => {
      const { getRepoUrl } = await import("../../src/services/repo");
      expect(getRepoUrl("my-cool-project", "someorg")).toBe(
        "git@github.com:someorg/my-cool-project.git"
      );
    });
  });

  describe("repoExists", () => {
    test("returns true when .git/config exists", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(true),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;

      const { repoExists } = await import("../../src/services/repo");
      const result = await repoExists("/projects/my-repo");

      expect(result).toBe(true);
      expect(fileMock).toHaveBeenCalledWith("/projects/my-repo/.git/config");
    });

    test("returns false when .git/config does not exist", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(false),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;

      const { repoExists } = await import("../../src/services/repo");
      const result = await repoExists("/projects/missing-repo");

      expect(result).toBe(false);
    });
  });

  describe("ensureRepo", () => {
    test("skips clone when repo already exists", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(true),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;
      // @ts-expect-error - we're mocking Bun.spawn
      Bun.spawn = spawnMock;

      const { ensureRepo } = await import("../../src/services/repo");
      const path = await ensureRepo("existing-repo", "/projects", "owner");

      expect(path).toBe("/projects/existing-repo");
      // Should not have called git clone
      expect(spawnCalls.length).toBe(0);
    });

    test("clones repo when it does not exist", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(false),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;
      // @ts-expect-error - we're mocking Bun.spawn
      Bun.spawn = spawnMock;

      const { ensureRepo } = await import("../../src/services/repo");
      const path = await ensureRepo("new-repo", "/projects", "chrisvasey");

      expect(path).toBe("/projects/new-repo");
      expect(spawnCalls.length).toBe(1);
      expect(spawnCalls[0].cmd).toEqual([
        "git", "clone",
        "git@github.com:chrisvasey/new-repo.git",
        "/projects/new-repo",
      ]);
    });

    test("throws when GITHUB_OWNER is empty", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(false),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;
      // @ts-expect-error - we're mocking Bun.spawn
      Bun.spawn = spawnMock;

      const { ensureRepo } = await import("../../src/services/repo");
      await expect(ensureRepo("some-repo", "/projects", ""))
        .rejects.toThrow("GITHUB_OWNER is not configured");
    });

    test("throws when git clone fails", async () => {
      fileMock = mock(() => ({
        exists: () => Promise.resolve(false),
      }));
      // @ts-expect-error - we're mocking Bun.file
      Bun.file = fileMock;

      const failingSpawnMock = mock(() => {
        return createMockProc("", 128, "Repository not found");
      });
      // @ts-expect-error - we're mocking Bun.spawn
      Bun.spawn = failingSpawnMock;

      const { ensureRepo } = await import("../../src/services/repo");
      await expect(ensureRepo("nonexistent", "/projects", "owner"))
        .rejects.toThrow("Failed to clone");
    });
  });
});
