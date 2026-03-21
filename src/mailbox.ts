/**
 * MailboxManager — High-level message management for agents.
 *
 * Features:
 * - Send/receive messages via Transport abstraction
 * - ACK mechanism for reliable delivery
 * - Message filtering by type
 * - Auto-cleanup of expired messages
 */

import type { TeamMessage, MessageType, AgentIdentity } from "./types.ts";
import { FileTransport, type Transport, type TransportConfig, createTransport } from "./transport.ts";

export interface MailboxOptions {
  transportType?: "file" | "p2p";
  autoAck?: boolean;
  filterTypes?: MessageType[];
}

/**
 * Mailbox manager for a single agent.
 */
export class MailboxManager {
  private transport: Transport;
  private options: Required<MailboxOptions>;
  private identity: AgentIdentity;
  private sharedRoot: string;

  constructor(
    identity: AgentIdentity,
    sharedRoot: string,
    options: MailboxOptions = {}
  ) {
    this.identity = identity;
    this.sharedRoot = sharedRoot;
    this.options = {
      transportType: options.transportType ?? "file",
      autoAck: options.autoAck ?? false,
      filterTypes: options.filterTypes ?? [],
    };

    const config: TransportConfig = {
      sharedRoot,
      teamName: identity.teamName,
      agentId: identity.agentId,
      enableAck: true,
    };

    this.transport = createTransport(this.options.transportType, config);
  }

  /**
   * Initialize the mailbox (create directories, etc.)
   */
  async initialize(): Promise<void> {
    await this.transport.initialize();
  }

  /**
   * Send a message to another agent.
   */
  async send(
    to: string | null,
    type: MessageType,
    content: string,
    metadata?: Record<string, unknown>
  ): Promise<TeamMessage> {
    return this.transport.send({
      type,
      from: this.identity.agentId,
      to,
      content,
      metadata: {
        teamName: this.identity.teamName,
        ...metadata,
      },
    });
  }

  /**
   * Send a broadcast message to all agents in the team.
   */
  async broadcast(type: MessageType, content: string, metadata?: Record<string, unknown>): Promise<TeamMessage> {
    return this.send(null, type, content, metadata);
  }

  /**
   * Receive pending messages.
   */
  async receive(): Promise<TeamMessage[]> {
    const messages = await this.transport.receive();

    // Apply type filter if configured
    if (this.options.filterTypes.length > 0) {
      return messages.filter((m) => this.options.filterTypes.includes(m.type));
    }

    return messages;
  }

  /**
   * Get pending messages and optionally auto-acknowledge.
   */
  async poll(): Promise<TeamMessage[]> {
    const messages = await this.receive();

    if (this.options.autoAck) {
      for (const msg of messages) {
        await this.ack(msg.id);
      }
    }

    return messages;
  }

  /**
   * Acknowledge a message.
   */
  async ack(messageId: string): Promise<boolean> {
    return this.transport.ack(messageId);
  }

  /**
   * Get message history (processed messages).
   */
  async history(limit?: number): Promise<TeamMessage[]> {
    return this.transport.history(limit);
  }

  /**
   * Clean up expired messages.
   */
  async cleanup(): Promise<number> {
    return this.transport.cleanup();
  }

  /**
   * Close the mailbox.
   */
  async close(): Promise<void> {
    await this.transport.close();
  }

  /**
   * Get the agent identity.
   */
  getIdentity(): AgentIdentity {
    return this.identity;
  }

  /**
   * Get unread message count.
   */
  async unreadCount(): Promise<number> {
    const messages = await this.receive();
    return messages.length;
  }

  /**
   * Check if there are urgent messages (task_blocked, shutdown_request).
   */
  async hasUrgentMessages(): Promise<boolean> {
    const messages = await this.receive();
    return messages.some(
      (m) => m.type === "task_blocked" || m.type === "shutdown_request"
    );
  }

  /**
   * Format pending messages for display.
   */
  async formatInbox(): Promise<string> {
    const messages = await this.receive();

    if (messages.length === 0) {
      return "📬 Inbox is empty.";
    }

    const lines: string[] = [`📬 Inbox (${messages.length} pending)`, ""];

    for (const msg of messages) {
      const typeIcon: Record<string, string> = {
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
      const urgent = msg.type === "task_blocked" || msg.type === "shutdown_request";

      lines.push(`${urgent ? "⚠️ " : ""}${icon} [${time}] ${msg.type} from ${msg.from}`);
      lines.push(`   ${msg.content.slice(0, 80)}${msg.content.length > 80 ? "..." : ""}`);
    }

    return lines.join("\n");
  }
}

/**
 * Create a mailbox manager for an agent.
 */
export function createMailbox(
  identity: AgentIdentity,
  sharedRoot: string,
  options?: MailboxOptions
): MailboxManager {
  return new MailboxManager(identity, sharedRoot, options);
}
