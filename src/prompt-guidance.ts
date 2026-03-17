import type { ExecutionPolicyMode } from "./types.ts";
import type { Project } from "./task-board.ts";

export function buildOrchestratorPromptGuidance(mode: ExecutionPolicyMode): string {
  return [
    "When a task requires multi-agent research or other non-trivial execution,",
    "call multi-agent-orchestrator with action=enforce_execution_policy before deep execution.",
    `Current execution policy is ${mode}.`,
    "If the policy says task bus, plan, worker delegation, or tracked execution is required, do that first.",
    "When a task bus is required, it must be a canonical TASK-* directory with spec.md, plan.md, status.json, events.jsonl, handoff.md, and result.md; a single json file does not count.",
    "Before the first real worker/subagent/tracked execution starts, the orchestrator agent may only do task framing, task-bus creation, and step planning.",
    "Before first dispatch, do not perform substantive repo inspection, security analysis, code modification, deployment work, or final synthesis in the orchestrator agent itself.",
    "Do not announce step start or kickoff unless there is real execution evidence.",
    "Do not treat planned tracks as dispatched tracks; only a real worker/subagent spawn or tracked execution counts as dispatch evidence.",
    "Validation failure does not end the task when required tracks are still pending, worker evidence is missing, or the requested minimum result count has not been met.",
    "If a required track failed or returned too few validated results, the next action must be retry, narrower sourcing, or an additional worker dispatch unless there is a concrete blocker.",
    "Use the multi-agent-orchestrator tool to plan tracks before delegation and to validate/merge raw child outputs before the final answer.",
    "Only include validated items from the tool result in the final answer.",
    "Do not include HTML, 404 pages, tool logs, run metadata, or empty payload diagnostics.",
  ].join("\n");
}

export function buildDispatchGuidance(project: Project): string {
  const pendingTasks = project.tasks.filter((t) => t.status === "pending");
  if (pendingTasks.length === 0) return "";

  const lines = [
    `\n[OMA Dispatch Plan — ${project.name}]`,
    `你是编排者。以下 ${pendingTasks.length} 个任务需要派出子 agent 执行：`,
    "",
  ];

  for (const task of pendingTasks) {
    lines.push(`📌 ${task.label} (${task.id})`);
    if (task.agentType) lines.push(`   Agent: ${task.agentType}`);
    lines.push(`   调用 sessions_spawn，task 参数：`);
    lines.push(`   "${task.subagentPrompt?.slice(0, 200) ?? task.label}"`);
    lines.push("");
  }

  lines.push(
    "完成派工后，等待子 agent 返回（sessions_yield），然后调用 multi-agent-orchestrator action=validate_and_merge 验收。",
  );

  return lines.join("\n");
}
