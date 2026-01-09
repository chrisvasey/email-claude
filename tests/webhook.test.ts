/**
 * Webhook Module Tests
 *
 * Tests for the HTTP webhook server handling Resend inbound emails
 */

import {
  describe,
  test,
  expect,
  beforeEach,
  afterEach,
  mock,
  spyOn,
} from "bun:test";
import { createHmac } from "crypto";
import {
  verifySignature,
  extractProject,
  isAllowedSender,
  handleHealth,
  handleEmailWebhook,
  createServer,
  type ResendInboundPayload,
} from "../src/webhook";
import type { Config } from "../src/config";

describe("webhook module", () => {
  describe("verifySignature", () => {
    const secret = "test-webhook-secret";

    test("returns true for valid signature with timestamp", () => {
      const payload = '{"type":"email.received"}';
      const timestamp = "1234567890";
      const signedPayload = `${timestamp}.${payload}`;
      const signature = createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");
      const header = `v1,${timestamp},${signature}`;

      expect(verifySignature(payload, header, secret)).toBe(true);
    });

    test("returns false for invalid signature", () => {
      const payload = '{"type":"email.received"}';
      const header = "v1,1234567890,invalid-signature";

      expect(verifySignature(payload, header, secret)).toBe(false);
    });

    test("returns false for empty signature header", () => {
      const payload = '{"type":"email.received"}';

      expect(verifySignature(payload, "", secret)).toBe(false);
    });

    test("returns false for wrong secret", () => {
      const payload = '{"type":"email.received"}';
      const timestamp = "1234567890";
      const signedPayload = `${timestamp}.${payload}`;
      const signature = createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");
      const header = `v1,${timestamp},${signature}`;

      expect(verifySignature(payload, header, "wrong-secret")).toBe(false);
    });

    test("handles multiple signatures separated by space", () => {
      const payload = '{"type":"email.received"}';
      const timestamp = "1234567890";
      const signedPayload = `${timestamp}.${payload}`;
      const validSig = createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");
      const header = `v1,9999999999,invalid v1,${timestamp},${validSig}`;

      expect(verifySignature(payload, header, secret)).toBe(true);
    });
  });

  describe("extractProject", () => {
    test("extracts project from simple email address", () => {
      expect(extractProject("webapp@domain.com")).toBe("webapp");
    });

    test("extracts project from email with name format", () => {
      expect(extractProject("Webapp <webapp@domain.com>")).toBe("webapp");
    });

    test("extracts project with hyphen", () => {
      expect(extractProject("my-project@code.patch.agency")).toBe("my-project");
    });

    test("normalizes to lowercase", () => {
      expect(extractProject("MyProject@Domain.com")).toBe("myproject");
    });

    test("trims whitespace", () => {
      expect(extractProject("  webapp@domain.com  ")).toBe("webapp");
    });

    test("handles complex email format", () => {
      expect(extractProject('"Test Project" <test-project@example.com>')).toBe(
        "test-project"
      );
    });
  });

  describe("isAllowedSender", () => {
    test("allows all senders when allowlist is empty", () => {
      expect(isAllowedSender("anyone@anywhere.com", [])).toBe(true);
    });

    test("allows exact email match", () => {
      const allowedSenders = ["allowed@example.com"];

      expect(isAllowedSender("allowed@example.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("notallowed@example.com", allowedSenders)).toBe(
        false
      );
    });

    test("allows exact email match case-insensitive", () => {
      const allowedSenders = ["Allowed@Example.com"];

      expect(isAllowedSender("allowed@example.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("ALLOWED@EXAMPLE.COM", allowedSenders)).toBe(true);
    });

    test("allows wildcard domain match", () => {
      const allowedSenders = ["*@company.com"];

      expect(isAllowedSender("alice@company.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("bob@company.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("someone@other.com", allowedSenders)).toBe(false);
    });

    test("extracts email from name format", () => {
      const allowedSenders = ["allowed@example.com"];

      expect(
        isAllowedSender("Alice Smith <allowed@example.com>", allowedSenders)
      ).toBe(true);
    });

    test("allows multiple allowed senders", () => {
      const allowedSenders = [
        "alice@example.com",
        "bob@example.com",
        "*@company.com",
      ];

      expect(isAllowedSender("alice@example.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("bob@example.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("anyone@company.com", allowedSenders)).toBe(true);
      expect(isAllowedSender("charlie@other.com", allowedSenders)).toBe(false);
    });
  });

  describe("handleHealth", () => {
    test("returns 200 with ok status", async () => {
      const response = handleHealth();

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toBe("application/json");

      const body = await response.json();
      expect(body).toEqual({ status: "ok" });
    });
  });

  describe("handleEmailWebhook", () => {
    const testConfig: Config = {
      redis: {
        url: "redis://localhost:6379",
        prefix: "test_email_claude_",
      },
      resend: {
        apiKey: "re_test_key",
        webhookSecret: "test-webhook-secret",
        fromDomain: "test.example.com",
      },
      security: {
        allowedSenders: ["allowed@example.com", "*@company.com"],
      },
      paths: {
        projectsDir: "./projects",
        sessionsDb: ":memory:",
      },
    };

    function createValidPayload(): ResendInboundPayload {
      return {
        type: "email.received",
        created_at: "2024-01-01T00:00:00.000Z",
        data: {
          email_id: "test-email-123",
          from: "allowed@example.com",
          to: ["my-project@code.patch.agency"],
          subject: "Test Feature Request",
          message_id: "<test-123@mail.example.com>",
          created_at: "2024-01-01T00:00:00.000Z",
        },
      };
    }

    function createSignedRequest(
      payload: object,
      secret: string = testConfig.resend.webhookSecret
    ): Request {
      const body = JSON.stringify(payload);
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${body}`;
      const signature = createHmac("sha256", secret)
        .update(signedPayload)
        .digest("base64");
      const header = `v1,${timestamp},${signature}`;

      return new Request("http://localhost/webhook/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-signature": header,
        },
        body,
      });
    }

    test("returns 401 for invalid signature", async () => {
      const payload = createValidPayload();
      const body = JSON.stringify(payload);

      const req = new Request("http://localhost/webhook/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-signature": "v1,1234567890,invalid-signature",
        },
        body,
      });

      const response = await handleEmailWebhook(req, testConfig);

      expect(response.status).toBe(401);
      const json = await response.json();
      expect(json.error).toBe("Invalid signature");
    });

    test("returns 403 for non-allowed sender", async () => {
      const payload = createValidPayload();
      payload.data.from = "notallowed@random.com";

      const req = createSignedRequest(payload);
      const response = await handleEmailWebhook(req, testConfig);

      expect(response.status).toBe(403);
      const json = await response.json();
      expect(json.error).toBe("Sender not allowed");
    });

    test("returns 400 for invalid JSON", async () => {
      const body = "not valid json";
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const signedPayload = `${timestamp}.${body}`;
      const signature = createHmac("sha256", testConfig.resend.webhookSecret)
        .update(signedPayload)
        .digest("base64");
      const header = `v1,${timestamp},${signature}`;

      const req = new Request("http://localhost/webhook/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "svix-signature": header,
        },
        body,
      });

      const response = await handleEmailWebhook(req, testConfig);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid JSON");
    });

    test("returns 400 for unsupported event type", async () => {
      const payload = {
        type: "email.sent",
        data: {},
      };

      const req = createSignedRequest(payload);
      const response = await handleEmailWebhook(req, testConfig);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Unsupported event type");
    });

    test("returns 400 for no recipient address", async () => {
      const payload = createValidPayload();
      payload.data.to = [];

      const req = createSignedRequest(payload);
      const response = await handleEmailWebhook(req, testConfig);

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("No recipient address");
    });
  });

  describe("createServer", () => {
    let server: ReturnType<typeof createServer> | null = null;

    afterEach(() => {
      if (server) {
        server.stop();
        server = null;
      }
    });

    test("starts server on specified port", () => {
      const testConfig: Config = {
        redis: {
          url: "redis://localhost:6379",
          prefix: "test_",
        },
        resend: {
          apiKey: "test",
          webhookSecret: "test",
          fromDomain: "example.com",
        },
        security: {
          allowedSenders: [],
        },
        paths: {
          projectsDir: "./projects",
          sessionsDb: ":memory:",
        },
      };

      server = createServer(0, testConfig); // Port 0 for random available port

      expect(server.port).toBeGreaterThan(0);
    });

    test("responds to /health endpoint", async () => {
      const testConfig: Config = {
        redis: {
          url: "redis://localhost:6379",
          prefix: "test_",
        },
        resend: {
          apiKey: "test",
          webhookSecret: "test",
          fromDomain: "example.com",
        },
        security: {
          allowedSenders: [],
        },
        paths: {
          projectsDir: "./projects",
          sessionsDb: ":memory:",
        },
      };

      server = createServer(0, testConfig);

      const response = await fetch(`http://localhost:${server.port}/health`);

      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json).toEqual({ status: "ok" });
    });

    test("returns 404 for unknown routes", async () => {
      const testConfig: Config = {
        redis: {
          url: "redis://localhost:6379",
          prefix: "test_",
        },
        resend: {
          apiKey: "test",
          webhookSecret: "test",
          fromDomain: "example.com",
        },
        security: {
          allowedSenders: [],
        },
        paths: {
          projectsDir: "./projects",
          sessionsDb: ":memory:",
        },
      };

      server = createServer(0, testConfig);

      const response = await fetch(
        `http://localhost:${server.port}/unknown/path`
      );

      expect(response.status).toBe(404);
      const json = await response.json();
      expect(json.error).toBe("Not found");
    });

    test("handles POST /webhook/email with invalid signature", async () => {
      const testConfig: Config = {
        redis: {
          url: "redis://localhost:6379",
          prefix: "test_",
        },
        resend: {
          apiKey: "test",
          webhookSecret: "test-secret",
          fromDomain: "example.com",
        },
        security: {
          allowedSenders: [],
        },
        paths: {
          projectsDir: "./projects",
          sessionsDb: ":memory:",
        },
      };

      server = createServer(0, testConfig);

      const response = await fetch(
        `http://localhost:${server.port}/webhook/email`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "svix-signature": "v1,1234567890,invalid",
          },
          body: JSON.stringify({ type: "email.received" }),
        }
      );

      expect(response.status).toBe(401);
    });
  });
});
