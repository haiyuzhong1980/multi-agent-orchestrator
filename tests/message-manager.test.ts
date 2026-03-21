import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getMailboxPaths,
  ensureMailbox,
  generateMessageId,
  sendMessage,
  getPendingMessages,
  markMessageProcessed,
  getBroadcastMessages,
  formatMessages,
  createAgentIdentity,
} from "../src/message-manager.ts";
import { MessageType } from "../src/types.ts";

describe("Message Manager", () => {
  let testDir: string;

  before(() => {
    testDir = join(tmpdir(), `message-manager-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("getMailboxPaths", () => {
    it("returns correct paths for agent mailbox", () => {
      const paths = getMailboxPaths(testDir, "team-alpha", "agent-001");
      assert.ok(paths.inboxRoot.includes("inbox"));
      assert.ok(paths.inboxRoot.includes("team-alpha"));
      assert.ok(paths.inboxRoot.includes("agent-001"));
      assert.ok(paths.pendingPath.includes("pending"));
      assert.ok(paths.processedPath.includes("processed"));
    });

    it("uses _default for null team name", () => {
      const paths = getMailboxPaths(testDir, null, "agent-002");
      assert.ok(paths.inboxRoot.includes("_default"));
    });
  });

  describe("ensureMailbox", () => {
    it("creates pending and processed directories", () => {
      const paths = getMailboxPaths(testDir, "test-team-1", "agent-003");
      ensureMailbox(paths);
      assert.ok(existsSync(paths.pendingPath));
      assert.ok(existsSync(paths.processedPath));
    });
  });

  describe("generateMessageId", () => {
    it("generates unique message IDs", () => {
      const id1 = generateMessageId();
      const id2 = generateMessageId();
      assert.ok(id1.startsWith("msg-"));
      assert.ok(id2.startsWith("msg-"));
      assert.notEqual(id1, id2);
    });
  });

  describe("sendMessage", () => {
    it("sends a direct message to an agent", () => {
      const msg = sendMessage(testDir, {
        type: MessageType.message,
        from: "agent-001",
        to: "agent-002",
        content: "Hello from agent 001!",
      });

      assert.ok(msg.id.startsWith("msg-"));
      assert.equal(msg.type, MessageType.message);
      assert.equal(msg.from, "agent-001");
      assert.equal(msg.to, "agent-002");
      assert.equal(msg.content, "Hello from agent 001!");
      assert.ok(msg.timestamp);

      // Verify file was created
      const paths = getMailboxPaths(testDir, null, "agent-002");
      const files = readdirSync(paths.pendingPath);
      assert.ok(files.some((f) => f === `${msg.id}.json`));
    });

    it("sends a broadcast message", () => {
      const msg = sendMessage(testDir, {
        type: MessageType.broadcast,
        from: "leader",
        to: null,
        content: "Team announcement!",
        metadata: { teamName: "team-beta" },
      });

      assert.equal(msg.to, null);
      assert.ok(msg.id);
    });

    it("stores message with all metadata", () => {
      const msg = sendMessage(testDir, {
        type: MessageType.task_completed,
        from: "worker-1",
        to: "leader",
        content: "Task done",
        metadata: { taskId: "task-abc", projectId: "proj-123" },
      });

      const paths = getMailboxPaths(testDir, null, "leader");
      const content = readFileSync(join(paths.pendingPath, `${msg.id}.json`), "utf-8");
      const parsed = JSON.parse(content);
      assert.equal(parsed.metadata.taskId, "task-abc");
      assert.equal(parsed.metadata.projectId, "proj-123");
    });
  });

  describe("getPendingMessages", () => {
    it("returns empty array for non-existent mailbox", () => {
      const messages = getPendingMessages(testDir, "nonexistent-team", "nonexistent-agent");
      assert.deepEqual(messages, []);
    });

    it("returns messages sorted by timestamp", () => {
      // Send multiple messages
      sendMessage(testDir, {
        type: MessageType.message,
        from: "agent-a",
        to: "agent-sorted",
        content: "First message",
      });

      // Small delay to ensure different timestamps
      sendMessage(testDir, {
        type: MessageType.message,
        from: "agent-b",
        to: "agent-sorted",
        content: "Second message",
      });

      const messages = getPendingMessages(testDir, null, "agent-sorted");
      assert.ok(messages.length >= 2);
      // First message should have earlier timestamp
      assert.ok(new Date(messages[0].timestamp) <= new Date(messages[1].timestamp));
    });
  });

  describe("markMessageProcessed", () => {
    it("moves message to processed folder", () => {
      const msg = sendMessage(testDir, {
        type: MessageType.message,
        from: "agent-x",
        to: "agent-process",
        content: "Process this",
      });

      const paths = getMailboxPaths(testDir, null, "agent-process");
      assert.ok(existsSync(join(paths.pendingPath, `${msg.id}.json`)));

      const success = markMessageProcessed(testDir, null, "agent-process", msg.id);
      assert.equal(success, true);
      assert.ok(!existsSync(join(paths.pendingPath, `${msg.id}.json`)));
      assert.ok(existsSync(join(paths.processedPath, `${msg.id}.json`)));
    });

    it("returns false for non-existent message", () => {
      const success = markMessageProcessed(testDir, null, "agent-process", "nonexistent-msg");
      assert.equal(success, false);
    });
  });

  describe("getBroadcastMessages", () => {
    it("returns broadcast messages for team", () => {
      sendMessage(testDir, {
        type: MessageType.broadcast,
        from: "leader",
        to: null,
        content: "Team meeting at 3pm",
        metadata: { teamName: "team-gamma" },
      });

      const messages = getBroadcastMessages(testDir, "team-gamma");
      assert.ok(messages.length >= 1);
      assert.ok(messages.some((m) => m.content === "Team meeting at 3pm"));
    });
  });

  describe("formatMessages", () => {
    it("returns 'No messages' for empty array", () => {
      const text = formatMessages([]);
      assert.equal(text, "No messages.");
    });

    it("formats messages with icons", () => {
      const messages = [
        {
          id: "msg-1",
          type: MessageType.message,
          from: "agent-1",
          to: "agent-2",
          content: "Test message",
          timestamp: new Date().toISOString(),
        },
        {
          id: "msg-2",
          type: MessageType.task_completed,
          from: "worker",
          to: "leader",
          content: "Task finished",
          timestamp: new Date().toISOString(),
        },
      ];

      const text = formatMessages(messages);
      assert.ok(text.includes("📬"));
      assert.ok(text.includes("💬"));
      assert.ok(text.includes("🎉"));
      assert.ok(text.includes("Test message"));
    });
  });

  describe("createAgentIdentity", () => {
    it("creates identity with all fields", () => {
      const identity = createAgentIdentity({
        agentId: "session-123",
        agentName: "worker-1",
        agentType: "executor",
        teamName: "team-delta",
        isLeader: false,
      });

      assert.equal(identity.agentId, "session-123");
      assert.equal(identity.agentName, "worker-1");
      assert.equal(identity.agentType, "executor");
      assert.equal(identity.teamName, "team-delta");
      assert.equal(identity.isLeader, false);
      assert.ok(identity.joinedAt);
    });

    it("defaults isLeader to false", () => {
      const identity = createAgentIdentity({
        agentId: "session-456",
        agentName: "worker-2",
        agentType: "reviewer",
      });

      assert.equal(identity.isLeader, false);
    });

    it("defaults teamName to null", () => {
      const identity = createAgentIdentity({
        agentId: "session-789",
        agentName: "solo-agent",
        agentType: "analyst",
      });

      assert.equal(identity.teamName, null);
    });
  });
});

describe("MessageType constants", () => {
  it("has all expected message types", () => {
    assert.equal(MessageType.message, "message");
    assert.equal(MessageType.join_request, "join_request");
    assert.equal(MessageType.join_approved, "join_approved");
    assert.equal(MessageType.plan_approval_request, "plan_approval_request");
    assert.equal(MessageType.plan_approved, "plan_approved");
    assert.equal(MessageType.task_blocked, "task_blocked");
    assert.equal(MessageType.task_completed, "task_completed");
    assert.equal(MessageType.shutdown_request, "shutdown_request");
    assert.equal(MessageType.broadcast, "broadcast");
  });
});
