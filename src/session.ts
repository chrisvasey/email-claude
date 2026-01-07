/**
 * SQLite Session Management Module
 *
 * Manages email thread sessions using Bun's built-in SQLite.
 * Sessions are keyed by normalized subject line hash to track
 * email conversations across multiple replies.
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";

export interface Session {
  id: string;
  subjectHash: string;
  project: string;
  branchName: string;
  claudeSessionId: string | null;
  prNumber: number | null;
  createdAt: string;
  lastActivity: string;
}

export interface SessionMessage {
  id: number;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface InboundEmail {
  from: string;
  to: string;
  subject: string;
  text: string;
  messageId?: string;
}

/**
 * Normalize a subject line by:
 * - Stripping Re:, Fwd:, FW: prefixes (case-insensitive)
 * - Trimming whitespace
 * - Converting to lowercase
 */
function normalizeSubject(subject: string): string {
  return subject
    .replace(/^(?:re:|fwd?:|fw:)\s*/gi, "")
    .trim()
    .toLowerCase();
}

/**
 * Hash a subject line for consistent session lookup.
 * Returns the first 12 characters of the SHA256 hash.
 */
export function hashSubject(subject: string): string {
  const normalized = normalizeSubject(subject);
  const hash = createHash("sha256").update(normalized).digest("hex");
  return hash.slice(0, 12);
}

/**
 * Initialize the database with the sessions table schema.
 * Creates the table and index if they don't exist.
 */
export function initDb(dbPath: string): Database {
  const db = new Database(dbPath);

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      subject_hash TEXT UNIQUE NOT NULL,
      project TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      claude_session_id TEXT,
      pr_number INTEGER,
      created_at TEXT NOT NULL,
      last_activity TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_subject_hash ON sessions(subject_hash)
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    )
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id ON session_messages(session_id)
  `);

  return db;
}

/**
 * Get a session by its subject hash.
 * Returns null if no session exists with that hash.
 */
export function getSession(db: Database, subjectHash: string): Session | null {
  const stmt = db.prepare(`
    SELECT
      id,
      subject_hash as subjectHash,
      project,
      branch_name as branchName,
      claude_session_id as claudeSessionId,
      pr_number as prNumber,
      created_at as createdAt,
      last_activity as lastActivity
    FROM sessions
    WHERE subject_hash = ?
  `);

  const row = stmt.get(subjectHash) as Session | null;
  return row;
}

/**
 * Create a new session in the database.
 * Timestamps are automatically set to the current time.
 */
export function createSession(
  db: Database,
  session: Omit<Session, "createdAt" | "lastActivity">
): void {
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO sessions (
      id, subject_hash, project, branch_name,
      claude_session_id, pr_number, created_at, last_activity
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    session.id,
    session.subjectHash,
    session.project,
    session.branchName,
    session.claudeSessionId,
    session.prNumber,
    now,
    now
  );
}

/**
 * Update an existing session with partial fields.
 * Automatically updates the last_activity timestamp.
 */
export function updateSession(
  db: Database,
  id: string,
  updates: Partial<Session>
): void {
  const now = new Date().toISOString();
  const fields: string[] = ["last_activity = ?"];
  const values: (string | number | null)[] = [now];

  if (updates.claudeSessionId !== undefined) {
    fields.push("claude_session_id = ?");
    values.push(updates.claudeSessionId);
  }

  if (updates.prNumber !== undefined) {
    fields.push("pr_number = ?");
    values.push(updates.prNumber);
  }

  if (updates.branchName !== undefined) {
    fields.push("branch_name = ?");
    values.push(updates.branchName);
  }

  if (updates.project !== undefined) {
    fields.push("project = ?");
    values.push(updates.project);
  }

  values.push(id);

  const stmt = db.prepare(`
    UPDATE sessions SET ${fields.join(", ")} WHERE id = ?
  `);

  stmt.run(...values);
}

/**
 * Generate a unique session ID.
 * Uses crypto random bytes for uniqueness.
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a branch name from session ID.
 * Format: email-claude-{first 8 chars of session id}
 */
function generateBranchName(sessionId: string): string {
  return `email-claude-${sessionId.slice(0, 8)}`;
}

/**
 * Get an existing session by email subject or create a new one.
 * Updates last_activity if the session exists.
 */
export function getOrCreateSession(
  db: Database,
  email: InboundEmail,
  project: string
): Session {
  const subjectHash = hashSubject(email.subject);

  // Check for existing session
  const existing = getSession(db, subjectHash);

  if (existing) {
    // Update last activity timestamp
    updateSession(db, existing.id, {});

    // Return with updated timestamp
    return {
      ...existing,
      lastActivity: new Date().toISOString(),
    };
  }

  // Create new session
  const sessionId = generateSessionId();
  const branchName = generateBranchName(sessionId);

  const newSession: Omit<Session, "createdAt" | "lastActivity"> = {
    id: sessionId,
    subjectHash,
    project,
    branchName,
    claudeSessionId: null,
    prNumber: null,
  };

  createSession(db, newSession);

  // Return the full session with timestamps
  const now = new Date().toISOString();
  return {
    ...newSession,
    createdAt: now,
    lastActivity: now,
  };
}

/**
 * Add a message to a session's conversation history
 */
export function addSessionMessage(
  db: Database,
  sessionId: string,
  role: "user" | "assistant",
  content: string
): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO session_messages (session_id, role, content, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(sessionId, role, content, now);
}

/**
 * Get all messages for a session, ordered by creation time
 */
export function getSessionMessages(
  db: Database,
  sessionId: string
): SessionMessage[] {
  const stmt = db.prepare(`
    SELECT
      id,
      session_id as sessionId,
      role,
      content,
      created_at as createdAt
    FROM session_messages
    WHERE session_id = ?
    ORDER BY created_at ASC
  `);
  return stmt.all(sessionId) as SessionMessage[];
}
