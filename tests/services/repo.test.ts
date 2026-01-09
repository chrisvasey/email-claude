/**
 * Repository Service Tests
 *
 * Tests for auto-cloning repositories
 *
 * Note: We use dynamic imports to avoid Bun's module caching issue
 * where modules imported by other test files get cached before tests run.
 */

import { describe, expect, mock, test } from "bun:test";
import type { RepoOptions } from "../../src/services/repo";

describe("repo service", () => {
	// Helper to create a mock subprocess
	function createMockProc(exitCode: number = 0, stderr: string = "") {
		return {
			exited: Promise.resolve(exitCode),
			stdout: new Response("").body,
			stderr: new Response(stderr).body,
		};
	}

	describe("getRepoUrl", () => {
		test("builds SSH URL from project and owner", async () => {
			const { getRepoUrl } = await import("../../src/services/repo");
			expect(getRepoUrl("email-claude", "chrisvasey")).toBe(
				"git@github.com:chrisvasey/email-claude.git",
			);
		});

		test("handles project names with hyphens", async () => {
			const { getRepoUrl } = await import("../../src/services/repo");
			expect(getRepoUrl("my-cool-project", "someorg")).toBe(
				"git@github.com:someorg/my-cool-project.git",
			);
		});
	});

	describe("repoExists", () => {
		test("returns true when .git/config exists", async () => {
			const { repoExists } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(true));

			const result = await repoExists("/projects/my-repo", {
				fileExists: mockFileExists,
			});

			expect(result).toBe(true);
			expect(mockFileExists).toHaveBeenCalledWith(
				"/projects/my-repo/.git/config",
			);
		});

		test("returns false when .git/config does not exist", async () => {
			const { repoExists } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(false));

			const result = await repoExists("/projects/missing-repo", {
				fileExists: mockFileExists,
			});

			expect(result).toBe(false);
			expect(mockFileExists).toHaveBeenCalledWith(
				"/projects/missing-repo/.git/config",
			);
		});
	});

	describe("ensureRepo", () => {
		test("skips clone when repo already exists", async () => {
			const { ensureRepo } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(true));
			const mockSpawn = mock(() => createMockProc());
			const opts: RepoOptions = {
				fileExists: mockFileExists,
				spawn: mockSpawn as unknown as typeof Bun.spawn,
			};

			const path = await ensureRepo(
				"existing-repo",
				"/projects",
				"owner",
				opts,
			);

			expect(path).toBe("/projects/existing-repo");
			// Should not have called git clone
			expect(mockSpawn).not.toHaveBeenCalled();
		});

		test("clones repo when it does not exist", async () => {
			const { ensureRepo } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(false));
			const spawnCalls: Array<{ cmd: string[] }> = [];
			const mockSpawn = mock((cmd: string[]) => {
				spawnCalls.push({ cmd });
				return createMockProc();
			});
			const opts: RepoOptions = {
				fileExists: mockFileExists,
				spawn: mockSpawn as unknown as typeof Bun.spawn,
			};

			const path = await ensureRepo(
				"new-repo",
				"/projects",
				"chrisvasey",
				opts,
			);

			expect(path).toBe("/projects/new-repo");
			expect(spawnCalls.length).toBe(1);
			expect(spawnCalls[0].cmd).toEqual([
				"git",
				"clone",
				"git@github.com:chrisvasey/new-repo.git",
				"/projects/new-repo",
			]);
		});

		test("throws when GITHUB_OWNER is empty", async () => {
			const { ensureRepo } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(false));
			const mockSpawn = mock(() => createMockProc());
			const opts: RepoOptions = {
				fileExists: mockFileExists,
				spawn: mockSpawn as unknown as typeof Bun.spawn,
			};

			await expect(
				ensureRepo("some-repo", "/projects", "", opts),
			).rejects.toThrow("GITHUB_OWNER is not configured");
		});

		test("throws when git clone fails", async () => {
			const { ensureRepo } = await import("../../src/services/repo");
			const mockFileExists = mock(() => Promise.resolve(false));
			const mockSpawn = mock(() => createMockProc(128, "Repository not found"));
			const opts: RepoOptions = {
				fileExists: mockFileExists,
				spawn: mockSpawn as unknown as typeof Bun.spawn,
			};

			await expect(
				ensureRepo("nonexistent", "/projects", "owner", opts),
			).rejects.toThrow("Failed to clone");
		});
	});
});
