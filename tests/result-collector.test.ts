import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  processSubagentResult,
  extractResultFromMessages,
  isProjectReadyForReview,
  summarizeProjectResults,
} from "../src/result-collector.ts";
import {
  createEmptyBoard,
  createProject,
  addTask,
  updateTaskStatus,
  advanceProjectStatus,
} from "../src/task-board.ts";
import type { TaskBoard } from "../src/task-board.ts";

// ── processSubagentResult ──────────────────────────────────────────────────

describe("processSubagentResult: matching task found", () => {
  it("returns updated=true when session key matches a task", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-001" });

    const result = processSubagentResult({ board, sessionKey: "sess-001", outcome: "ok" });
    assert.equal(result.updated, true);
    assert.equal(result.taskId, task.id);
    assert.equal(result.projectId, project.id);
  });
});

describe("processSubagentResult: no matching task", () => {
  it("returns updated=false when no task has the session key", () => {
    const board = createEmptyBoard();
    createProject(board, { name: "P", request: "r" });

    const result = processSubagentResult({ board, sessionKey: "sess-missing", outcome: "ok" });
    assert.equal(result.updated, false);
    assert.equal(result.taskId, undefined);
    assert.equal(result.projectId, undefined);
  });
});

describe("processSubagentResult: ok outcome", () => {
  it("sets task status to completed", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-ok" });

    processSubagentResult({ board, sessionKey: "sess-ok", outcome: "ok", resultText: "good result" });
    assert.equal(task.status, "completed");
    assert.equal(task.resultText, "good result");
  });
});

describe("processSubagentResult: error outcome", () => {
  it("sets task status to failed with failureReason=error", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-err" });

    processSubagentResult({ board, sessionKey: "sess-err", outcome: "error" });
    assert.equal(task.status, "failed");
    assert.equal(task.failureReason, "error");
  });
});

describe("processSubagentResult: timeout outcome", () => {
  it("sets task status to failed with failureReason=timeout", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-to" });

    processSubagentResult({ board, sessionKey: "sess-to", outcome: "timeout" });
    assert.equal(task.status, "failed");
    assert.equal(task.failureReason, "timeout");
  });
});

describe("processSubagentResult: killed outcome", () => {
  it("sets task status to failed with failureReason=killed", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-kill" });

    processSubagentResult({ board, sessionKey: "sess-kill", outcome: "killed" });
    assert.equal(task.status, "failed");
    assert.equal(task.failureReason, "killed");
  });
});

describe("processSubagentResult: project advances after update", () => {
  it("advances project status when a task is updated", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-adv" });
    advanceProjectStatus(project);

    assert.equal(project.status, "running");
    processSubagentResult({ board, sessionKey: "sess-adv", outcome: "ok" });
    // Single task completed → project moves to reviewing
    assert.equal(project.status, "reviewing");
  });
});

// ── extractResultFromMessages ──────────────────────────────────────────────

describe("extractResultFromMessages: filters noise", () => {
  it("removes noise lines and returns clean text", () => {
    const messages = [
      { role: "assistant", content: "EXTERNAL_UNTRUSTED_CONTENT\nHere is the real result.\nPage not found" },
    ];
    const result = extractResultFromMessages(messages);
    assert.ok(!result.includes("EXTERNAL_UNTRUSTED_CONTENT"));
    assert.ok(!result.includes("Page not found"));
    assert.ok(result.includes("Here is the real result."));
  });
});

describe("extractResultFromMessages: extracts text from content blocks", () => {
  it("handles array content with text blocks", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Block one." },
          { type: "tool_use", id: "tool-1", name: "some_tool", input: {} },
          { type: "text", text: "Block two." },
        ],
      },
    ];
    const result = extractResultFromMessages(messages);
    assert.ok(result.includes("Block one."));
    assert.ok(result.includes("Block two."));
  });
});

describe("extractResultFromMessages: skips non-assistant messages", () => {
  it("ignores user messages", () => {
    const messages = [
      { role: "user", content: "User input" },
      { role: "assistant", content: "Assistant output" },
    ];
    const result = extractResultFromMessages(messages);
    assert.ok(!result.includes("User input"));
    assert.ok(result.includes("Assistant output"));
  });
});

describe("extractResultFromMessages: returns empty string for empty messages", () => {
  it("returns empty string when no messages", () => {
    const result = extractResultFromMessages([]);
    assert.equal(result, "");
  });
});

// ── isProjectReadyForReview ────────────────────────────────────────────────

describe("isProjectReadyForReview: all terminal", () => {
  it("returns true when all tasks are in terminal states", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    const t3 = addTask(project, { trackId: "c", label: "C" });
    const t4 = addTask(project, { trackId: "d", label: "D" });
    updateTaskStatus(t1, "completed");
    updateTaskStatus(t2, "failed");
    updateTaskStatus(t3, "approved");
    updateTaskStatus(t4, "rejected");
    assert.equal(isProjectReadyForReview(project), true);
  });
});

describe("isProjectReadyForReview: some running", () => {
  it("returns false when any task is still running", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "completed");
    // second task still pending
    assert.equal(isProjectReadyForReview(project), false);
  });
});

describe("isProjectReadyForReview: empty project", () => {
  it("returns false when project has no tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    assert.equal(isProjectReadyForReview(project), false);
  });
});

// ── summarizeProjectResults ────────────────────────────────────────────────

describe("summarizeProjectResults: readable summary", () => {
  it("includes project name, id, and task details", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "My Project", request: "r" });
    const t1 = addTask(project, { trackId: "issues-track", label: "Issues" });
    const t2 = addTask(project, { trackId: "security-track", label: "Security" });
    updateTaskStatus(t1, "completed", { resultText: "Found 5 issues" });
    updateTaskStatus(t2, "failed", { failureReason: "timeout" });

    const summary = summarizeProjectResults(project);
    assert.ok(summary.includes("My Project"));
    assert.ok(summary.includes(project.id));
    assert.ok(summary.includes("Issues"));
    assert.ok(summary.includes("Security"));
    assert.ok(summary.includes("Found 5 issues"));
    assert.ok(summary.includes("timeout"));
  });

  it("includes task counts", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "completed");

    const summary = summarizeProjectResults(project);
    assert.ok(summary.includes("1 completed"));
  });
});
