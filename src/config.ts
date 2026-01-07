/**
 * Environment configuration module for email-claude
 *
 * Provides typed configuration with defaults and validation.
 */

export interface Config {
  redis: {
    url: string;
    prefix: string;
  };
  resend: {
    apiKey: string;
    webhookSecret: string;
    fromEmail: string;
  };
  security: {
    allowedSenders: string[];
  };
  paths: {
    projectsDir: string;
    sessionsDb: string;
  };
  // Development mode - skips webhook signature verification
  devMode: boolean;
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): Config {
  return {
    redis: {
      url: process.env.REDIS_URL || "redis://localhost:6379",
      prefix: process.env.REDIS_PREFIX || "email_claude_",
    },
    resend: {
      apiKey: process.env.RESEND_API_KEY || "",
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET || "",
      fromEmail: process.env.RESEND_FROM_EMAIL || "claude@code.patch.agency",
    },
    security: {
      allowedSenders: (process.env.ALLOWED_SENDERS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    },
    paths: {
      projectsDir: process.env.PROJECTS_DIR || "./projects",
      sessionsDb: process.env.SESSIONS_DB || "./db/sessions.db",
    },
    devMode: process.env.DEV_MODE === "true",
  };
}

/**
 * Validate that all required environment variables are set
 * @throws Error if any required variables are missing
 */
export function validateConfig(cfg: Config): void {
  const missing: string[] = [];

  if (!cfg.resend.apiKey) {
    missing.push("RESEND_API_KEY");
  }

  if (!cfg.resend.webhookSecret) {
    missing.push("RESEND_WEBHOOK_SECRET");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }
}

/**
 * Load and validate configuration
 * @throws Error if required variables are missing
 */
export function getConfig(): Config {
  const cfg = loadConfig();
  validateConfig(cfg);
  return cfg;
}

// Export a lazily-validated config for convenience
export const config = loadConfig();
