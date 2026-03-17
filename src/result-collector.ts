import { updateTaskStatus, advanceProjectStatus, getProjectSummary } from "./task-board.ts";
import type { Project, Task, TaskBoard } from "./task-board.ts";
import { looksLikeNoiseLine } from "./noise-filter.ts";

/**
 * Process a subagent completion event.
 * Finds the matching task on the board and updates it.
 */
export function processSubagentResult(params: {
  board: TaskBoard;
  sessionKey: string;
  outcome: "ok" | "error" | "timeout" | "killed";
  resultText?: string;
}): { projectId?: string; taskId?: string; updated: boolean } {
  const { board, sessionKey, outcome, resultText } = params;

  for (const project of board.projects) {
    const task = project.tasks.find((t) => t.sessionKey === sessionKey);
    if (task) {
      if (outcome === "ok") {
        updateTaskStatus(task, "completed", { resultText });
      } else {
        updateTaskStatus(task, "failed", { failureReason: outcome });
      }
      advanceProjectStatus(project);
      return { projectId: project.id, taskId: task.id, updated: true };
    }
  }

  return { updated: false };
}

/**
 * Build result text from a subagent's raw output.
 * Strips noise, extracts meaningful content.
 */
export function extractResultFromMessages(messages: unknown[]): string {
  const textParts: string[] = [];

  for (const message of messages) {
    if (
      message === null ||
      typeof message !== "object" ||
      (message as Record<string, unknown>).role !== "assistant"
    ) {
      continue;
    }

    const content = (message as Record<string, unknown>).content;

    if (typeof content === "string") {
      textParts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block !== null &&
          typeof block === "object" &&
          (block as Record<string, unknown>).type === "text"
        ) {
          const text = (block as Record<string, unknown>).text;
          if (typeof text === "string") {
            textParts.push(text);
          }
        }
      }
    }
  }

  const raw = textParts.join("\n");

  // Apply noise filtering line by line
  const cleanLines = raw
    .split(/\r?\n/)
    .filter((line) => !looksLikeNoiseLine(line));

  return cleanLines.join("\n").trim();
}

/**
 * Check if all tasks in a project are terminal (completed/failed/approved/rejected).
 * If so, the project is ready for review.
 */
export function isProjectReadyForReview(project: Project): boolean {
  if (project.tasks.length === 0) {
    return false;
  }
  return project.tasks.every(
    (t) =>
      t.status === "completed" ||
      t.status === "failed" ||
      t.status === "approved" ||
      t.status === "rejected",
  );
}

/**
 * Generate a summary of task results for the project.
 */
export function summarizeProjectResults(project: Project): string {
  const summary = getProjectSummary(project);
  const lines: string[] = [
    `Project: ${project.name} (${project.status})`,
    `ID: ${project.id}`,
    `Tasks: ${summary.total} total | ${summary.completed} completed | ${summary.failed} failed | ${summary.approved} approved | ${summary.rejected} rejected`,
    "",
  ];

  for (const task of project.tasks) {
    const statusLabel = task.status.toUpperCase();
    let line = `  [${statusLabel}] ${task.label} (${task.trackId})`;
    if (task.retryCount > 0) {
      line += ` — retry ${task.retryCount}/${task.maxRetry}`;
    }
    if (task.failureReason) {
      line += ` — failure: ${task.failureReason}`;
    }
    if (task.reviewReason) {
      line += ` — review: ${task.reviewReason}`;
    }
    if (task.resultText) {
      const preview = task.resultText.slice(0, 100).replace(/\n/g, " ");
      line += `\n    Result: ${preview}${task.resultText.length > 100 ? "..." : ""}`;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

export type { Project, Task, TaskBoard };
