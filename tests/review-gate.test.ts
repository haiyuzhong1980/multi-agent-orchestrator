import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reviewTask,
  reviewProject,
  buildRetryPrompt,
  prepareRetries,
} from "../src/review-gate.ts";
import {
  createEmptyBoard,
  createProject,
  addTask,
  updateTaskStatus,
} from "../src/task-board.ts";

// ── reviewTask ─────────────────────────────────────────────────────────────

describe("reviewTask: good text result", () => {
  it("approves a task with clean text content", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "security-audit-track",
      label: "Security Audit",
      contentType: "text-analysis",
    });
    updateTaskStatus(task, "completed", {
      resultText: "No critical vulnerabilities found.\nDependencies are up to date.",
    });

    const result = reviewTask(task);
    assert.equal(result.taskId, task.id);
    assert.equal(result.approved, true);
    assert.ok(result.status === "ok" || result.status === "partial");
    assert.ok(result.keptItems > 0);
  });
});

describe("reviewTask: empty result", () => {
  it("rejects a task with empty result text", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "empty-track",
      label: "Empty",
      contentType: "text-analysis",
    });
    updateTaskStatus(task, "completed", { resultText: "" });

    const result = reviewTask(task);
    assert.equal(result.approved, false);
    assert.equal(result.status, "failed");
    assert.equal(result.keptItems, 0);
  });
});

describe("reviewTask: GitHub URL type", () => {
  it("validates a task with GitHub issue URLs correctly", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "issues-track",
      label: "Issues",
      contentType: "github-url",
    });
    updateTaskStatus(task, "completed", {
      resultText: "- Real issue https://github.com/foo/bar/issues/42 评论数: 5",
    });

    const result = reviewTask(task);
    assert.equal(result.approved, true);
    assert.equal(result.status, "ok");
    assert.ok(result.keptItems > 0);
  });

  it("rejects a task with only dirty GitHub URL content", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "issues-track",
      label: "Issues",
      contentType: "github-url",
    });
    updateTaskStatus(task, "completed", {
      resultText: "Page not found\nEXTERNAL_UNTRUSTED_CONTENT",
    });

    const result = reviewTask(task);
    assert.equal(result.approved, false);
    assert.equal(result.status, "failed");
  });
});

// ── reviewProject ──────────────────────────────────────────────────────────

describe("reviewProject: all approved", () => {
  it("returns allApproved=true when all completed tasks pass review", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, {
      trackId: "security-track",
      label: "Security",
      contentType: "text-analysis",
    });
    const t2 = addTask(project, {
      trackId: "ops-track",
      label: "Ops",
      contentType: "text-analysis",
    });
    updateTaskStatus(t1, "completed", { resultText: "All systems nominal." });
    updateTaskStatus(t2, "completed", { resultText: "CPU 40%, Memory 50%." });

    const { allApproved, reviews } = reviewProject(project);
    assert.equal(allApproved, true);
    assert.equal(reviews.length, 2);
    assert.ok(reviews.every((r) => r.approved));
  });
});

describe("reviewProject: some rejected", () => {
  it("puts rejected tasks (with retries remaining) into needsRetry", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const goodTask = addTask(project, {
      trackId: "good-track",
      label: "Good",
      contentType: "text-analysis",
      maxRetry: 2,
    });
    const badTask = addTask(project, {
      trackId: "empty-track",
      label: "Bad",
      contentType: "text-analysis",
      maxRetry: 2,
    });
    updateTaskStatus(goodTask, "completed", { resultText: "Everything looks fine here." });
    updateTaskStatus(badTask, "completed", { resultText: "" });

    const { needsRetry, allApproved } = reviewProject(project);
    assert.equal(allApproved, false);
    assert.ok(needsRetry.some((t) => t.id === badTask.id));
  });
});

describe("reviewProject: rejected + retryCount >= maxRetry", () => {
  it("does not include exhausted tasks in needsRetry", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "empty-track",
      label: "Bad",
      contentType: "text-analysis",
      maxRetry: 2,
    });
    task.retryCount = 2; // already exhausted
    updateTaskStatus(task, "completed", { resultText: "" });

    const { needsRetry } = reviewProject(project);
    assert.ok(!needsRetry.some((t) => t.id === task.id));
  });
});

describe("reviewProject: updates task review statuses", () => {
  it("sets approved status on approved tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "good-track",
      label: "Good",
      contentType: "text-analysis",
    });
    updateTaskStatus(task, "completed", { resultText: "Results are clean and accurate." });

    reviewProject(project);
    assert.equal(task.status, "approved");
    assert.equal(task.reviewStatus, "approved");
    assert.ok(typeof task.reviewReason === "string" && task.reviewReason.length > 0);
  });

  it("sets rejected status on rejected tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "empty-track",
      label: "Bad",
      contentType: "text-analysis",
    });
    updateTaskStatus(task, "completed", { resultText: "" });

    reviewProject(project);
    assert.equal(task.status, "rejected");
    assert.equal(task.reviewStatus, "rejected");
  });

  it("skips non-completed tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "pending-track",
      label: "Pending",
      contentType: "text-analysis",
    });
    // task stays pending

    const { reviews } = reviewProject(project);
    assert.equal(reviews.length, 0);
    assert.equal(task.status, "pending");
  });
});

// ── buildRetryPrompt ───────────────────────────────────────────────────────

describe("buildRetryPrompt: includes failure reason", () => {
  it("appends failure reason to the original prompt", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "t",
      label: "L",
      subagentPrompt: "Find GitHub issues.",
    });
    task.failureReason = "timeout";

    const prompt = buildRetryPrompt(task);
    assert.ok(prompt.startsWith("Find GitHub issues."));
    assert.ok(prompt.includes("timeout"));
    assert.ok(prompt.includes("上次执行失败/结果不合格"));
    assert.ok(prompt.includes("请换一个角度或缩小范围重试"));
  });

  it("uses reviewReason when failureReason is absent", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "t",
      label: "L",
      subagentPrompt: "Analyze security.",
    });
    task.reviewReason = "No valid content found";

    const prompt = buildRetryPrompt(task);
    assert.ok(prompt.includes("No valid content found"));
  });

  it("handles missing subagentPrompt gracefully", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    task.failureReason = "error";

    const prompt = buildRetryPrompt(task);
    assert.ok(prompt.includes("上次执行失败/结果不合格"));
    assert.ok(prompt.includes("error"));
  });
});

// ── prepareRetries ─────────────────────────────────────────────────────────

describe("prepareRetries: increments retryCount", () => {
  it("increments retryCount on each task", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "t",
      label: "L",
      subagentPrompt: "Do something.",
    });
    task.retryCount = 1;
    task.status = "rejected";
    task.resultText = "old result";
    task.failureReason = "error";

    prepareRetries([task]);
    assert.equal(task.retryCount, 2);
  });
});

describe("prepareRetries: resets status", () => {
  it("sets task status back to pending", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    task.status = "rejected";
    task.failureReason = "timeout";

    prepareRetries([task]);
    assert.equal(task.status, "pending");
  });
});

describe("prepareRetries: clears resultText and resultSummary", () => {
  it("removes previous result data", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    task.resultText = "old result";
    task.resultSummary = "old summary";
    task.status = "rejected";
    task.failureReason = "error";

    prepareRetries([task]);
    assert.equal(task.resultText, undefined);
    assert.equal(task.resultSummary, undefined);
  });
});

describe("prepareRetries: updates subagentPrompt with retry guidance", () => {
  it("includes retry context in the new prompt", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, {
      trackId: "t",
      label: "L",
      subagentPrompt: "Original prompt.",
    });
    task.status = "rejected";
    task.failureReason = "timeout";

    prepareRetries([task]);
    assert.ok(task.subagentPrompt?.includes("上次执行失败/结果不合格"));
    assert.ok(task.subagentPrompt?.includes("timeout"));
  });

  it("returns the modified tasks array", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    t1.status = "rejected";
    t2.status = "rejected";

    const returned = prepareRetries([t1, t2]);
    assert.equal(returned.length, 2);
    assert.equal(returned[0], t1);
    assert.equal(returned[1], t2);
  });
});
