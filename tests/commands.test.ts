import { describe, expect, test } from "bun:test";
import {
	detectApproval,
	detectPlanTrigger,
	parseCommand,
} from "../src/commands";

describe("commands", () => {
	describe("parseCommand", () => {
		describe("merge command", () => {
			test("parses [merge] command", () => {
				expect(parseCommand("[merge]")).toEqual({ type: "merge" });
			});

			test("parses [merge] at start of subject", () => {
				expect(parseCommand("[merge] Please merge this PR")).toEqual({
					type: "merge",
				});
			});

			test("parses [merge] at end of subject", () => {
				expect(parseCommand("Ready to go [merge]")).toEqual({ type: "merge" });
			});

			test("parses [merge] in middle of subject", () => {
				expect(parseCommand("PR #123 [merge] when ready")).toEqual({
					type: "merge",
				});
			});
		});

		describe("close command", () => {
			test("parses [close] command", () => {
				expect(parseCommand("[close]")).toEqual({ type: "close" });
			});

			test("parses [close] at start of subject", () => {
				expect(parseCommand("[close] Not needed anymore")).toEqual({
					type: "close",
				});
			});

			test("parses [close] at end of subject", () => {
				expect(parseCommand("Abandoning this [close]")).toEqual({
					type: "close",
				});
			});

			test("parses [close] in middle of subject", () => {
				expect(parseCommand("PR #456 [close] please")).toEqual({
					type: "close",
				});
			});
		});

		describe("status command", () => {
			test("parses [status] command", () => {
				expect(parseCommand("[status]")).toEqual({ type: "status" });
			});

			test("parses [status] at start of subject", () => {
				expect(parseCommand("[status] What's the current state?")).toEqual({
					type: "status",
				});
			});

			test("parses [status] at end of subject", () => {
				expect(parseCommand("Check on this [status]")).toEqual({
					type: "status",
				});
			});

			test("parses [status] in middle of subject", () => {
				expect(parseCommand("PR #789 [status] check")).toEqual({
					type: "status",
				});
			});
		});

		describe("case insensitivity", () => {
			test("parses [MERGE] uppercase", () => {
				expect(parseCommand("[MERGE]")).toEqual({ type: "merge" });
			});

			test("parses [Merge] mixed case", () => {
				expect(parseCommand("[Merge]")).toEqual({ type: "merge" });
			});

			test("parses [CLOSE] uppercase", () => {
				expect(parseCommand("[CLOSE]")).toEqual({ type: "close" });
			});

			test("parses [Close] mixed case", () => {
				expect(parseCommand("[Close]")).toEqual({ type: "close" });
			});

			test("parses [STATUS] uppercase", () => {
				expect(parseCommand("[STATUS]")).toEqual({ type: "status" });
			});

			test("parses [Status] mixed case", () => {
				expect(parseCommand("[Status]")).toEqual({ type: "status" });
			});

			test("parses [MeRgE] weird case", () => {
				expect(parseCommand("[MeRgE]")).toEqual({ type: "merge" });
			});
		});

		describe("plan command", () => {
			test("parses [plan] command", () => {
				expect(parseCommand("[plan]")).toEqual({ type: "plan" });
			});

			test("parses [plan] at start of subject", () => {
				expect(parseCommand("[plan] Add user authentication")).toEqual({
					type: "plan",
				});
			});

			test("parses [plan] at end of subject", () => {
				expect(parseCommand("Add new feature [plan]")).toEqual({
					type: "plan",
				});
			});

			test("parses [PLAN] uppercase", () => {
				expect(parseCommand("[PLAN] something")).toEqual({ type: "plan" });
			});
		});

		describe("confirm command", () => {
			test("parses [confirm] command", () => {
				expect(parseCommand("[confirm]")).toEqual({ type: "confirm" });
			});

			test("parses [confirm] at start of subject", () => {
				expect(parseCommand("[confirm] Looks good")).toEqual({
					type: "confirm",
				});
			});

			test("parses [CONFIRM] uppercase", () => {
				expect(parseCommand("[CONFIRM]")).toEqual({ type: "confirm" });
			});
		});

		describe("cancel command", () => {
			test("parses [cancel] command", () => {
				expect(parseCommand("[cancel]")).toEqual({ type: "cancel" });
			});

			test("parses [cancel] at start of subject", () => {
				expect(parseCommand("[cancel] Never mind")).toEqual({ type: "cancel" });
			});

			test("parses [CANCEL] uppercase", () => {
				expect(parseCommand("[CANCEL]")).toEqual({ type: "cancel" });
			});
		});

		describe("no command", () => {
			test("returns null for empty string", () => {
				expect(parseCommand("")).toBeNull();
			});

			test("returns null for subject without command", () => {
				expect(parseCommand("Just a regular email subject")).toBeNull();
			});

			test("returns null for partial command merge", () => {
				expect(parseCommand("merge")).toBeNull();
			});

			test("returns null for partial command [merge", () => {
				expect(parseCommand("[merge")).toBeNull();
			});

			test("returns null for partial command merge]", () => {
				expect(parseCommand("merge]")).toBeNull();
			});

			test("returns null for command with spaces [merge ]", () => {
				expect(parseCommand("[merge ]")).toBeNull();
			});

			test("returns null for command with spaces [ merge]", () => {
				expect(parseCommand("[ merge]")).toBeNull();
			});
		});
	});

	describe("detectPlanTrigger", () => {
		test("detects 'plan for' in subject", () => {
			expect(detectPlanTrigger("Plan for adding authentication", "")).toBe(
				true,
			);
		});

		test("detects 'write a plan' in body", () => {
			expect(detectPlanTrigger("New feature", "Write a plan for this")).toBe(
				true,
			);
		});

		test("detects 'write me a plan' in body", () => {
			expect(detectPlanTrigger("Feature", "Please write me a plan")).toBe(true);
		});

		test("detects 'before you start' in body", () => {
			expect(
				detectPlanTrigger("Add login", "Before you start implementing"),
			).toBe(true);
		});

		test("detects 'don't implement yet' in body", () => {
			expect(
				detectPlanTrigger("Feature", "Don't implement yet, just outline"),
			).toBe(true);
		});

		test("detects 'just plan' in body", () => {
			expect(detectPlanTrigger("Feature", "Just plan this out")).toBe(true);
		});

		test("returns false for normal request", () => {
			expect(detectPlanTrigger("Add login button", "Simple feature")).toBe(
				false,
			);
		});

		test("returns false for similar but non-matching text", () => {
			expect(detectPlanTrigger("Planning to add a button", "")).toBe(false);
		});
	});

	describe("detectApproval", () => {
		test("detects 'looks good'", () => {
			expect(detectApproval("Re: Plan", "Looks good")).toBe(true);
		});

		test("detects 'lgtm'", () => {
			expect(detectApproval("Re: Plan", "LGTM")).toBe(true);
		});

		test("detects 'approved'", () => {
			expect(detectApproval("Re: Plan", "Approved")).toBe(true);
		});

		test("detects 'go ahead'", () => {
			expect(detectApproval("Re: Plan", "Go ahead")).toBe(true);
		});

		test("detects 'proceed'", () => {
			expect(detectApproval("Re: Plan", "Proceed with the plan")).toBe(true);
		});

		test("detects 'ship it'", () => {
			expect(detectApproval("Re: Plan", "Ship it!")).toBe(true);
		});

		test("detects simple 'yes'", () => {
			expect(detectApproval("Re: Plan", "Yes")).toBe(true);
		});

		test("detects simple 'ok'", () => {
			expect(detectApproval("Re: Plan", "Ok")).toBe(true);
		});

		test("detects [confirm] command", () => {
			expect(detectApproval("[confirm] Re: Plan", "")).toBe(true);
		});

		test("rejects 'looks good but...' as revision", () => {
			expect(
				detectApproval("Re: Plan", "Looks good but add error handling"),
			).toBe(false);
		});

		test("rejects questions as revision", () => {
			expect(
				detectApproval("Re: Plan", "Looks good, can you also add tests?"),
			).toBe(false);
		});

		test("rejects 'change' as revision", () => {
			expect(detectApproval("Re: Plan", "Please change step 3")).toBe(false);
		});

		test("rejects 'instead' as revision", () => {
			expect(detectApproval("Re: Plan", "Instead of that, do this")).toBe(
				false,
			);
		});

		test("rejects 'also add' as revision", () => {
			expect(
				detectApproval("Re: Plan", "Looks good, also add validation"),
			).toBe(false);
		});

		test("rejects 'wait' as revision", () => {
			expect(
				detectApproval("Re: Plan", "Wait, I want to change something"),
			).toBe(false);
		});

		test("returns false for neutral message", () => {
			expect(detectApproval("Re: Plan", "Thanks for the plan")).toBe(false);
		});
	});
});
