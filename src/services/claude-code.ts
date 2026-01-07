/**
 * Claude Code CLI Wrapper Service
 *
 * This service wraps the local Claude Code CLI and provides a programmatic
 * interface for sending prompts and receiving responses via JSON communication.
 *
 * Ported from: deno-worker/services/claude-code.ts (Deno → Bun)
 */

import type { Subprocess } from "bun";

export interface ClaudeCodeMessage {
  type: "user" | "assistant" | "tool_use" | "tool_result" | "error" | "result";
  from?: "user" | "assistant";
  content?: string;
  message?: {
    content: Array<{ type: string; text?: string }>;
  };
  result?: string;
  error?: string;
  timestamp?: Date;
  tool_name?: string;
  tool_input?: unknown;
}

export interface ClaudeCodeOptions {
  cwd?: string;
  model?: string;
  allowedTools?: string[];
  permissionMode?: "ask" | "acceptEdits" | "acceptAll";
  sessionId?: string;
  resumeSession?: boolean;
  autoApprove?: boolean; // --yes flag for email automation
}

export class ClaudeCodeService {
  private process: Subprocess | null = null;
  private buffer = "";
  private messageCallbacks: Set<(message: ClaudeCodeMessage) => void> =
    new Set();
  private completeCallbacks: Set<() => void> = new Set();

  constructor(private options: ClaudeCodeOptions = {}) {}

  /**
   * Build the CLI arguments
   */
  private buildArgs(prompt: string): string[] {
    const args = [
      "-p", // Print mode (non-interactive)
      "--verbose", // Required for stream-json
      "--output-format", "stream-json", // Streaming JSON output
    ];

    if (this.options.model) {
      args.push("--model", this.options.model);
    }

    // Auto-approve all actions (for automated workflows like email)
    // If autoApprove is true, use bypassPermissions; otherwise use provided permissionMode
    if (this.options.autoApprove) {
      args.push("--permission-mode", "bypassPermissions");
    } else if (this.options.permissionMode) {
      args.push("--permission-mode", this.options.permissionMode);
    }

    // Add session resumption if sessionId is provided and not a new session
    if (this.options.sessionId && this.options.resumeSession) {
      args.push("--resume", this.options.sessionId);
    }

    // Add the prompt as the final argument
    args.push(prompt);

    return args;
  }

  /**
   * Start the Claude Code CLI process with a prompt
   */
  async start(prompt?: string): Promise<void> {
    // For backward compatibility, if no prompt, just prepare
    if (!prompt) {
      console.log(`[ClaudeCode] Prepared (waiting for query)`);
      return;
    }

    await this.runWithPrompt(prompt);
  }

  /**
   * Run Claude CLI with a specific prompt
   */
  private async runWithPrompt(prompt: string): Promise<void> {
    const args = this.buildArgs(prompt);

    console.log(`[ClaudeCode] Starting with args:`, args.slice(0, -1), `"${prompt.substring(0, 50)}..."`);
    console.log(`[ClaudeCode] Working directory:`, this.options.cwd);

    // Spawn the claude CLI using Bun
    this.process = Bun.spawn(["claude", ...args], {
      cwd: this.options.cwd,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Start reading stderr for debugging
    this.readStderr();

    // Start reading output
    this.readOutput();

    console.log(`[ClaudeCode] Process started`);
  }

  /**
   * Read stderr for debugging
   */
  private async readStderr(): Promise<void> {
    if (!this.process?.stderr) return;

    const reader = this.process.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value, { stream: true });
        if (text.trim()) {
          console.error(`[ClaudeCode stderr]`, text);
        }
      }
    } catch (error) {
      console.error("[ClaudeCode] Error reading stderr:", error);
    }
  }

  /**
   * Read and parse JSON output from Claude Code CLI
   */
  private async readOutput(): Promise<void> {
    if (!this.process?.stdout) return;

    const reader = this.process.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        this.buffer += decoder.decode(value, { stream: true });

        // Process complete JSON messages
        let newlineIndex;
        while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
          const line = this.buffer.slice(0, newlineIndex).trim();
          this.buffer = this.buffer.slice(newlineIndex + 1);

          if (line) {
            console.log(`[ClaudeCode stdout]`, line.substring(0, 200));
            try {
              const message = JSON.parse(line) as ClaudeCodeMessage;
              this.notifyMessage(message);
            } catch (error) {
              console.error("Failed to parse JSON:", line, error);
            }
          }
        }
      }
      // Stream ended normally
      console.log(`[ClaudeCode] Output stream ended`);
      this.notifyComplete();
    } catch (error) {
      console.error("Error reading output:", error);
      const message = error instanceof Error ? error.message : String(error);
      this.notifyMessage({
        type: "error",
        from: "assistant",
        content: `Stream error: ${message}`,
        timestamp: new Date(),
      });
      this.notifyComplete();
    }
  }

  /**
   * Subscribe to messages from Claude Code
   */
  onMessage(callback: (message: ClaudeCodeMessage) => void): () => void {
    this.messageCallbacks.add(callback);
    return () => this.messageCallbacks.delete(callback);
  }

  /**
   * Subscribe to process completion
   */
  onComplete(callback: () => void): () => void {
    this.completeCallbacks.add(callback);
    return () => this.completeCallbacks.delete(callback);
  }

  /**
   * Notify all complete callbacks
   */
  private notifyComplete(): void {
    for (const callback of this.completeCallbacks) {
      try {
        callback();
      } catch (error) {
        console.error("Error in complete callback:", error);
      }
    }
  }

  /**
   * Notify all message callbacks
   */
  private notifyMessage(message: ClaudeCodeMessage): void {
    for (const callback of this.messageCallbacks) {
      try {
        callback(message);
      } catch (error) {
        console.error("Error in message callback:", error);
      }
    }
  }

  /**
   * Stop the Claude Code CLI process
   */
  async stop(): Promise<void> {
    if (this.process) {
      try {
        this.process.kill();
        await this.process.exited;
      } catch {
        // Ignore errors
      }
      this.process = null;
    }

    this.buffer = "";
    this.messageCallbacks.clear();
    this.completeCallbacks.clear();
  }

  /**
   * Check if the service is running
   */
  isRunning(): boolean {
    return this.process !== null;
  }
}
