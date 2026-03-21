import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createEmptyBoard,
  loadBoard,
  saveBoard,
  createProject,
  addTask,
  updateTaskStatus,
  advanceProjectStatus,
  getProject,
  getActiveProjects,
  getProjectSummary,
  getRetryableTasks,
  getPendingTasks,
  formatBoardDisplay,
  generateTaskId,
  generateProjectId,
  // M5: Task dependency chain functions
  isTaskBlocked,
  findTaskById,
  acquireTaskLock,
  releaseTaskLock,
  getDownstreamTasks,
  detectDependencyCycle,
  addTaskDependency,
  removeTaskDependency,
  getReadyTasks,
} from "../src/task-board.ts";
import type { TaskBoard } from "../src/task-board.ts";

// ── createEmptyBoard ───────────────────────────────────────────────────────

describe("createEmptyBoard", () => {
  it("returns a board with empty projects array and version 1", () => {
    const board = createEmptyBoard();
    assert.deepEqual(board.projects, []);
    assert.equal(board.version, 1);
  });
});

// ── generateTaskId / generateProjectId ────────────────────────────────────

describe("generateTaskId", () => {
  it("starts with 'task-'", () => {
    assert.ok(generateTaskId().startsWith("task-"));
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateTaskId()));
    assert.ok(ids.size > 40);
  });
});

describe("generateProjectId", () => {
  it("starts with 'proj-'", () => {
    assert.ok(generateProjectId().startsWith("proj-"));
  });

  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateProjectId()));
    assert.ok(ids.size > 40);
  });
});

// ── createProject ─────────────────────────────────────────────────────────

describe("createProject", () => {
  it("adds project to board and returns it", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Test", request: "do something" });
    assert.equal(board.projects.length, 1);
    assert.equal(board.projects[0], project);
  });

  it("sets initial status to pending", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "Test", request: "do something" });
    assert.equal(project.status, "pending");
  });

  it("sets name and request", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "My Project", request: "run tests" });
    assert.equal(project.name, "My Project");
    assert.equal(project.request, "run tests");
  });

  it("generates a unique id", () => {
    const board = createEmptyBoard();
    const p1 = createProject(board, { name: "A", request: "a" });
    const p2 = createProject(board, { name: "B", request: "b" });
    assert.notEqual(p1.id, p2.id);
  });

  it("initializes tasks as empty array", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    assert.deepEqual(project.tasks, []);
  });
});

// ── addTask ───────────────────────────────────────────────────────────────

describe("addTask", () => {
  it("adds task to project and returns it", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "track-1", label: "Security Audit" });
    assert.equal(project.tasks.length, 1);
    assert.equal(project.tasks[0], task);
  });

  it("sets initial status to pending", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "track-1", label: "Audit" });
    assert.equal(task.status, "pending");
  });

  it("uses default maxRetry of 2", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "track-1", label: "Audit" });
    assert.equal(task.maxRetry, 2);
  });

  it("respects custom maxRetry", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "track-1", label: "Audit", maxRetry: 5 });
    assert.equal(task.maxRetry, 5);
  });

  it("sets trackId, label, agentType, contentType, subagentPrompt", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, {
      trackId: "sec-track",
      label: "Security",
      agentType: "security-reviewer",
      contentType: "text-analysis",
      subagentPrompt: "Check for vulnerabilities",
    });
    assert.equal(task.trackId, "sec-track");
    assert.equal(task.label, "Security");
    assert.equal(task.agentType, "security-reviewer");
    assert.equal(task.contentType, "text-analysis");
    assert.equal(task.subagentPrompt, "Check for vulnerabilities");
  });

  it("initializes retryCount to 0", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    assert.equal(task.retryCount, 0);
  });
});

// ── updateTaskStatus ──────────────────────────────────────────────────────

describe("updateTaskStatus", () => {
  it("updates status", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched");
    assert.equal(task.status, "dispatched");
  });

  it("sets dispatchedAt when transitioning to dispatched", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched");
    assert.ok(typeof task.dispatchedAt === "string");
  });

  it("sets completedAt when transitioning to completed", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "completed");
    assert.ok(typeof task.completedAt === "string");
  });

  it("sets completedAt when transitioning to failed", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "failed");
    assert.ok(typeof task.completedAt === "string");
  });

  it("sets sessionKey from extra", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "dispatched", { sessionKey: "sess-abc" });
    assert.equal(task.sessionKey, "sess-abc");
  });

  it("sets resultText and resultSummary from extra", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "completed", { resultText: "found 3 issues", resultSummary: "ok" });
    assert.equal(task.resultText, "found 3 issues");
    assert.equal(task.resultSummary, "ok");
  });

  it("sets reviewStatus from extra", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const task = addTask(project, { trackId: "t", label: "L" });
    updateTaskStatus(task, "approved", { reviewStatus: "approved", reviewReason: "looks good" });
    assert.equal(task.reviewStatus, "approved");
    assert.equal(task.reviewReason, "looks good");
  });
});

// ── advanceProjectStatus ──────────────────────────────────────────────────

describe("advanceProjectStatus", () => {
  it("all tasks approved → project done", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "approved");
    updateTaskStatus(t2, "approved");
    advanceProjectStatus(project);
    assert.equal(project.status, "done");
  });

  it("any task dispatched → project running", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "dispatched");
    advanceProjectStatus(project);
    assert.equal(project.status, "running");
  });

  it("any task running → project running", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "running");
    advanceProjectStatus(project);
    assert.equal(project.status, "running");
  });

  it("all tasks completed/failed and no exhausted retries → project reviewing", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t1, "completed");
    updateTaskStatus(t2, "completed");
    advanceProjectStatus(project);
    assert.equal(project.status, "reviewing");
  });

  it("failed task with retryCount >= maxRetry → project failed", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A", maxRetry: 2 });
    t1.retryCount = 2;
    updateTaskStatus(t1, "failed");
    advanceProjectStatus(project);
    assert.equal(project.status, "failed");
  });

  it("some tasks still pending → project pending", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    addTask(project, { trackId: "a", label: "A" });
    addTask(project, { trackId: "b", label: "B" });
    advanceProjectStatus(project);
    assert.equal(project.status, "pending");
  });

  it("empty tasks → project pending", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    advanceProjectStatus(project);
    assert.equal(project.status, "pending");
  });
});

// ── getRetryableTasks ─────────────────────────────────────────────────────

describe("getRetryableTasks", () => {
  it("returns failed tasks where retryCount < maxRetry", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A", maxRetry: 2 });
    t1.retryCount = 1;
    updateTaskStatus(t1, "failed");
    const t2 = addTask(project, { trackId: "b", label: "B", maxRetry: 2 });
    t2.retryCount = 2;
    updateTaskStatus(t2, "failed");
    const retryable = getRetryableTasks(project);
    assert.equal(retryable.length, 1);
    assert.equal(retryable[0], t1);
  });

  it("returns empty array if no failed tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    addTask(project, { trackId: "a", label: "A" });
    assert.deepEqual(getRetryableTasks(project), []);
  });

  it("does not return non-failed tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "completed");
    assert.deepEqual(getRetryableTasks(project), []);
  });
});

// ── getPendingTasks ───────────────────────────────────────────────────────

describe("getPendingTasks", () => {
  it("returns only pending tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    updateTaskStatus(t2, "dispatched");
    const pending = getPendingTasks(project);
    assert.equal(pending.length, 1);
    assert.equal(pending[0], t1);
  });

  it("returns empty array when all tasks dispatched", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    updateTaskStatus(t1, "dispatched");
    assert.deepEqual(getPendingTasks(project), []);
  });
});

// ── getProjectSummary ─────────────────────────────────────────────────────

describe("getProjectSummary", () => {
  it("returns correct counts", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const t1 = addTask(project, { trackId: "a", label: "A" });
    const t2 = addTask(project, { trackId: "b", label: "B" });
    const t3 = addTask(project, { trackId: "c", label: "C" });
    updateTaskStatus(t2, "completed");
    updateTaskStatus(t3, "failed");
    const summary = getProjectSummary(project);
    assert.equal(summary.total, 3);
    assert.equal(summary.pending, 1);
    assert.equal(summary.completed, 1);
    assert.equal(summary.failed, 1);
    assert.equal(summary.dispatched, 0);
    assert.equal(summary.running, 0);
    assert.equal(summary.approved, 0);
    assert.equal(summary.rejected, 0);
  });

  it("returns all zeros for empty project", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    const summary = getProjectSummary(project);
    assert.equal(summary.total, 0);
    assert.equal(summary.pending, 0);
  });
});

// ── getActiveProjects ─────────────────────────────────────────────────────

describe("getActiveProjects", () => {
  it("excludes done and failed projects", () => {
    const board = createEmptyBoard();
    const p1 = createProject(board, { name: "A", request: "r" });
    const p2 = createProject(board, { name: "B", request: "r" });
    const p3 = createProject(board, { name: "C", request: "r" });
    p1.status = "done";
    p2.status = "failed";
    const active = getActiveProjects(board);
    assert.equal(active.length, 1);
    assert.equal(active[0], p3);
  });

  it("returns all projects when none are done/failed", () => {
    const board = createEmptyBoard();
    createProject(board, { name: "A", request: "r" });
    createProject(board, { name: "B", request: "r" });
    assert.equal(getActiveProjects(board).length, 2);
  });
});

// ── formatBoardDisplay ────────────────────────────────────────────────────

describe("formatBoardDisplay", () => {
  it("shows 'No projects' message for empty board", () => {
    const board = createEmptyBoard();
    assert.ok(formatBoardDisplay(board).includes("No projects"));
  });

  it("contains project name and status", () => {
    const board = createEmptyBoard();
    createProject(board, { name: "My Project", request: "r" });
    const display = formatBoardDisplay(board);
    assert.ok(display.includes("My Project"));
    assert.ok(display.includes("pending"));
  });

  it("contains task label and status", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    addTask(project, { trackId: "t", label: "Security Audit" });
    const display = formatBoardDisplay(board);
    assert.ok(display.includes("Security Audit"));
  });

  it("shows retry count for failed tasks", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "P", request: "r" });
    const task = addTask(project, { trackId: "t", label: "Audit", maxRetry: 2 });
    task.retryCount = 1;
    updateTaskStatus(task, "failed");
    const display = formatBoardDisplay(board);
    assert.ok(display.includes("retry 1/2"));
  });
});

// ── loadBoard / saveBoard round-trip ──────────────────────────────────────

describe("loadBoard / saveBoard", () => {
  let testDir: string;

  before(() => {
    testDir = join(tmpdir(), `task-board-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("round-trips a board through the filesystem", () => {
    const board = createEmptyBoard();
    createProject(board, { name: "Project A", request: "do stuff" });
    saveBoard(testDir, board);
    const loaded = loadBoard(testDir);
    assert.equal(loaded.projects.length, 1);
    assert.equal(loaded.projects[0].name, "Project A");
  });

  it("returns empty board when file does not exist", () => {
    const emptyDir = join(tmpdir(), `task-board-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const board = loadBoard(emptyDir);
    assert.deepEqual(board.projects, []);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it("atomic write: final file content is valid", () => {
    const board = createEmptyBoard();
    createProject(board, { name: "Atomic Test", request: "write atomically" });
    saveBoard(testDir, board);
    const filePath = join(testDir, "task-board.json");
    assert.ok(existsSync(filePath));
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TaskBoard;
    assert.equal(parsed.projects[0].name, "Atomic Test");
  });

  it("creates directory if it does not exist", () => {
    const newDir = join(tmpdir(), `task-board-new-${Date.now()}`);
    assert.ok(!existsSync(newDir));
    const board = createEmptyBoard();
    saveBoard(newDir, board);
    assert.ok(existsSync(newDir));
    rmSync(newDir, { recursive: true, force: true });
  });
});

// ── getProject ────────────────────────────────────────────────────────────

describe("getProject", () => {
  it("returns the project with matching id", () => {
    const board = createEmptyBoard();
    const project = createProject(board, { name: "T", request: "r" });
    assert.equal(getProject(board, project.id), project);
  });

  it("returns undefined for unknown id", () => {
    const board = createEmptyBoard();
    assert.equal(getProject(board, "nonexistent"), undefined);
  });
});

// ── M5: Task Dependency Chain ───────────────────────────────────────────────

describe("Task Dependency Chain", () => {
  describe("isTaskBlocked", () => {
    it("returns false for task with no dependencies", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const task = addTask(project, { trackId: "t", label: "Task A" });
      assert.equal(isTaskBlocked(board, task), false);
    });

    it("returns true when dependency is not completed", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      taskA.blocks.push(taskB.id);

      assert.equal(isTaskBlocked(board, taskB), true);
    });

    it("returns false when dependency is completed", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      taskA.blocks.push(taskB.id);

      taskA.status = "completed";
      assert.equal(isTaskBlocked(board, taskB), false);
    });

    it("returns false when dependency is approved", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });

      taskA.status = "approved";
      assert.equal(isTaskBlocked(board, taskB), false);
    });

    it("handles multiple dependencies (all must complete)", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B" });
      const taskC = addTask(project, { trackId: "t3", label: "Task C", blockedBy: [taskA.id, taskB.id] });

      // Only A completed - still blocked
      taskA.status = "completed";
      assert.equal(isTaskBlocked(board, taskC), true);

      // Both completed - not blocked
      taskB.status = "completed";
      assert.equal(isTaskBlocked(board, taskC), false);
    });
  });

  describe("acquireTaskLock / releaseTaskLock", () => {
    it("acquires lock for unlocked task", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const task = addTask(project, { trackId: "t", label: "Task" });

      const result = acquireTaskLock(board, task.id, "agent-1");
      assert.equal(result, true);
      assert.equal(task.lockedBy, "agent-1");
      assert.ok(task.lockedAt);
    });

    it("allows re-entry by same agent", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const task = addTask(project, { trackId: "t", label: "Task" });

      acquireTaskLock(board, task.id, "agent-1");
      const result = acquireTaskLock(board, task.id, "agent-1");
      assert.equal(result, true);
    });

    it("denies lock when held by different agent", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const task = addTask(project, { trackId: "t", label: "Task" });

      acquireTaskLock(board, task.id, "agent-1");
      const result = acquireTaskLock(board, task.id, "agent-2");
      assert.equal(result, false);
      assert.equal(task.lockedBy, "agent-1");
    });

    it("releases lock", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const task = addTask(project, { trackId: "t", label: "Task" });

      acquireTaskLock(board, task.id, "agent-1");
      releaseTaskLock(board, task.id);
      assert.equal(task.lockedBy, undefined);
      assert.equal(task.lockedAt, undefined);
    });

    it("fails gracefully for non-existent task", () => {
      const board = createEmptyBoard();
      const result = acquireTaskLock(board, "nonexistent", "agent-1");
      assert.equal(result, false);
    });
  });

  describe("getDownstreamTasks", () => {
    it("returns tasks that depend on the given task", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      const taskC = addTask(project, { trackId: "t3", label: "Task C", blockedBy: [taskA.id] });
      const taskD = addTask(project, { trackId: "t4", label: "Task D" }); // No dependency

      const downstream = getDownstreamTasks(board, taskA.id);
      assert.equal(downstream.length, 2);
      assert.ok(downstream.includes(taskB));
      assert.ok(downstream.includes(taskC));
      assert.ok(!downstream.includes(taskD));
    });
  });

  describe("detectDependencyCycle", () => {
    it("returns null for no cycle", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });

      const cycle = detectDependencyCycle(board, taskB.id);
      assert.equal(cycle, null);
    });

    it("detects direct self-dependency", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A", blockedBy: ["task-self"] });
      taskA.id = "task-self";

      const cycle = detectDependencyCycle(board, taskA.id);
      assert.ok(cycle);
    });

    it("detects indirect cycle", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      const taskC = addTask(project, { trackId: "t3", label: "Task C", blockedBy: [taskB.id] });

      // Create cycle: A -> B -> C -> A
      taskA.blockedBy.push(taskC.id);

      const cycle = detectDependencyCycle(board, taskA.id);
      assert.ok(cycle);
      assert.ok(cycle!.length >= 2);
    });
  });

  describe("addTaskDependency", () => {
    it("adds dependency successfully", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B" });

      const result = addTaskDependency(board, taskA.id, taskB.id);
      assert.equal(result.success, true);
      assert.ok(taskB.blockedBy.includes(taskA.id));
      assert.ok(taskA.blocks.includes(taskB.id));
    });

    it("rejects duplicate dependency", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B" });

      addTaskDependency(board, taskA.id, taskB.id);
      const result = addTaskDependency(board, taskA.id, taskB.id);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("already exists"));
    });

    it("rejects cycle-creating dependency", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      const taskC = addTask(project, { trackId: "t3", label: "Task C", blockedBy: [taskB.id] });

      // Try to create A -> B -> C -> A cycle
      const result = addTaskDependency(board, taskC.id, taskA.id);
      assert.equal(result.success, false);
      assert.ok(result.error?.includes("cycle"));
    });
  });

  describe("getReadyTasks", () => {
    it("returns pending tasks that are not blocked or locked", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      const taskB = addTask(project, { trackId: "t2", label: "Task B", blockedBy: [taskA.id] });
      const taskC = addTask(project, { trackId: "t3", label: "Task C" });

      const ready = getReadyTasks(project, board);
      assert.equal(ready.length, 2);
      assert.ok(ready.includes(taskA));
      assert.ok(ready.includes(taskC));
      assert.ok(!ready.includes(taskB));
    });

    it("excludes locked tasks", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      acquireTaskLock(board, taskA.id, "agent-1");

      const ready = getReadyTasks(project, board);
      assert.equal(ready.length, 0);
    });

    it("excludes non-pending tasks", () => {
      const board = createEmptyBoard();
      const project = createProject(board, { name: "P", request: "r" });
      const taskA = addTask(project, { trackId: "t1", label: "Task A" });
      taskA.status = "dispatched";

      const ready = getReadyTasks(project, board);
      assert.equal(ready.length, 0);
    });
  });
});
