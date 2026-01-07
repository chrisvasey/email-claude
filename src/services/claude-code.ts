/**
 * Claude Code CLI Wrapper Service
 *
 * This service wraps the local Claude Code CLI and provides a programmatic
 * interface for sending prompts and receiving responses via JSON communication.
 *
 * Adapted from: deno-worker/services/claude-code.ts
 */

export interface ClaudeCodeMessage {
  type: "user" | "assistant" | "tool_use" | "tool_result" | "error";
  from: "user" | "assistant";
  content: string;
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
  autoApprove?: boolean; // NEW: --yes flag for email automation
}

export class ClaudeCodeService {
  private process: Deno.ChildProcess | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
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

    if (this.options.permissionMode) {
      args.push("--permission-mode", this.options.permissionMode);
    }

    // Auto-approve all actions (for automated workflows like email)
    if (this.options.autoApprove) {
      args.push("--yes");
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

    // Spawn the claude CLI
    const command = new Deno.Command("claude", {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      cwd: this.options.cwd,
    });

    this.process = command.spawn();
    this.reader = this.process.stdout.getReader();

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
    if (!this.process) return;

    const stderrReader = this.process.stderr.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await stderrReader.read();
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
    if (!this.reader) return;

    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await this.reader.read();
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
   * Send a prompt to Claude Code
   */
  async query(prompt: string): Promise<void> {
    if (!this.writer) {
      throw new Error("Claude Code service not started");
    }

    const message = JSON.stringify({ prompt }) + "\n";
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(message));
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
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        // Ignore errors
      }
      this.reader = null;
    }

    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        // Ignore errors
      }
      this.writer = null;
    }

    if (this.process) {
      try {
        this.process.kill("SIGTERM");
        await this.process.status;
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
