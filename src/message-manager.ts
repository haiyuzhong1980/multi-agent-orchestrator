/**
 * Team Messaging System — Inter-agent message persistence and retrieval.
 *
 * Storage: ~/.openclaw/shared-memory/inbox/{team}/{agent}/
 *   - pending/   — Messages waiting to be read
 *   - processed/ — Messages that have been processed
 *   - events.log — Event log for debugging
 */

import { existsSync, mkdirSync, writeFileSync, readdirSync, readFileSync, renameSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import type { TeamMessage, MessageType } from "./types.ts";

const INBOX_DIR = "inbox";
const PENDING_DIR = "pending";
const PROCESSED_DIR = "processed";
const EVENTS_LOG = "events.log";

export interface MailboxPaths {
  inboxRoot: string;
  pendingPath: string;
  processedPath: string;
  eventsLogPath: string;
}

/**
 * Get mailbox paths for a specific agent.
 */
export function getMailboxPaths(sharedRoot: string, teamName: string | null, agentId: string): MailboxPaths {
  const teamDir = teamName ? teamName : "_default";
  const inboxRoot = join(sharedRoot, INBOX_DIR, teamDir, agentId);
  return {
    inboxRoot,
    pendingPath: join(inboxRoot, PENDING_DIR),
    processedPath: join(inboxRoot, PROCESSED_DIR),
    eventsLogPath: join(inboxRoot, EVENTS_LOG),
  };
}

/**
 * Ensure mailbox directories exist.
 */
export function ensureMailbox(paths: MailboxPaths): void {
  if (!existsSync(paths.pendingPath)) {
    mkdirSync(paths.pendingPath, { recursive: true });
  }
  if (!existsSync(paths.processedPath)) {
    mkdirSync(paths.processedPath, { recursive: true });
  }
}

/**
 * Generate a unique message ID.
 */
export function generateMessageId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `msg-${timestamp}-${random}`;
}

/**
 * Send a message to an agent's mailbox.
 */
export function sendMessage(
  sharedRoot: string,
  message: Omit<TeamMessage, "id" | "timestamp">,
): TeamMessage {
  const fullMessage: TeamMessage = {
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    ...message,
  };

  // If broadcast, send to all agents in the team
  if (message.to === null) {
    // For broadcast, we'll store in a special _broadcast directory
    const teamDir = message.metadata?.teamName as string | null ?? "_default";
    const broadcastPath = join(sharedRoot, INBOX_DIR, teamDir, "_broadcast");
    if (!existsSync(broadcastPath)) {
      mkdirSync(broadcastPath, { recursive: true });
    }
    const filePath = join(broadcastPath, `${fullMessage.id}.json`);
    writeFileSync(filePath, JSON.stringify(fullMessage, null, 2), "utf-8");
    return fullMessage;
  }

  // Direct message
  const teamName = message.metadata?.teamName as string | null ?? null;
  const paths = getMailboxPaths(sharedRoot, teamName, message.to);
  ensureMailbox(paths);

  const filePath = join(paths.pendingPath, `${fullMessage.id}.json`);
  writeFileSync(filePath, JSON.stringify(fullMessage, null, 2), "utf-8");

  // Log the event
  appendFileSync(
    paths.eventsLogPath,
    `${new Date().toISOString()} SEND ${message.type} from=${message.from}\n`,
    "utf-8",
  );

  return fullMessage;
}

/**
 * Get pending messages for an agent.
 */
export function getPendingMessages(sharedRoot: string, teamName: string | null, agentId: string): TeamMessage[] {
  const paths = getMailboxPaths(sharedRoot, teamName, agentId);
  if (!existsSync(paths.pendingPath)) {
    return [];
  }

  const files = readdirSync(paths.pendingPath).filter((f) => f.endsWith(".json"));
  const messages: TeamMessage[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(paths.pendingPath, file), "utf-8");
      messages.push(JSON.parse(content) as TeamMessage);
    } catch {
      // Skip invalid files
    }
  }

  // Sort by timestamp (oldest first)
  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return messages;
}

/**
 * Mark a message as processed (move to processed folder).
 */
export function markMessageProcessed(
  sharedRoot: string,
  teamName: string | null,
  agentId: string,
  messageId: string,
): boolean {
  const paths = getMailboxPaths(sharedRoot, teamName, agentId);
  const pendingFile = join(paths.pendingPath, `${messageId}.json`);
  const processedFile = join(paths.processedPath, `${messageId}.json`);

  if (!existsSync(pendingFile)) {
    return false;
  }

  ensureMailbox(paths);
  renameSync(pendingFile, processedFile);

  // Log the event
  appendFileSync(
    paths.eventsLogPath,
    `${new Date().toISOString()} PROCESSED ${messageId}\n`,
    "utf-8",
  );

  return true;
}

/**
 * Get broadcast messages for a team.
 */
export function getBroadcastMessages(sharedRoot: string, teamName: string | null): TeamMessage[] {
  const teamDir = teamName ?? "_default";
  const broadcastPath = join(sharedRoot, INBOX_DIR, teamDir, "_broadcast");

  if (!existsSync(broadcastPath)) {
    return [];
  }

  const files = readdirSync(broadcastPath).filter((f) => f.endsWith(".json"));
  const messages: TeamMessage[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(broadcastPath, file), "utf-8");
      messages.push(JSON.parse(content) as TeamMessage);
    } catch {
      // Skip invalid files
    }
  }

  messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return messages;
}

/**
 * Format messages for display.
 */
export function formatMessages(messages: TeamMessage[]): string {
  if (messages.length === 0) {
    return "No messages.";
  }

  const lines: string[] = [`📬 Inbox (${messages.length} messages)`, ""];

  for (const msg of messages) {
    const typeIcon: Record<MessageType, string> = {
      message: "💬",
      join_request: "🤝",
      join_approved: "✅",
      plan_approval_request: "📋",
      plan_approved: "✅",
      task_blocked: "🚫",
      task_completed: "🎉",
      shutdown_request: "🛑",
      broadcast: "📢",
    };

    const icon = typeIcon[msg.type] ?? "💬";
    const time = new Date(msg.timestamp).toLocaleTimeString();
    lines.push(`${icon} [${time}] ${msg.type} from ${msg.from}`);
    lines.push(`   ${msg.content.slice(0, 100)}${msg.content.length > 100 ? "..." : ""}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Create an agent identity.
 */
export function createAgentIdentity(params: {
  agentId: string;
  agentName: string;
  agentType: string;
  teamName?: string;
  isLeader?: boolean;
}): import("./types.ts").AgentIdentity {
  return {
    agentId: params.agentId,
    agentName: params.agentName,
    agentType: params.agentType,
    teamName: params.teamName ?? null,
    isLeader: params.isLeader ?? false,
    joinedAt: new Date().toISOString(),
  };
}
