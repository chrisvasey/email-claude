import { describe, test, expect } from "bun:test";
import { parseCommand } from "../src/commands";

describe("commands", () => {
  describe("parseCommand", () => {
    describe("merge command", () => {
      test("parses [merge] command", () => {
        expect(parseCommand("[merge]")).toEqual({ type: "merge" });
      });

      test("parses [merge] at start of subject", () => {
        expect(parseCommand("[merge] Please merge this PR")).toEqual({ type: "merge" });
      });

      test("parses [merge] at end of subject", () => {
        expect(parseCommand("Ready to go [merge]")).toEqual({ type: "merge" });
      });

      test("parses [merge] in middle of subject", () => {
        expect(parseCommand("PR #123 [merge] when ready")).toEqual({ type: "merge" });
      });
    });

    describe("close command", () => {
      test("parses [close] command", () => {
        expect(parseCommand("[close]")).toEqual({ type: "close" });
      });

      test("parses [close] at start of subject", () => {
        expect(parseCommand("[close] Not needed anymore")).toEqual({ type: "close" });
      });

      test("parses [close] at end of subject", () => {
        expect(parseCommand("Abandoning this [close]")).toEqual({ type: "close" });
      });

      test("parses [close] in middle of subject", () => {
        expect(parseCommand("PR #456 [close] please")).toEqual({ type: "close" });
      });
    });

    describe("status command", () => {
      test("parses [status] command", () => {
        expect(parseCommand("[status]")).toEqual({ type: "status" });
      });

      test("parses [status] at start of subject", () => {
        expect(parseCommand("[status] What's the current state?")).toEqual({ type: "status" });
      });

      test("parses [status] at end of subject", () => {
        expect(parseCommand("Check on this [status]")).toEqual({ type: "status" });
      });

      test("parses [status] in middle of subject", () => {
        expect(parseCommand("PR #789 [status] check")).toEqual({ type: "status" });
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
});
