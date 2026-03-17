import { classifyTrack, classifyTextTrack } from "./candidate-extractor.ts";
import { updateTaskStatus, advanceProjectStatus } from "./task-board.ts";
import type { Project, Task, TaskBoard } from "./task-board.ts";
import type { TrackInput } from "./types.ts";

export interface ReviewResult {
  taskId: string;
  approved: boolean;
  status: "ok" | "partial" | "failed";
  reason: string;
  keptItems: number;
}

/**
 * Review a single task's result against quality standards.
 */
export function reviewTask(task: Task): ReviewResult {
  const trackInput: TrackInput = {
    trackId: task.trackId,
    resultText: task.resultText ?? "",
    contentType: task.contentType as TrackInput["contentType"],
  };

  const classified = classifyTrack(trackInput, 20);
  const approved = classified.status === "ok" || classified.status === "partial";

  return {
    taskId: task.id,
    approved,
    status: classified.status,
    reason: classified.summaryLine,
    keptItems: classified.items.length,
  };
}

/**
 * Review all completed tasks in a project.
 * Updates task review statuses on the board.
 * Returns tasks that need retry.
 */
export function reviewProject(project: Project): {
  reviews: ReviewResult[];
  needsRetry: Task[];
  allApproved: boolean;
} {
  const reviews: ReviewResult[] = [];

  for (const task of project.tasks) {
    if (task.status !== "completed") {
      continue;
    }

    const review = reviewTask(task);

    if (review.approved) {
      updateTaskStatus(task, "approved", {
        reviewStatus: "approved",
        reviewReason: review.reason,
      });
    } else {
      updateTaskStatus(task, "rejected", {
        reviewStatus: "rejected",
        reviewReason: review.reason,
      });
    }

    reviews.push(review);
  }

  advanceProjectStatus(project);

  // Collect rejected tasks eligible for retry (rejected status, retryCount < maxRetry)
  const needsRetry = project.tasks.filter(
    (t) => t.status === "rejected" && t.retryCount < t.maxRetry,
  );

  const allApproved =
    project.tasks.length > 0 &&
    project.tasks.every((t) => t.status === "approved");

  return { reviews, needsRetry, allApproved };
}

/**
 * Build a retry prompt for a failed task.
 * Includes the failure reason and asks for a different approach.
 */
export function buildRetryPrompt(task: Task): string {
  const base = task.subagentPrompt ?? "";
  const reason = task.failureReason ?? task.reviewReason ?? "未知原因";
  return `${base}\n\n上次执行失败/结果不合格。原因: ${reason}。请换一个角度或缩小范围重试。`;
}

/**
 * Prepare retry tasks: increment retryCount, reset status, build new prompt.
 */
export function prepareRetries(tasks: Task[]): Task[] {
  for (const task of tasks) {
    task.retryCount += 1;
    task.status = "pending";
    task.resultText = undefined;
    task.resultSummary = undefined;
    task.subagentPrompt = buildRetryPrompt(task);
  }
  return tasks;
}

export type { Project, Task, TaskBoard };
