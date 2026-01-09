import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig, validateConfig, getConfig, type Config } from "../src/config";

describe("config", () => {
  // Store original env vars to restore after tests
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save current env vars
    originalEnv.REDIS_URL = process.env.REDIS_URL;
    originalEnv.REDIS_PREFIX = process.env.REDIS_PREFIX;
    originalEnv.RESEND_API_KEY = process.env.RESEND_API_KEY;
    originalEnv.RESEND_WEBHOOK_SECRET = process.env.RESEND_WEBHOOK_SECRET;
    originalEnv.RESEND_FROM_DOMAIN = process.env.RESEND_FROM_DOMAIN;
    originalEnv.ALLOWED_SENDERS = process.env.ALLOWED_SENDERS;
    originalEnv.PROJECTS_DIR = process.env.PROJECTS_DIR;
    originalEnv.SESSIONS_DB = process.env.SESSIONS_DB;

    // Clear all relevant env vars
    delete process.env.REDIS_URL;
    delete process.env.REDIS_PREFIX;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_WEBHOOK_SECRET;
    delete process.env.RESEND_FROM_DOMAIN;
    delete process.env.ALLOWED_SENDERS;
    delete process.env.PROJECTS_DIR;
    delete process.env.SESSIONS_DB;
  });

  afterEach(() => {
    // Restore original env vars
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe("loadConfig", () => {
    test("uses defaults when env vars not set", () => {
      const cfg = loadConfig();

      expect(cfg.redis.url).toBe("redis://localhost:6379");
      expect(cfg.redis.prefix).toBe("email_claude_");
      expect(cfg.resend.apiKey).toBe("");
      expect(cfg.resend.webhookSecret).toBe("");
      expect(cfg.resend.fromDomain).toBe("cc.kindred.agency");
      expect(cfg.security.allowedSenders).toEqual([]);
      expect(cfg.paths.projectsDir).toBe("./projects");
      expect(cfg.paths.sessionsDb).toBe("./db/sessions.db");
    });

    test("env vars override defaults", () => {
      process.env.REDIS_URL = "redis://custom:6380";
      process.env.REDIS_PREFIX = "custom_prefix_";
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.RESEND_WEBHOOK_SECRET = "whsec_secret";
      process.env.RESEND_FROM_DOMAIN = "example.com";
      process.env.PROJECTS_DIR = "/custom/projects";
      process.env.SESSIONS_DB = "/custom/db/sessions.db";

      const cfg = loadConfig();

      expect(cfg.redis.url).toBe("redis://custom:6380");
      expect(cfg.redis.prefix).toBe("custom_prefix_");
      expect(cfg.resend.apiKey).toBe("re_test_key");
      expect(cfg.resend.webhookSecret).toBe("whsec_secret");
      expect(cfg.resend.fromDomain).toBe("example.com");
      expect(cfg.paths.projectsDir).toBe("/custom/projects");
      expect(cfg.paths.sessionsDb).toBe("/custom/db/sessions.db");
    });

    describe("allowedSenders parsing", () => {
      test("parses comma-separated list", () => {
        process.env.ALLOWED_SENDERS = "user1@example.com,user2@example.com,user3@example.com";

        const cfg = loadConfig();

        expect(cfg.security.allowedSenders).toEqual([
          "user1@example.com",
          "user2@example.com",
          "user3@example.com",
        ]);
      });

      test("trims whitespace from entries", () => {
        process.env.ALLOWED_SENDERS = " user1@example.com , user2@example.com , user3@example.com ";

        const cfg = loadConfig();

        expect(cfg.security.allowedSenders).toEqual([
          "user1@example.com",
          "user2@example.com",
          "user3@example.com",
        ]);
      });

      test("filters empty entries", () => {
        process.env.ALLOWED_SENDERS = "user1@example.com,,user2@example.com,";

        const cfg = loadConfig();

        expect(cfg.security.allowedSenders).toEqual([
          "user1@example.com",
          "user2@example.com",
        ]);
      });

      test("returns empty array for empty string", () => {
        process.env.ALLOWED_SENDERS = "";

        const cfg = loadConfig();

        expect(cfg.security.allowedSenders).toEqual([]);
      });

      test("handles single sender", () => {
        process.env.ALLOWED_SENDERS = "solo@example.com";

        const cfg = loadConfig();

        expect(cfg.security.allowedSenders).toEqual(["solo@example.com"]);
      });
    });
  });

  describe("validateConfig", () => {
    test("throws for missing RESEND_API_KEY", () => {
      const cfg: Config = {
        redis: { url: "redis://localhost:6379", prefix: "test_" },
        resend: { apiKey: "", webhookSecret: "secret", fromDomain: "example.com" },
        security: { allowedSenders: [] },
        paths: { projectsDir: "./projects", sessionsDb: "./db/sessions.db" },
      };

      expect(() => validateConfig(cfg)).toThrow("RESEND_API_KEY");
    });

    test("throws for missing RESEND_WEBHOOK_SECRET", () => {
      const cfg: Config = {
        redis: { url: "redis://localhost:6379", prefix: "test_" },
        resend: { apiKey: "key", webhookSecret: "", fromDomain: "example.com" },
        security: { allowedSenders: [] },
        paths: { projectsDir: "./projects", sessionsDb: "./db/sessions.db" },
      };

      expect(() => validateConfig(cfg)).toThrow("RESEND_WEBHOOK_SECRET");
    });

    test("throws with all missing required vars listed", () => {
      const cfg: Config = {
        redis: { url: "redis://localhost:6379", prefix: "test_" },
        resend: { apiKey: "", webhookSecret: "", fromDomain: "example.com" },
        security: { allowedSenders: [] },
        paths: { projectsDir: "./projects", sessionsDb: "./db/sessions.db" },
      };

      expect(() => validateConfig(cfg)).toThrow(
        "Missing required environment variables: RESEND_API_KEY, RESEND_WEBHOOK_SECRET"
      );
    });

    test("does not throw when all required vars are set", () => {
      const cfg: Config = {
        redis: { url: "redis://localhost:6379", prefix: "test_" },
        resend: { apiKey: "key", webhookSecret: "secret", fromDomain: "example.com" },
        security: { allowedSenders: [] },
        paths: { projectsDir: "./projects", sessionsDb: "./db/sessions.db" },
      };

      expect(() => validateConfig(cfg)).not.toThrow();
    });
  });

  describe("getConfig", () => {
    test("throws when required vars missing", () => {
      expect(() => getConfig()).toThrow("Missing required environment variables");
    });

    test("returns config when all required vars set", () => {
      process.env.RESEND_API_KEY = "re_test_key";
      process.env.RESEND_WEBHOOK_SECRET = "whsec_secret";

      const cfg = getConfig();

      expect(cfg.resend.apiKey).toBe("re_test_key");
      expect(cfg.resend.webhookSecret).toBe("whsec_secret");
    });
  });
});
