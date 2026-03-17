import {
  type TaskBoard,
  type Project,
  getActiveProjects,
  getPendingTasks,
  getRetryableTasks,
  advanceProjectStatus,
} from "./task-board.ts";

export interface ResumeResult {
  resumed: boolean;
  projectsChecked: number;
  tasksStillRunning: number;
  tasksNeedingRetry: number;
  tasksReadyForReview: number;
  actions: string[]; // human-readable actions taken
}

/**
 * Check the board for in-progress work and determine what needs attention.
 * Called on session_start to resume interrupted work.
 */
export function checkAndResume(board: TaskBoard): ResumeResult {
  const active = getActiveProjects(board);
  if (active.length === 0) {
    return {
      resumed: false,
      projectsChecked: 0,
      tasksStillRunning: 0,
      tasksNeedingRetry: 0,
      tasksReadyForReview: 0,
      actions: [],
    };
  }

  const actions: string[] = [];
  let tasksStillRunning = 0;
  let tasksNeedingRetry = 0;
  let tasksReadyForReview = 0;

  for (const project of active) {
    // Count dispatched/running tasks (subagents may still be working)
    const running = project.tasks.filter(
      (t) => t.status === "dispatched" || t.status === "running",
    );
    tasksStillRunning += running.length;

    if (running.length > 0) {
      actions.push(`项目 "${project.name}": ${running.length} 个子 agent 可能仍在运行`);
    }

    // Check for retryable failed tasks
    const retryable = getRetryableTasks(project);
    tasksNeedingRetry += retryable.length;

    if (retryable.length > 0) {
      actions.push(`项目 "${project.name}": ${retryable.length} 个任务失败，可重试`);
    }

    // Check for completed but not reviewed tasks
    const needReview = project.tasks.filter(
      (t) => t.status === "completed" && !t.reviewStatus,
    );
    tasksReadyForReview += needReview.length;

    if (needReview.length > 0) {
      actions.push(`项目 "${project.name}": ${needReview.length} 个任务待验收`);
    }

    // Check pending (never dispatched)
    const pending = getPendingTasks(project);
    if (pending.length > 0) {
      actions.push(`项目 "${project.name}": ${pending.length} 个任务未派工`);
    }

    advanceProjectStatus(project);
  }

  return {
    resumed: actions.length > 0,
    projectsChecked: active.length,
    tasksStillRunning,
    tasksNeedingRetry,
    tasksReadyForReview,
    actions,
  };
}

/**
 * Build a resume prompt for the agent.
 * Tells the agent what's pending from previous sessions.
 */
export function buildResumePrompt(resumeResult: ResumeResult): string | null {
  if (!resumeResult.resumed) return null;

  const lines = [
    "[OMA 断线恢复]",
    "检测到以下未完成工作：",
    ...resumeResult.actions.map((a) => `- ${a}`),
    "",
  ];

  if (resumeResult.tasksNeedingRetry > 0) {
    lines.push("建议：对失败的任务重新派工（调用 sessions_spawn）。");
  }
  if (resumeResult.tasksReadyForReview > 0) {
    lines.push(
      "建议：对已完成的任务调用 multi-agent-orchestrator action=validate_and_merge 验收。",
    );
  }
  if (resumeResult.tasksStillRunning > 0) {
    lines.push("建议：等待正在运行的子 agent 完成（sessions_yield）。");
  }

  return lines.join("\n");
}
