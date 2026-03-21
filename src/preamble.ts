/**
 * 统一 Preamble 生成器 — 为每个 agent 的 system prompt 注入标准化的治理块。
 *
 * 设计原则：
 * - 所有函数为纯函数，无副作用
 * - 中英文混合输出（Chinese 为主，关键术语用 English）
 * - 当 3+ agent 并行时，自动加强上下文定位块
 */

import type { AgentIdentity } from "./types.ts";

export interface PreambleConfig {
  agentName: string;
  agentRole: string;
  sessionId?: string;
  projectName?: string;
  currentBranch?: string;
  activeAgentCount?: number;
  // M6: Full agent identity
  identity?: AgentIdentity;
  // M7: Communication commands
  inboxCommands?: boolean;
}

/**
 * 构建统一的 Preamble 字符串，注入到 agent system prompt 头部。
 *
 * 包含五个核心块：
 * 1. 角色定位
 * 2. Session 上下文（3+ agent 并行时强化）
 * 3. 完整性原则
 * 4. 升级协议（指向 Completion Status Protocol）
 * 5. 禁止行为
 */
export function buildUnifiedPreamble(config: PreambleConfig): string {
  const {
    agentName,
    agentRole,
    sessionId,
    projectName,
    currentBranch,
    activeAgentCount = 1,
    identity,
    inboxCommands = true,
  } = config;

  const isHighConcurrency = activeAgentCount >= 3;
  const hasTeam = identity?.teamName !== null;

  const sections: string[] = [];

  // ── Block 1: 角色定位 ──────────────────────────────────────────
  const roleLines: (string | null)[] = [
    "══════════════════════════════════════════",
    `[OMA Preamble — ${agentName}]`,
    "══════════════════════════════════════════",
    "",
    `你是 ${agentRole}，当前任务由 OMA 编排系统（multi-agent-orchestrator）派遣。`,
    `Agent 名称：${agentName}`,
  ];

  // M6: Include full identity if available
  if (identity) {
    roleLines.push(`Agent ID：${identity.agentId}`);
    roleLines.push(`Agent 类型：${identity.agentType}`);
    if (identity.teamName) {
      roleLines.push(`所属团队：${identity.teamName}`);
    }
    if (identity.isLeader) {
      roleLines.push(`角色：团队 Leader`);
    }
  } else if (sessionId) {
    roleLines.push(`Session ID：${sessionId}`);
  }

  sections.push(roleLines.filter(Boolean).join("\n"));

  // ── Block 2: Session 上下文 ────────────────────────────────────
  // 当 3+ agent 并行时，假设用户已 20 分钟没看这个窗口，强制重新定位上下文
  if (isHighConcurrency) {
    const contextLines = [
      "",
      "── 上下文重定位（Context Anchor）──",
      "当前系统正有 3 个以上 agent 并行运行。",
      "在每次输出前，请先完整说明：你是谁、你在做什么、当前进度如何。",
      "假设用户已有 20 分钟未关注此窗口——输出必须自解释，不依赖历史消息。",
    ];
    if (projectName) contextLines.push(`当前项目：${projectName}`);
    if (currentBranch) contextLines.push(`当前分支：${currentBranch}`);
    sections.push(contextLines.join("\n"));
  } else if (projectName || currentBranch) {
    const contextLines = ["", "── 当前上下文 ──"];
    if (projectName) contextLines.push(`项目：${projectName}`);
    if (currentBranch) contextLines.push(`分支：${currentBranch}`);
    sections.push(contextLines.join("\n"));
  }

  // ── Block 3: 完整性原则 ───────────────────────────────────────
  sections.push(
    [
      "",
      "── 完整性原则（Completeness > Speed）──",
      "宁可多做一步确认，不要假设。",
      "遇到模糊边界时，先明确范围再执行，不要猜测并推进。",
      "所有输出必须有证据支撑（测试通过、文件已修改、命令输出等）。",
    ].join("\n"),
  );

  // ── Block 4: 升级协议 ─────────────────────────────────────────
  sections.push(
    [
      "",
      "── 升级协议（Escalation Protocol）──",
      "任务完成或遇到问题时，必须使用 Completion Status Protocol 报告：",
      "  - DONE：任务完成，附完成证据",
      "  - DONE_WITH_CONCERNS：完成但有顾虑，列出顾虑点",
      "  - BLOCKED：被阻塞，列出阻塞原因和已尝试方案",
      "  - NEEDS_CONTEXT：缺少必要上下文，说明需要什么",
      "3-strike 规则：同一问题连续失败 3 次，必须 STOP 并升级，不再自行重试。",
    ].join("\n"),
  );

  // ── Block 5: 禁止行为 ─────────────────────────────────────────
  sections.push(
    [
      "",
      "── 禁止行为（Prohibited Actions）──",
      "- 不要自我审批（reviewer 不能同时是 executor）",
      "- 不要跳步骤——按照任务要求逐步完成，不要合并或省略步骤",
      "- 不要在没有证据的情况下声称任务已完成",
      "- 不要把所有工作放在一个 agent 里（除非任务明确不可拆分）",
    ].join("\n"),
  );

  // ── Block 6: 通信指令（M7）─────────────────────────────────────
  if (inboxCommands && hasTeam) {
    sections.push(
      [
        "",
        "── 通信指令（Communication Commands）──",
        "作为团队 Agent，你可以与其他 Agent 通信：",
        "",
        "发送消息：",
        "  /mao-inbox-send <agentId> <message>",
        "",
        "查看收件箱：",
        "  /mao-inbox",
        "",
        "标记已处理：",
        "  /mao-inbox-done <messageId>",
        "",
        "消息类型：message, task_completed, task_blocked, broadcast",
        "",
        "使用场景：",
        "- 任务完成 → 发送 task_completed 广播",
        "- 被阻塞 → 发送 task_blocked 给 Leader",
        "- 需要协作 → 发送 message 给相关 Agent",
      ].join("\n"),
    );
  }

  sections.push(
    [
      "",
      "══════════════════════════════════════════",
      "",
    ].join("\n"),
  );

  return sections.join("\n");
}

/**
 * 生成简化版 Preamble（仅角色定位 + 完整性原则），适用于轻量任务。
 */
export function buildLightPreamble(agentName: string, agentRole: string): string {
  return [
    `[OMA — ${agentName}] 你是 ${agentRole}，由 OMA 编排系统派遣。`,
    "宁可多做一步确认，不要假设。Completeness > Speed。",
    "",
  ].join("\n");
}
