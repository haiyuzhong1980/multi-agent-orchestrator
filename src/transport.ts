/**
 * Transport Layer — Abstract interface for inter-agent communication.
 *
 * Design principles:
 * - Pluggable transport implementations (File, P2P, etc.)
 * - Async-first API for network transports
 * - ACK mechanism for reliable delivery
 * - Message expiration for cleanup
 */

import type { TeamMessage, MessageType } from "./types.ts";

// ============================================================================
// Transport Interface
// ============================================================================

/**
 * Configuration for a transport instance.
 */
export interface TransportConfig {
  sharedRoot: string;
  teamName: string | null;
  agentId: string;
  /** Message TTL in milliseconds (default: 24 hours) */
  messageTtlMs?: number;
  /** Enable ACK mechanism */
  enableAck?: boolean;
}

/**
 * Message with delivery status.
 */
export interface Envelope {
  message: TeamMessage;
  status: "pending" | "delivered" | "acknowledged" | "expired";
  deliveredAt?: string;
  acknowledgedAt?: string;
}

/**
 * Abstract transport interface.
 * Implementations: FileTransport, P2PTransport, etc.
 */
export interface Transport {
  /** Transport type identifier */
  readonly type: string;

  /** Initialize the transport */
  initialize(): Promise<void>;

  /** Send a message */
  send(message: Omit<TeamMessage, "id" | "timestamp">): Promise<TeamMessage>;

  /** Receive pending messages */
  receive(): Promise<TeamMessage[]>;

  /** Acknowledge a message was processed */
  ack(messageId: string): Promise<boolean>;

  /** Get message history (processed messages) */
  history(limit?: number): Promise<TeamMessage[]>;

  /** Clean up expired messages */
  cleanup(): Promise<number>;

  /** Close the transport */
  close(): Promise<void>;
}

// ============================================================================
// FileTransport Implementation
// ============================================================================

import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  statSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";

const INBOX_DIR = "inbox";
const PENDING_DIR = "pending";
const PROCESSED_DIR = "processed";
const EVENTS_LOG = "events.log";

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * File-based transport using the filesystem as message queue.
 * Messages are stored as JSON files in directory structure.
 */
export class FileTransport implements Transport {
  readonly type = "file";

  private config: Required<TransportConfig>;
  private pendingPath: string;
  private processedPath: string;
  private eventsLogPath: string;
  private inboxRoot: string;

  constructor(config: TransportConfig) {
    this.config = {
      messageTtlMs: DEFAULT_TTL_MS,
      enableAck: true,
      ...config,
    };

    const teamDir = this.config.teamName ?? "_default";
    this.inboxRoot = join(this.config.sharedRoot, INBOX_DIR, teamDir, this.config.agentId);
    this.pendingPath = join(this.inboxRoot, PENDING_DIR);
    this.processedPath = join(this.inboxRoot, PROCESSED_DIR);
    this.eventsLogPath = join(this.inboxRoot, EVENTS_LOG);
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.pendingPath)) {
      mkdirSync(this.pendingPath, { recursive: true });
    }
    if (!existsSync(this.processedPath)) {
      mkdirSync(this.processedPath, { recursive: true });
    }
  }

  private generateMessageId(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).slice(2, 8);
    return `msg-${timestamp}-${random}`;
  }

  async send(message: Omit<TeamMessage, "id" | "timestamp">): Promise<TeamMessage> {
    const fullMessage: TeamMessage = {
      id: this.generateMessageId(),
      timestamp: new Date().toISOString(),
      ...message,
    };

    // Broadcast messages go to _broadcast directory
    if (message.to === null) {
      const broadcastPath = join(
        this.config.sharedRoot,
        INBOX_DIR,
        this.config.teamName ?? "_default",
        "_broadcast"
      );
      if (!existsSync(broadcastPath)) {
        mkdirSync(broadcastPath, { recursive: true });
      }
      writeFileSync(join(broadcastPath, `${fullMessage.id}.json`), JSON.stringify(fullMessage, null, 2), "utf-8");
      return fullMessage;
    }

    // Direct message to target agent
    const targetInbox = join(
      this.config.sharedRoot,
      INBOX_DIR,
      this.config.teamName ?? "_default",
      message.to,
      PENDING_DIR
    );

    if (!existsSync(targetInbox)) {
      mkdirSync(targetInbox, { recursive: true });
    }

    const filePath = join(targetInbox, `${fullMessage.id}.json`);
    writeFileSync(filePath, JSON.stringify(fullMessage, null, 2), "utf-8");

    // Log send event
    this.logEvent(`SEND ${message.type} to=${message.to} id=${fullMessage.id}`);

    return fullMessage;
  }

  async receive(): Promise<TeamMessage[]> {
    if (!existsSync(this.pendingPath)) {
      return [];
    }

    const files = readdirSync(this.pendingPath).filter((f) => f.endsWith(".json"));
    const messages: TeamMessage[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(this.pendingPath, file), "utf-8");
        const msg = JSON.parse(content) as TeamMessage;

        // Check for expiration
        if (this.isExpired(msg)) {
          this.logEvent(`EXPIRED ${msg.id}`);
          continue;
        }

        messages.push(msg);
      } catch {
        // Skip invalid files
      }
    }

    // Sort by timestamp (oldest first)
    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return messages;
  }

  async ack(messageId: string): Promise<boolean> {
    const pendingFile = join(this.pendingPath, `${messageId}.json`);
    const processedFile = join(this.processedPath, `${messageId}.json`);

    if (!existsSync(pendingFile)) {
      return false;
    }

    // Ensure processed directory exists
    if (!existsSync(this.processedPath)) {
      mkdirSync(this.processedPath, { recursive: true });
    }

    // Move to processed
    renameSync(pendingFile, processedFile);

    // Update envelope with ACK timestamp
    try {
      const content = readFileSync(processedFile, "utf-8");
      const msg = JSON.parse(content);
      msg._acknowledgedAt = new Date().toISOString();
      writeFileSync(processedFile, JSON.stringify(msg, null, 2), "utf-8");
    } catch {
      // Ignore update errors
    }

    this.logEvent(`ACK ${messageId}`);
    return true;
  }

  async history(limit: number = 50): Promise<TeamMessage[]> {
    if (!existsSync(this.processedPath)) {
      return [];
    }

    const files = readdirSync(this.processedPath)
      .filter((f) => f.endsWith(".json"))
      .slice(0, limit);

    const messages: TeamMessage[] = [];

    for (const file of files) {
      try {
        const content = readFileSync(join(this.processedPath, file), "utf-8");
        messages.push(JSON.parse(content) as TeamMessage);
      } catch {
        // Skip invalid files
      }
    }

    // Sort by timestamp (newest first for history)
    messages.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    return messages;
  }

  async cleanup(): Promise<number> {
    let cleaned = 0;

    // Clean expired pending messages
    if (existsSync(this.pendingPath)) {
      const files = readdirSync(this.pendingPath).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const content = readFileSync(join(this.pendingPath, file), "utf-8");
          const msg = JSON.parse(content) as TeamMessage;
          if (this.isExpired(msg)) {
            unlinkSync(join(this.pendingPath, file));
            cleaned++;
          }
        } catch {
          // Skip invalid files
        }
      }
    }

    // Clean old processed messages (older than TTL * 2)
    const doubleTtl = this.config.messageTtlMs * 2;
    if (existsSync(this.processedPath)) {
      const files = readdirSync(this.processedPath).filter((f) => f.endsWith(".json"));
      for (const file of files) {
        try {
          const stat = statSync(join(this.processedPath, file));
          const age = Date.now() - stat.mtimeMs;
          if (age > doubleTtl) {
            unlinkSync(join(this.processedPath, file));
            cleaned++;
          }
        } catch {
          // Skip files that can't be stat'd
        }
      }
    }

    if (cleaned > 0) {
      this.logEvent(`CLEANUP removed=${cleaned}`);
    }

    return cleaned;
  }

  async close(): Promise<void> {
    // No persistent resources to close for file transport
  }

  private isExpired(message: TeamMessage): boolean {
    const age = Date.now() - new Date(message.timestamp).getTime();
    return age > this.config.messageTtlMs;
  }

  private logEvent(event: string): void {
    try {
      if (!existsSync(this.inboxRoot)) {
        mkdirSync(this.inboxRoot, { recursive: true });
      }
      appendFileSync(this.eventsLogPath, `${new Date().toISOString()} ${event}\n`, "utf-8");
    } catch {
      // Ignore logging errors
    }
  }
}

// ============================================================================
// Transport Factory
// ============================================================================

/**
 * Create a transport instance based on configuration.
 */
export function createTransport(type: "file" | "p2p", config: TransportConfig): Transport {
  switch (type) {
    case "file":
      return new FileTransport(config);
    case "p2p":
      throw new Error("P2PTransport not yet implemented");
    default:
      throw new Error(`Unknown transport type: ${type}`);
  }
}
