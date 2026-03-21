import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

export type ProjectStatus = "pending" | "planning" | "dispatching" | "running" | "reviewing" | "done" | "failed";
export type TaskStatus = "pending" | "dispatched" | "running" | "completed" | "failed" | "approved" | "rejected";
export type SprintStage = "plan" | "build" | "review" | "test" | "ship";

export interface Task {
  id: string;
  trackId: string;
  label: string;
  agentType?: string;
  contentType?: string;
  status: TaskStatus;
  sessionKey?: string;
  subagentPrompt?: string;
  dispatchedAt?: string;
  completedAt?: string;
  resultText?: string;
  resultSummary?: string;
  reviewStatus?: "pending" | "approved" | "rejected";
  reviewReason?: string;
  retryCount: number;
  maxRetry: number;
  failureReason?: string;
  stage?: SprintStage;
  // M5: Task dependency chain
  blockedBy: string[];  // Task IDs that must complete before this task can start
  blocks: string[];     // Task IDs that are blocked by this task
  // M5: Task locking
  lockedBy?: string;    // Agent ID that currently holds the lock
  lockedAt?: string;    // Timestamp when the lock was acquired
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  request: string;
  createdAt: string;
  updatedAt: string;
  tasks: Task[];
  currentStage: SprintStage;
  stageHistory: Array<{
    stage: SprintStage;
    enteredAt: string;
    completedAt?: string;
    taskIds: string[];
  }>;
}

export interface TaskBoard {
  projects: Project[];
  version: number;
}

const BOARD_FILE = "task-board.json";

export function createEmptyBoard(): TaskBoard {
  return { projects: [], version: 1 };
}

export function loadBoard(sharedRoot: string): TaskBoard {
  const filePath = join(sharedRoot, BOARD_FILE);
  if (!existsSync(filePath)) {
    return createEmptyBoard();
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as TaskBoard;
    // Migrate old board data that may lack sprint pipeline fields
    for (const project of parsed.projects) {
      if (!project.currentStage) project.currentStage = "plan";
      if (!project.stageHistory) project.stageHistory = [];
      // M5: Migrate tasks that lack dependency/lock fields
      for (const task of project.tasks) {
        if (!task.blockedBy) task.blockedBy = [];
        if (!task.blocks) task.blocks = [];
        // lockedBy and lockedAt are optional, no migration needed
      }
    }
    return parsed;
  } catch {
    return createEmptyBoard();
  }
}

export function saveBoard(sharedRoot: string, board: TaskBoard): void {
  if (!existsSync(sharedRoot)) {
    mkdirSync(sharedRoot, { recursive: true });
  }
  const filePath = join(sharedRoot, BOARD_FILE);
  const tmpPath = filePath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(board, null, 2), "utf-8");
  renameSync(tmpPath, filePath);
}

export function generateTaskId(): string {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `task-${hex}`;
}

export function generateProjectId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const hex = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, "0");
  return `proj-${date}-${hex}`;
}

export function createProject(
  board: TaskBoard,
  params: { name: string; request: string },
): Project {
  const now = new Date().toISOString();
  const project: Project = {
    id: generateProjectId(),
    name: params.name,
    status: "pending",
    request: params.request,
    createdAt: now,
    updatedAt: now,
    tasks: [],
    currentStage: "plan",
    stageHistory: [],
  };
  board.projects.push(project);
  return project;
}

export function addTask(
  project: Project,
  params: {
    trackId: string;
    label: string;
    agentType?: string;
    contentType?: string;
    subagentPrompt?: string;
    maxRetry?: number;
    blockedBy?: string[];
  },
): Task {
  const task: Task = {
    id: generateTaskId(),
    trackId: params.trackId,
    label: params.label,
    agentType: params.agentType,
    contentType: params.contentType,
    status: "pending",
    subagentPrompt: params.subagentPrompt,
    retryCount: 0,
    maxRetry: params.maxRetry ?? 2,
    blockedBy: params.blockedBy ?? [],
    blocks: [],
  };
  project.tasks.push(task);
  return task;
}

export function updateTaskStatus(
  task: Task,
  status: TaskStatus,
  extra?: {
    sessionKey?: string;
    resultText?: string;
    resultSummary?: string;
    failureReason?: string;
    reviewStatus?: "pending" | "approved" | "rejected";
    reviewReason?: string;
  },
  board?: TaskBoard,
): void {
  // M5-08: Check dependencies before dispatching
  if (status === "dispatched" && board) {
    if (isTaskBlocked(board, task)) {
      // Cannot dispatch a blocked task - leave status unchanged
      // The caller should check isTaskBlocked before calling updateTaskStatus
      return;
    }
  }

  task.status = status;
  if (extra?.sessionKey !== undefined) task.sessionKey = extra.sessionKey;
  if (extra?.resultText !== undefined) task.resultText = extra.resultText;
  if (extra?.resultSummary !== undefined) task.resultSummary = extra.resultSummary;
  if (extra?.failureReason !== undefined) task.failureReason = extra.failureReason;
  if (extra?.reviewStatus !== undefined) task.reviewStatus = extra.reviewStatus;
  if (extra?.reviewReason !== undefined) task.reviewReason = extra.reviewReason;

  const now = new Date().toISOString();
  if (status === "dispatched") {
    task.dispatchedAt = now;
  }
  if (status === "completed" || status === "failed") {
    task.completedAt = now;
  }

  // M5-09: Auto-unblock downstream tasks when this task completes/approves
  if (board && (status === "completed" || status === "approved")) {
    const downstreamTasks = getDownstreamTasks(board, task.id);
    for (const downstreamTask of downstreamTasks) {
      // Check if all dependencies are now satisfied
      if (!isTaskBlocked(board, downstreamTask)) {
        // The task is now ready - this could trigger a notification
        // or auto-dispatch if configured
      }
    }
  }
}

const SPRINT_STAGE_ORDER: SprintStage[] = ["plan", "build", "review", "test", "ship"];

export function advanceProjectStatus(project: Project): void {
  const tasks = project.tasks;
  if (tasks.length === 0) {
    project.status = "pending";
    project.updatedAt = new Date().toISOString();
    return;
  }

  const allApproved = tasks.every((t) => t.status === "approved");
  if (allApproved) {
    // If tasks have stage assignments, check whether the current sprint stage is complete
    // and advance to the next stage. Only mark "done" when at the last stage (or no stage tags).
    const hasStageAssignments = tasks.some((t) => t.stage !== undefined);
    if (hasStageAssignments && isStageComplete(project)) {
      const nextStage = advanceStage(project);
      if (nextStage === null) {
        project.status = "done";
      }
    } else if (!hasStageAssignments) {
      project.status = "done";
    }
    project.updatedAt = new Date().toISOString();
    return;
  }

  const anyActive = tasks.some((t) => t.status === "dispatched" || t.status === "running");
  if (anyActive) {
    project.status = "running";
    project.updatedAt = new Date().toISOString();
    return;
  }

  const allDone = tasks.every(
    (t) => t.status === "completed" || t.status === "failed" || t.status === "approved" || t.status === "rejected",
  );
  if (allDone) {
    // Check if any task is rejected with no more retries
    const exhausted = tasks.some(
      (t) => (t.status === "failed" || t.status === "rejected") && t.retryCount >= t.maxRetry,
    );
    if (exhausted) {
      project.status = "failed";
    } else {
      project.status = "reviewing";
    }
    project.updatedAt = new Date().toISOString();
    return;
  }

  // Some tasks still pending
  const anyPending = tasks.some((t) => t.status === "pending");
  if (anyPending) {
    project.status = "pending";
    project.updatedAt = new Date().toISOString();
  }
}

export function getProject(board: TaskBoard, projectId: string): Project | undefined {
  return board.projects.find((p) => p.id === projectId);
}

export function getActiveProjects(board: TaskBoard): Project[] {
  return board.projects.filter(
    (p) => p.status !== "done" && p.status !== "failed",
  );
}

export function getProjectSummary(project: Project): {
  total: number;
  pending: number;
  dispatched: number;
  running: number;
  completed: number;
  failed: number;
  approved: number;
  rejected: number;
} {
  const tasks = project.tasks;
  return {
    total: tasks.length,
    pending: tasks.filter((t) => t.status === "pending").length,
    dispatched: tasks.filter((t) => t.status === "dispatched").length,
    running: tasks.filter((t) => t.status === "running").length,
    completed: tasks.filter((t) => t.status === "completed").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    approved: tasks.filter((t) => t.status === "approved").length,
    rejected: tasks.filter((t) => t.status === "rejected").length,
  };
}

export function getRetryableTasks(project: Project): Task[] {
  return project.tasks.filter(
    (t) => t.status === "failed" && t.retryCount < t.maxRetry,
  );
}

export function getPendingTasks(project: Project): Task[] {
  return project.tasks.filter((t) => t.status === "pending");
}

const STAGE_AGENT_TYPES: Record<SprintStage, string[]> = {
  plan: ["planner", "architect", "analyst"],
  build: ["executor", "coder"],
  review: ["code-reviewer", "security-reviewer"],
  test: ["tdd-guide", "test-engineer", "qa-tester"],
  ship: ["git-master", "doc-updater"],
};

export function advanceStage(project: Project): SprintStage | null {
  const currentStage = project.currentStage ?? "plan";
  const currentIndex = SPRINT_STAGE_ORDER.indexOf(currentStage);
  const nextIndex = currentIndex + 1;

  if (nextIndex >= SPRINT_STAGE_ORDER.length) {
    return null;
  }

  const now = new Date().toISOString();
  const currentStageTasks = project.tasks
    .filter((t) => t.stage === currentStage)
    .map((t) => t.id);

  // Close out the current stage in history
  const existingEntry = project.stageHistory.find((h) => h.stage === currentStage && !h.completedAt);
  if (existingEntry) {
    existingEntry.completedAt = now;
  }

  const nextStage = SPRINT_STAGE_ORDER[nextIndex];
  project.stageHistory.push({
    stage: nextStage,
    enteredAt: now,
    taskIds: currentStageTasks,
  });
  project.currentStage = nextStage;
  project.updatedAt = now;
  return nextStage;
}

export function getStageAgentTypes(stage: SprintStage): string[] {
  return STAGE_AGENT_TYPES[stage];
}

export function isStageComplete(project: Project): boolean {
  const currentStage = project.currentStage ?? "plan";
  const stageTasks = project.tasks.filter((t) => t.stage === currentStage);
  if (stageTasks.length === 0) {
    return false;
  }
  return stageTasks.every(
    (t) => t.status === "completed" || t.status === "approved" || t.status === "failed",
  );
}

const STAGE_LABELS: Record<SprintStage, string> = {
  plan: "Plan",
  build: "Build",
  review: "Review",
  test: "Test",
  ship: "Ship",
};

export function formatSprintBoard(project: Project): string {
  const currentStage = project.currentStage ?? "plan";
  const lines: string[] = [];

  lines.push(`Sprint: ${project.name}`);
  lines.push(`Stage: ${STAGE_LABELS[currentStage]} [${currentStage}]`);
  lines.push("");

  for (const stage of SPRINT_STAGE_ORDER) {
    const isActive = stage === currentStage;
    const historyEntry = project.stageHistory.find((h) => h.stage === stage);
    const isDone = historyEntry?.completedAt !== undefined;
    const marker = isDone ? "[x]" : isActive ? "[>]" : "[ ]";
    lines.push(`  ${marker} ${STAGE_LABELS[stage]}`);
  }

  lines.push("");

  const stageTasks = project.tasks.filter((t) => t.stage === currentStage);
  if (stageTasks.length > 0) {
    lines.push(`Tasks in ${STAGE_LABELS[currentStage]}:`);
    for (const task of stageTasks) {
      const icon = STATUS_ICONS[task.status] ?? "⬜";
      lines.push(`  - ${task.label}   ${icon} ${task.status}`);
    }
  } else {
    lines.push(`No tasks assigned to ${STAGE_LABELS[currentStage]} stage.`);
  }

  return lines.join("\n");
}

const STATUS_ICONS: Record<TaskStatus, string> = {
  pending: "⬜",
  dispatched: "🔵",
  running: "🟡",
  completed: "✅",
  failed: "🔴",
  approved: "🟢",
  rejected: "❌",
};

export function formatBoardDisplay(board: TaskBoard): string {
  if (board.projects.length === 0) {
    return "No projects on the board.";
  }
  const lines: string[] = [];
  for (const project of board.projects) {
    lines.push(`📋 Project: ${project.name} (${project.status})`);
    lines.push(`   ID: ${project.id}`);
    const tasks = project.tasks;
    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const isLast = i === tasks.length - 1;
      const connector = isLast ? "└─" : "├─";
      const icon = STATUS_ICONS[task.status] ?? "⬜";
      let line = `  ${connector} ${task.id}: ${task.label}   ${icon} ${task.status}`;
      if (task.status === "failed" && task.retryCount > 0) {
        line += ` (retry ${task.retryCount}/${task.maxRetry})`;
      }
      lines.push(line);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

// ============================================================================
// M5: Task Dependency Chain Functions
// ============================================================================

/**
 * Check if a task is blocked by incomplete dependencies.
 * Returns true if any task in blockedBy is not completed/approved.
 */
export function isTaskBlocked(board: TaskBoard, task: Task): boolean {
  if (task.blockedBy.length === 0) {
    return false;
  }

  // Find all tasks that this task is waiting on
  for (const blockingTaskId of task.blockedBy) {
    const blockingTask = findTaskById(board, blockingTaskId);
    if (blockingTask && blockingTask.status !== "completed" && blockingTask.status !== "approved") {
      return true;
    }
  }

  return false;
}

/**
 * Find a task by ID across all projects.
 */
export function findTaskById(board: TaskBoard, taskId: string): Task | undefined {
  for (const project of board.projects) {
    const task = project.tasks.find((t) => t.id === taskId);
    if (task) return task;
  }
  return undefined;
}

/**
 * Find a task by label within a project.
 */
export function findTaskByLabel(project: Project, label: string): Task | undefined {
  return project.tasks.find((t) => t.label === label);
}

/**
 * Attempt to acquire a lock on a task for an agent.
 * Returns true if successful, false if already locked by another agent.
 */
export function acquireTaskLock(board: TaskBoard, taskId: string, agentId: string): boolean {
  const task = findTaskById(board, taskId);
  if (!task) {
    return false;
  }

  // Already locked by same agent - allow re-entry
  if (task.lockedBy === agentId) {
    return true;
  }

  // Locked by different agent - deny
  if (task.lockedBy && task.lockedBy !== agentId) {
    return false;
  }

  // Not locked - acquire
  task.lockedBy = agentId;
  task.lockedAt = new Date().toISOString();
  return true;
}

/**
 * Release a task lock.
 */
export function releaseTaskLock(board: TaskBoard, taskId: string): void {
  const task = findTaskById(board, taskId);
  if (task) {
    task.lockedBy = undefined;
    task.lockedAt = undefined;
  }
}

/**
 * Get all downstream tasks that depend on this task.
 */
export function getDownstreamTasks(board: TaskBoard, taskId: string): Task[] {
  const downstream: Task[] = [];
  for (const project of board.projects) {
    for (const task of project.tasks) {
      if (task.blockedBy.includes(taskId)) {
        downstream.push(task);
      }
    }
  }
  return downstream;
}

/**
 * Detect if adding a dependency would create a cycle.
 * Returns the cycle path if detected, null otherwise.
 */
export function detectDependencyCycle(board: TaskBoard, taskId: string, newDependencyId?: string): string[] | null {
  const visited = new Set<string>();
  const path: string[] = [];

  function dfs(currentId: string): string[] | null {
    if (visited.has(currentId)) {
      // Found a cycle - return the cycle path
      const cycleStart = path.indexOf(currentId);
      if (cycleStart >= 0) {
        return path.slice(cycleStart);
      }
      return null;
    }

    const task = findTaskById(board, currentId);
    if (!task) return null;

    visited.add(currentId);
    path.push(currentId);

    // Check all dependencies (including the new one being added)
    const deps = [...task.blockedBy];
    if (newDependencyId && currentId === taskId) {
      deps.push(newDependencyId);
    }

    for (const depId of deps) {
      const cycle = dfs(depId);
      if (cycle) return cycle;
    }

    path.pop();
    return null;
  }

  return dfs(taskId);
}

/**
 * Add a dependency: task A blocks task B.
 * Automatically updates both tasks' blockedBy and blocks arrays.
 * Returns true if successful, false if would create cycle.
 */
export function addTaskDependency(
  board: TaskBoard,
  blockingTaskId: string,
  blockedTaskId: string,
): { success: boolean; error?: string } {
  const blockingTask = findTaskById(board, blockingTaskId);
  const blockedTask = findTaskById(board, blockedTaskId);

  if (!blockingTask || !blockedTask) {
    return { success: false, error: "Task not found" };
  }

  // Check for existing dependency
  if (blockedTask.blockedBy.includes(blockingTaskId)) {
    return { success: false, error: "Dependency already exists" };
  }

  // Check for cycle
  const cycle = detectDependencyCycle(board, blockedTaskId, blockingTaskId);
  if (cycle) {
    return { success: false, error: `Would create cycle: ${cycle.join(" → ")}` };
  }

  // Add dependency
  blockedTask.blockedBy.push(blockingTaskId);
  blockingTask.blocks.push(blockedTaskId);

  return { success: true };
}

/**
 * Remove a dependency between tasks.
 */
export function removeTaskDependency(board: TaskBoard, blockingTaskId: string, blockedTaskId: string): void {
  const blockingTask = findTaskById(board, blockingTaskId);
  const blockedTask = findTaskById(board, blockedTaskId);

  if (blockingTask) {
    blockingTask.blocks = blockingTask.blocks.filter((id) => id !== blockedTaskId);
  }

  if (blockedTask) {
    blockedTask.blockedBy = blockedTask.blockedBy.filter((id) => id !== blockingTaskId);
  }
}

/**
 * Get all tasks that are ready to be dispatched (not blocked, not locked, pending status).
 */
export function getReadyTasks(project: Project, board: TaskBoard): Task[] {
  return project.tasks.filter((task) => {
    if (task.status !== "pending") return false;
    if (task.lockedBy) return false;
    if (isTaskBlocked(board, task)) return false;
    return true;
  });
}
