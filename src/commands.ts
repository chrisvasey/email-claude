/**
 * Email command parsing module
 *
 * Parses special commands from email subjects to control PR operations.
 */

export type Command =
  | { type: 'merge' }
  | { type: 'close' }
  | { type: 'status' }
  | null;

/**
 * Parse a command from an email subject line.
 * Commands are case-insensitive and can appear anywhere in the subject.
 *
 * Supported commands:
 * - [merge] - Merge the PR
 * - [close] - Close the PR without merging
 * - [status] - Get PR status
 *
 * @param subject - The email subject line
 * @returns The parsed command or null if no command found
 */
export function parseCommand(subject: string): Command {
  const lowerSubject = subject.toLowerCase();

  if (lowerSubject.includes('[merge]')) {
    return { type: 'merge' };
  }

  if (lowerSubject.includes('[close]')) {
    return { type: 'close' };
  }

  if (lowerSubject.includes('[status]')) {
    return { type: 'status' };
  }

  return null;
}
