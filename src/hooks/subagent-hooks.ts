import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { logEvent } from "../audit-log.ts";
import { recordSpawn, recordCompletion } from "../spawn-tracker.ts";
import {
  getProject,
  updateTaskStatus,
  advanceProjectStatus,
} from "../task-board.ts";
import { processSubagentResult, isProjectReadyForReview } from "../result-collector.ts";
import { reviewProject, prepareRetries } from "../review-gate.ts";
import { generateProjectReport } from "../report-generator.ts";
import type { PluginState } from "../plugin-state.ts";
// M6: Message system
import { createAgentIdentity, sendMessage, MessageType } from "../message-manager.ts";

export function createSubagentHooks(
  state: PluginState,
  api: Pick<OpenClawPluginApi, "logger">,
  sharedRoot: string = "",
): {
  subagentSpawned: (event: Record<string, unknown>) => Promise<undefined>;
  subagentEnded: (event: Record<string, unknown>) => Promise<undefined>;
} {
  async function subagentSpawned(event: Record<string, unknown>): Promise<undefined> {
    const sessionKey = event.childSessionKey as string | undefined;
    const label = event.label as string | undefined;
    const agentId = event.agentId as string | undefined;

    logEvent(state.auditLog, "subagent_spawned", {
      sessionKey,
      agentId,
      label,
    });

    recordSpawn(state.spawnTracker, {
      sessionKey: sessionKey ?? `unknown-${Date.now()}`,
      agentId,
      label,
      task: event.task as string | undefined,
    });
    state.currentDelegationSpawnCount += 1;

    // M6: Create agent identity if this is a new agent
    if (sessionKey && agentId && !state.agentIdentity) {
      state.agentIdentity = createAgentIdentity({
        agentId: sessionKey,
        agentName: label ?? agentId,
        agentType: agentId,
        teamName: event.teamName as string | undefined,
        isLeader: event.isLeader as boolean | undefined,
      });
    }

    // Find a pending task matching by label or trackId and mark dispatched
    if (sessionKey) {
      for (const project of state.board.projects) {
        if (project.status === "done" || project.status === "failed") continue;
        const task =
          project.tasks.find(
            (t) => t.status === "pending" && (label ? t.label === label || t.trackId === label : false),
          ) ?? project.tasks.find((t) => t.status === "pending");
        if (task) {
          updateTaskStatus(task, "dispatched", { sessionKey });
          advanceProjectStatus(project);
          state.scheduleBoardSave();
          break;
        }
      }
    }

    return undefined;
  }

  async function subagentEnded(event: Record<string, unknown>): Promise<undefined> {
    const sessionKey = event.targetSessionKey as string | undefined;
    const outcome = event.outcome as string | undefined;

    logEvent(state.auditLog, "subagent_ended", { sessionKey, outcome });

    if (sessionKey) {
      const normalizedOutcome: "ok" | "error" | "timeout" | "killed" =
        outcome === "timeout" ? "timeout"
        : outcome === "killed" ? "killed"
        : outcome === "failed" || outcome === "error" ? "error"
        : "ok";
      recordCompletion(state.spawnTracker, { sessionKey, outcome: normalizedOutcome });
    }

    // E3: Update task board
    if (sessionKey) {
      const normalizedOutcome: "ok" | "error" | "timeout" | "killed" =
        outcome === "timeout" ? "timeout"
        : outcome === "killed" ? "killed"
        : outcome === "failed" || outcome === "error" ? "error"
        : "ok";

      const resultText = (event.resultText as string | undefined)
        ?? (event.output as string | undefined)
        ?? "";

      const result = processSubagentResult({
        board: state.board,
        sessionKey,
        outcome: normalizedOutcome,
        resultText,
      });

      if (result.updated) {
        api.logger.info(`[OMA] Task ${result.taskId} updated: ${outcome}`);

        // M6: Send task_completed message if we have identity and sharedRoot
        if (sharedRoot && state.agentIdentity && normalizedOutcome === "ok") {
          sendMessage(sharedRoot, {
            type: MessageType.task_completed,
            from: state.agentIdentity.agentId,
            to: null, // Broadcast to team
            content: `Task ${result.taskId} completed successfully`,
            metadata: {
              taskId: result.taskId,
              projectId: result.projectId,
              teamName: state.agentIdentity.teamName,
            },
          });
        }

        // E4: Auto-review when project is ready
        const project = getProject(state.board, result.projectId!);
        if (project && isProjectReadyForReview(project)) {
          const { reviews, needsRetry, allApproved } = reviewProject(project);

          api.logger.info(
            `[OMA] Project ${project.id} reviewed: ${reviews.filter((r) => r.approved).length} approved, ${needsRetry.length} need retry`,
          );

          if (needsRetry.length > 0) {
            prepareRetries(needsRetry);
            api.logger.info(`[OMA] ${needsRetry.length} tasks prepared for retry`);
          }

          if (allApproved) {
            project.status = "done";
            api.logger.info(`[OMA] Project ${project.id} DONE — all tasks approved`);
            // E6: Auto-log report when project completes
            const report = generateProjectReport(project);
            api.logger.info(`[OMA] Project report:\n${report}`);
          }

          advanceProjectStatus(project);
        }

        state.scheduleBoardSave();
      }
    }

    return undefined;
  }

  return { subagentSpawned, subagentEnded };
}
