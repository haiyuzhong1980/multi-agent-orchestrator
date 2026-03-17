import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkAndResume, buildResumePrompt } from "../src/session-resume.ts";
import {
  createEmptyBoard,
  createProject,
  addTask,
  updateTaskStatus,
} from "../src/task-board.ts";

// ── checkAndResume: empty board ────────────────────────────────────────────

describe("checkAndResume: no active projects", () => {
  it("returns resumed=false when board is empty", () => {
    const board = createEmptyBoard();
    const result = checkAndResume(board);
    assert.equal(result.resumed, false);
    assert.equal(result.projectsChecked, 0);
    assert.equal(result.tasksStillRunning, 0);
    assert.equal(result.tasksNeedingRetry, 0);
    assert.equal(result.tasksReadyForReview, 0);
    assert.deepEqual(result.actions, []);
  });

  it("returns resumed=false when all projects are done", () => {
    const board = createEmptyBoard();
    const p = createProject(board, { name: "Finished", request: "r" });
    p.status = "done";
    const result = checkAndResume(board);
    assert.equal(result.resumed, false);
    assert.equal(result.projectsChecked, 0);
  });

  it("returns resumed=false when all projects are failed", () => {
    const board = createEmptyBoard();
    const p = createProject(board, { name: "Failed", request: "r" });
    p.status = "failed";
    const result = checkAndResume(board);
    assert.equal(result.resumed, false);
  });
});

// ── checkAndResume: running tasks ─────────────────────────────────────────

describe("checkAndResume: active project with running tasks", () => {
  it("detects dispatched tasks as still running", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Alpha", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-1" });

    const result = checkAndResume(board);
    assert.equal(result.resumed, true);
    assert.equal(result.tasksStillRunning, 1);
    assert.equal(result.projectsChecked, 1);
    assert.ok(result.actions.some((a) => a.includes("可能仍在运行")));
  });

  it("detects running tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Beta", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1" });
    updateTaskStatus(task, "running");

    const result = checkAndResume(board);
    assert.equal(result.tasksStillRunning, 1);
  });

  it("counts running tasks across multiple projects", () => {
    const board = createEmptyBoard();
    const p1 = createProject(board, { name: "P1", request: "r" });
    const t1 = addTask(p1, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "dispatched");

    const p2 = createProject(board, { name: "P2", request: "r" });
    const t2 = addTask(p2, { trackId: "b", label: "B" });
    updateTaskStatus(t2, "running");

    const result = checkAndResume(board);
    assert.equal(result.tasksStillRunning, 2);
    assert.equal(result.projectsChecked, 2);
  });
});

// ── checkAndResume: retryable tasks ───────────────────────────────────────

describe("checkAndResume: active project with retryable tasks", () => {
  it("detects failed tasks eligible for retry", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Gamma", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1", maxRetry: 2 });
    task.retryCount = 1;
    updateTaskStatus(task, "failed");

    const result = checkAndResume(board);
    assert.equal(result.resumed, true);
    assert.equal(result.tasksNeedingRetry, 1);
    assert.ok(result.actions.some((a) => a.includes("可重试")));
  });

  it("does not count exhausted retries", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Delta", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1", maxRetry: 2 });
    task.retryCount = 2;
    updateTaskStatus(task, "failed");

    const result = checkAndResume(board);
    assert.equal(result.tasksNeedingRetry, 0);
  });
});

// ── checkAndResume: reviewable tasks ──────────────────────────────────────

describe("checkAndResume: active project with reviewable tasks", () => {
  it("detects completed tasks without reviewStatus", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Epsilon", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1" });
    updateTaskStatus(task, "completed");

    const result = checkAndResume(board);
    assert.equal(result.resumed, true);
    assert.equal(result.tasksReadyForReview, 1);
    assert.ok(result.actions.some((a) => a.includes("待验收")));
  });

  it("does not count completed tasks that already have reviewStatus", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Zeta", request: "r" });
    const task = addTask(project, { trackId: "t1", label: "Task 1" });
    updateTaskStatus(task, "completed", { reviewStatus: "approved" });

    const result = checkAndResume(board);
    assert.equal(result.tasksReadyForReview, 0);
  });
});

// ── checkAndResume: pending tasks ─────────────────────────────────────────

describe("checkAndResume: active project with pending tasks", () => {
  it("detects never-dispatched pending tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Eta", request: "r" });
    addTask(project, { trackId: "t1", label: "Task 1" });
    addTask(project, { trackId: "t2", label: "Task 2" });

    const result = checkAndResume(board);
    assert.equal(result.resumed, true);
    assert.ok(result.actions.some((a) => a.includes("未派工")));
  });
});

// ── buildResumePrompt ─────────────────────────────────────────────────────

describe("buildResumePrompt: returns null when not resumed", () => {
  it("returns null when resumed=false", () => {
    const result = buildResumePrompt({
      resumed: false,
      projectsChecked: 0,
      tasksStillRunning: 0,
      tasksNeedingRetry: 0,
      tasksReadyForReview: 0,
      actions: [],
    });
    assert.equal(result, null);
  });
});

describe("buildResumePrompt: builds prompt with actions", () => {
  it("includes OMA header and action list", () => {
    const result = buildResumePrompt({
      resumed: true,
      projectsChecked: 1,
      tasksStillRunning: 0,
      tasksNeedingRetry: 0,
      tasksReadyForReview: 1,
      actions: ['项目 "Test": 1 个任务待验收'],
    });
    assert.ok(result !== null);
    assert.ok(result.includes("[OMA 断线恢复]"));
    assert.ok(result.includes("待验收"));
  });

  it("includes retry suggestion when tasksNeedingRetry > 0", () => {
    const result = buildResumePrompt({
      resumed: true,
      projectsChecked: 1,
      tasksStillRunning: 0,
      tasksNeedingRetry: 2,
      tasksReadyForReview: 0,
      actions: ['项目 "Test": 2 个任务失败，可重试'],
    });
    assert.ok(result !== null);
    assert.ok(result.includes("sessions_spawn"));
  });

  it("includes validate_and_merge suggestion when tasksReadyForReview > 0", () => {
    const result = buildResumePrompt({
      resumed: true,
      projectsChecked: 1,
      tasksStillRunning: 0,
      tasksNeedingRetry: 0,
      tasksReadyForReview: 3,
      actions: ['项目 "Test": 3 个任务待验收'],
    });
    assert.ok(result !== null);
    assert.ok(result.includes("validate_and_merge"));
  });

  it("includes sessions_yield suggestion when tasksStillRunning > 0", () => {
    const result = buildResumePrompt({
      resumed: true,
      projectsChecked: 1,
      tasksStillRunning: 1,
      tasksNeedingRetry: 0,
      tasksReadyForReview: 0,
      actions: ['项目 "Test": 1 个子 agent 可能仍在运行'],
    });
    assert.ok(result !== null);
    assert.ok(result.includes("sessions_yield"));
  });
});
