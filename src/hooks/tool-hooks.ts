import { existsSync } from "node:fs";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { logEvent } from "../audit-log.ts";
import { getEnforcementBehavior } from "../enforcement-ladder.ts";
import { ALWAYS_ALLOWED_TOOLS } from "../spawn-tracker.ts";
import { updateObservationOutcome } from "../observation-engine.ts";
import { checkPolicyBlock } from "../execution-policy.ts";
import type { ExecutionPolicyMode, DelegationStartGateMode } from "../types.ts";
import type { PluginState } from "../plugin-state.ts";

/** L2 soft block: allow first N non-dispatch tool calls with warning, then block */
const L2_SOFT_BLOCK_GRACE_CALLS = 1;

export function createToolHooks(
  state: PluginState,
  api: Pick<OpenClawPluginApi, "logger">,
  sharedRoot: string,
  options?: { executionPolicy?: string; delegationStartGate?: string },
): {
  beforeToolCall: (event: Record<string, unknown>) => Promise<{ blockReason: string } | undefined>;
  afterToolCall: (event: Record<string, unknown>) => Promise<undefined>;
} {
  const executionPolicy = options?.executionPolicy;
  const delegationStartGate = options?.delegationStartGate;

  async function beforeToolCall(event: Record<string, unknown>): Promise<{ blockReason: string } | undefined> {
    const blockReason = event.blockReason as string | undefined;
    if (blockReason) {
      logEvent(state.auditLog, "tool_blocked", { toolName: event.toolName, reason: blockReason });
    }

    const toolName = event.toolName as string | undefined;
    if (!toolName || ALWAYS_ALLOWED_TOOLS.has(toolName)) {
      return undefined;
    }

    const behavior = getEnforcementBehavior(state.enforcementState.currentLevel);

    // Skip all blocking if executionPolicy is "free" or delegationStartGate is "off"
    if (executionPolicy === "free" || delegationStartGate === "off") {
      return undefined;
    }

    // Execution policy blocking — check if tool call violates policy requirements
    if (state.lastClassification && executionPolicy && delegationStartGate) {
      const policyBlockReason = checkPolicyBlock(
        executionPolicy as ExecutionPolicyMode,
        delegationStartGate as DelegationStartGateMode,
        state.lastClassification.tier,
        {
          hasWorkerStart: state.currentDelegationSpawnCount > 0,
          hasTrackedExecution: state.currentDelegationSpawnCount > 0,
        },
      );
      if (policyBlockReason) {
        logEvent(state.auditLog, "tool_blocked_policy", { toolName, reason: "execution_policy_violation" });
        api.logger.info(`[OMA/Policy] Blocked ${toolName} — execution policy violation`);
        return { blockReason: policyBlockReason };
      }
    }

    // Only enforce enforcement-level blocking when delegation is pending
    if (state.pendingDelegationRequest) {

      // Level 3: hard block — no grace period
      if (behavior.blockNonDispatchTools && state.currentDelegationSpawnCount === 0) {
        logEvent(state.auditLog, "tool_blocked_l3", { toolName, reason: "delegation_required" });
        api.logger.info(`[OMA/L3] Blocked ${toolName} — delegation required, no agents spawned yet`);
        return {
          blockReason: `OMA enforcement level 3: 当前任务需要先派遣子 agent。请先调用 multi-agent-orchestrator action=orchestrate 创建任务，然后用 Agent tool 派遣子 agent。被拦截的工具: ${toolName}`,
        };
      }

      // Level 2: soft block — warn first call, block subsequent calls
      if (behavior.softBlockNonDispatchTools && state.currentDelegationSpawnCount === 0) {
        state.softBlockWarningCount++;
        if (state.softBlockWarningCount <= L2_SOFT_BLOCK_GRACE_CALLS) {
          // Grace period: allow but log warning
          logEvent(state.auditLog, "tool_warned_l2", { toolName, warningCount: state.softBlockWarningCount });
          api.logger.info(`[OMA/L2] Warning ${state.softBlockWarningCount}/${L2_SOFT_BLOCK_GRACE_CALLS}: ${toolName} called without delegation — next call will be blocked`);
        } else {
          // Grace exhausted: block
          logEvent(state.auditLog, "tool_blocked_l2", { toolName, reason: "soft_block_exhausted" });
          api.logger.info(`[OMA/L2] Blocked ${toolName} — delegation required, ${state.softBlockWarningCount} non-dispatch calls exceeded grace period`);
          return {
            blockReason: `OMA enforcement level 2: 你已经调用了 ${state.softBlockWarningCount} 次非派遣工具，但当前任务需要先派遣子 agent。请先调用 multi-agent-orchestrator action=orchestrate 创建任务，然后用 Agent tool 派遣子 agent。被拦截的工具: ${toolName}`,
          };
        }
      }
    }

    return undefined;
  }

  async function afterToolCall(event: Record<string, unknown>): Promise<undefined> {
    if (state.currentObservationId && existsSync(sharedRoot)) {
      const toolName = event.toolName as string | undefined;
      if (toolName) {
        updateObservationOutcome(sharedRoot, state.currentObservationId, {
          toolsCalled: [toolName],
          didSpawnSubagent: toolName === "sessions_spawn",
          spawnCount: toolName === "sessions_spawn" ? 1 : 0,
        });
      }
    }
    return undefined;
  }

  return { beforeToolCall, afterToolCall };
}
