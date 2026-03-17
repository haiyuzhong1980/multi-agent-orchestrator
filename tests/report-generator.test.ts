import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateProjectReport } from "../src/report-generator.ts";
import {
  createEmptyBoard,
  createProject,
  addTask,
  updateTaskStatus,
} from "../src/task-board.ts";

// ── generateProjectReport: all approved ───────────────────────────────────

describe("generateProjectReport: all tasks approved", () => {
  it("includes success conclusion when all tasks approved", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Success Project", request: "do research" });
    const t1 = addTask(project, { trackId: "a", label: "Track A" });
    const t2 = addTask(project, { trackId: "b", label: "Track B" });
    updateTaskStatus(t1, "approved", { reviewStatus: "approved", reviewReason: "good" });
    updateTaskStatus(t2, "approved", { reviewStatus: "approved", reviewReason: "excellent" });
    project.status = "done";

    const report = generateProjectReport(project);
    assert.ok(report.includes("项目报告: Success Project"));
    assert.ok(report.includes("所有任务均通过验收。项目完成。"));
  });

  it("contains project metadata", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Meta Project", request: "meta request" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "approved", { reviewStatus: "approved" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("Meta Project"));
    assert.ok(report.includes("meta request"));
    assert.ok(report.includes(project.createdAt));
    assert.ok(report.includes(project.status));
  });

  it("shows correct approved count in overview", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "approved", { reviewStatus: "approved" });
    updateTaskStatus(t2, "approved", { reviewStatus: "approved" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("- 总任务: 2"));
    assert.ok(report.includes("- 通过: 2"));
  });
});

// ── generateProjectReport: partially approved ─────────────────────────────

describe("generateProjectReport: partially approved", () => {
  it("shows partial conclusion with counts", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Partial Project", request: "do stuff" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "approved", { reviewStatus: "approved" });
    updateTaskStatus(t2, "rejected", { reviewStatus: "rejected", reviewReason: "too short" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("1/2 任务通过"));
    assert.ok(report.includes("1 任务未通过"));
  });

  it("shows correct rejected count in overview", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "approved", { reviewStatus: "approved" });
    updateTaskStatus(t2, "rejected", { reviewStatus: "rejected" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("- 通过: 1"));
    assert.ok(report.includes("- 拒绝: 1"));
  });
});

// ── generateProjectReport: all failed ─────────────────────────────────────

describe("generateProjectReport: all tasks failed/rejected", () => {
  it("shows failure conclusion when no tasks approved", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Failed Project", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "failed", { failureReason: "timeout" });
    updateTaskStatus(t2, "rejected", { reviewStatus: "rejected" });
    project.status = "failed";

    const report = generateProjectReport(project);
    assert.ok(report.includes("所有任务均未通过验收。项目失败。"));
  });

  it("shows correct failed count in overview", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "failed");
    updateTaskStatus(t2, "failed");

    const report = generateProjectReport(project);
    assert.ok(report.includes("- 失败: 2"));
  });
});

// ── generateProjectReport: task details ───────────────────────────────────

describe("generateProjectReport: task details section", () => {
  it("includes retry count when task has retries", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Retry Project", request: "r" });
    const task = addTask(project, { trackId: "a", label: "Audit", maxRetry: 3 });
    task.retryCount = 2;
    updateTaskStatus(task, "approved", { reviewStatus: "approved" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("重试次数: 2"));
  });

  it("includes result summary when present", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Summary Project", request: "r" });
    const task = addTask(project, { trackId: "a", label: "Research" });
    updateTaskStatus(task, "approved", {
      reviewStatus: "approved",
      resultSummary: "Found 10 relevant issues",
    });

    const report = generateProjectReport(project);
    assert.ok(report.includes("Found 10 relevant issues"));
  });

  it("includes agentType when set", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Agent Project", request: "r" });
    const task = addTask(project, { trackId: "a", label: "Security", agentType: "security-reviewer" });
    updateTaskStatus(task, "approved", { reviewStatus: "approved" });

    const report = generateProjectReport(project);
    assert.ok(report.includes("security-reviewer"));
  });

  it("includes review reason when present", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(task, "rejected", {
      reviewStatus: "rejected",
      reviewReason: "insufficient data",
    });

    const report = generateProjectReport(project);
    assert.ok(report.includes("insufficient data"));
  });

  it("truncates long result summaries to 500 chars", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Long Project", request: "r" });
    const task = addTask(project, { trackId: "a", label: "A" });
    const longSummary = "x".repeat(600);
    updateTaskStatus(task, "approved", {
      reviewStatus: "approved",
      resultSummary: longSummary,
    });

    const report = generateProjectReport(project);
    // The summary in the report should not contain the full 600-char string
    assert.ok(!report.includes("x".repeat(600)));
    // But should contain the truncated 500-char version
    assert.ok(report.includes("x".repeat(500)));
  });
});
