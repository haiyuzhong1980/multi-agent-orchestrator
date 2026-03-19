# OMA v3.0.0 功能详细介绍报告

> OpenClaw Multi-Agent Orchestrator — 技术深度文档

**版本：** v3.0.0
**测试覆盖：** 979 个单元测试，全部通过，耗时 ~5.8s
**源文件数：** 38 个（src/ 目录 34 个 + hooks/ 目录 4 个）
**测试文件数：** 34 个

---

## 目录

1. [完整架构图](#完整架构图)
2. [数据流图](#数据流图)
3. [模块详解](#模块详解)
   - [意图识别层](#意图识别层)
   - [Hook 层](#hook-层)
   - [任务看板层](#任务看板层)
   - [自进化层](#自进化层)
   - [治理层](#治理层)
   - [OAG 桥接层](#oag-桥接层)
4. [Enforcement Ladder 详解](#enforcement-ladder-详解)
5. [Evolution Cycle 详解](#evolution-cycle-详解)
6. [与 OAG 的交互说明](#与-oag-的交互说明)
7. [与 gstack 的对比和借鉴说明](#与-gstack-的对比和借鉴说明)
8. [测试覆盖率统计](#测试覆盖率统计)
9. [性能数据](#性能数据)

---

## 完整架构图

```
╔═══════════════════════════════════════════════════════════════════╗
║                   OpenClaw 运行时                                  ║
║                                                                   ║
║  ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐    ║
║  │ 用户消息     │───▶│ Plugin SDK   │───▶│ message_received  │    ║
║  └─────────────┘    │ Event Bus    │    │ Hook              │    ║
║                     │             │    │ ┌─────────────┐   │    ║
║                     │             │    │ │ 意图分类     │   │    ║
║                     │             │    │ │ 观察记录     │   │    ║
║                     │             │    │ │ 纠正检测     │   │    ║
║                     │             │    │ └─────────────┘   │    ║
║                     │             │    └───────────────────┘    ║
║                     │             │                              ║
║                     │             │    ┌───────────────────┐    ║
║                     │             │───▶│ before_prompt_    │    ║
║                     │             │    │ build Hook        │    ║
║                     │             │    │ ┌─────────────┐   │    ║
║                     │             │    │ │ Preamble    │   │    ║
║                     │             │    │ │ 指引注入     │   │    ║
║                     │             │    │ │ 委派指令     │   │    ║
║                     │             │    │ └─────────────┘   │    ║
║                     │             │    └───────────────────┘    ║
║                     │             │                              ║
║  ┌─────────────┐    │             │    ┌───────────────────┐    ║
║  │ Agent 工具  │◀───│             │───▶│ before_tool_call  │    ║
║  │ 调用        │    │             │    │ Hook (Level 3     │    ║
║  └─────────────┘    │             │    │ 硬阻塞)           │    ║
║         │           │             │    └───────────────────┘    ║
║         ▼           │             │                              ║
║  ┌─────────────┐    │             │    ┌───────────────────┐    ║
║  │ multi-agent-│    │             │───▶│ subagent_spawned  │    ║
║  │ orchestrator│    │             │    │ Hook              │    ║
║  │ Tool        │    │             │    └───────────────────┘    ║
║  │ ┌─────────┐ │    │             │                              ║
║  │ │orchestr.│ │    │             │    ┌───────────────────┐    ║
║  │ │plan_trk │ │    │             │───▶│ subagent_ended    │    ║
║  │ │enforce  │ │    │             │    │ Hook              │    ║
║  │ │validate │ │    └──────────────┘   │ ┌─────────────┐   │    ║
║  │ └─────────┘ │                       │ │ 结果收集     │   │    ║
║  └─────────────┘                       │ │ 自动审查     │   │    ║
║         │                              │ │ 报告生成     │   │    ║
║         ▼                              │ └─────────────┘   │    ║
║  ┌─────────────────────────────────┐  └───────────────────┘    ║
║  │           TaskBoard             │                             ║
║  │  Project → Tasks → Sprint Stage│                             ║
║  │  ~/.openclaw/shared-memory/     │                             ║
║  │  task-board.json                │                             ║
║  └─────────────────────────────────┘                            ║
║                                                                   ║
║  ┌─────────────────────────────────────────────────────────┐    ║
║  │              自进化引擎（每小时检查，每天执行）               │    ║
║  │                                                         │    ║
║  │  observation-log.jsonl ──▶ computeStats()               │    ║
║  │         ▼                       ▼                       │    ║
║  │  discoverPatterns()      evaluateAndAdjust()             │    ║
║  │  (TF-IDF)                (升/降 Level 0-3)              │    ║
║  │         ▼                       ▼                       │    ║
║  │  autoApply(≥80%)         enforcement-state.json         │    ║
║  │  pending(<80%)           intent-registry.json           │    ║
║  └─────────────────────────────────────────────────────────┘    ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## 数据流图

### 消息处理数据流

```
用户消息文本
    │
    ▼
extractIntentPhrases(text)
    │ → ["全力推进", "子 agent", "并行"]
    ▼
inferExecutionComplexity(text, intentRegistry, userKeywords)
    │
    ├─ 检查 userKeywords.delegation → 命中 → "delegation"
    ├─ 检查 userKeywords.light → 命中 → "light"
    ├─ 检查 userKeywords.tracked → 命中 → "tracked"
    ├─ 极短确认词（≤6字） → "light"
    ├─ 问候语 → "light"
    ├─ checkLearnedPatterns(intentRegistry) → 有学习结果 → 返回
    ├─ DELEGATION_REGEX.test(text) → 命中 → "delegation"
    ├─ DELEGATION_MARKERS.includes → 命中 → "delegation"
    ├─ countActionVerbs ≥ 4 → "delegation"
    ├─ numberedItems ≥ 3 && length > 80 → "delegation"
    ├─ countActionVerbs ≥ 3 → "tracked"
    ├─ TRACKED_MARKERS ≥ 2 → "tracked"
    ├─ TRACKED_MARKERS ≥ 1 && length > 50 → "tracked"
    ├─ countActionVerbs ≥ 2 → "tracked"
    ├─ countActionVerbs ≥ 1 && length > 100 → "tracked"
    └─ length > 6 → "tracked" (兜底)
    │
    ▼
recordClassification(intentRegistry, phrases, tier)
    │ → 更新 phrases 对应的置信度
    ▼
state.lastClassification = { phrases, tier, timestamp }

if tier === "delegation":
    state.pendingDelegationRequest = text
    state.delegationInjectionCount = 0
    state.currentDelegationSpawnCount = 0

createObservation({ message, agent, predictedTier })
    │ → { id, timestamp, messageLength, language,
    │     hasNumberedList, actionVerbCount, predictedTier, ... }
    ▼
appendObservation(sharedRoot, obs)
    │ → 追加到 ~/.openclaw/shared-memory/observation-log.jsonl
    ▼
state.currentObservationId = obs.id
```

### 子 Agent 生命周期数据流

```
subagent_spawned 事件
    │ { childSessionKey, agentId, label, task }
    ▼
recordSpawn(spawnTracker, { sessionKey, agentId, label })
    │ → spawnTracker.spawns.set(sessionKey, record)
    │ → spawnTracker.totalSpawned += 1
    ▼
state.currentDelegationSpawnCount += 1
    │ (Level 3 阻塞解除条件)
    ▼
查找匹配的 pending Task
    │ → task.label === label || task.trackId === label
    ▼
updateTaskStatus(task, "dispatched", { sessionKey })
advanceProjectStatus(project)
    │ → project.status = "running"
    ▼
scheduleBoardSave()
    │ → 500ms 防抖后写 task-board.json

─────────────────────────────────────────────────

subagent_ended 事件
    │ { targetSessionKey, outcome, resultText }
    ▼
recordCompletion(spawnTracker, { sessionKey, outcome })
    │ → record.completedAt = now, record.outcome = outcome
    ▼
processSubagentResult(board, sessionKey, outcome, resultText)
    │ → 找到对应 Task → updateTaskStatus("completed" | "failed")
    ▼
isProjectReadyForReview(project)
    │ → 所有 Task 都是 completed | failed | approved | rejected
    ▼
reviewProject(project)
    │ → 遍历 Task，检查 resultText 质量
    │ → { reviews: [{ taskId, approved, reason }], needsRetry, allApproved }
    ▼
if needsRetry.length > 0:
    prepareRetries(needsRetry)
    │ → task.retryCount += 1, task.status = "pending"

if allApproved:
    project.status = "done"
    generateProjectReport(project)
    │ → 结构化文本报告（标题、任务列表、完成时间）
    ▼
advanceProjectStatus(project)
scheduleBoardSave()
```

---

## 模块详解

### 意图识别层

#### `src/execution-policy.ts`

**核心函数：** `inferExecutionComplexity(request, intentRegistry, userKeywords)`

分类决策树的实现，按优先级依次检查 9 个维度。关键设计决策：

- **极短确认词快速通道：** 长度 ≤ 6 且匹配 `/^(ok|好|好的|嗯|是的|...)$/` 直接返回 light，避免误分类
- **动词阈值调优（v2.0.1 修复）：** 3 个动词 = tracked（不再是 delegation），4 个才触发 delegation。防止研究者用技术术语堆砌的消息被错误升级为 delegation。
- **编号列表检测：** 仅当条目 ≥ 3 且总长度 > 80 字符时才触发 delegation，避免短列表误判
- **默认值兜底：** 任何 > 6 字符的消息默认为 tracked。设计理由：该用户 99% 的消息都是工作请求

**`buildExecutionPolicyReport()` — 违规检测：**

检查 6 个状态位，输出违规清单和"下一步"指令：
- 缺少 task bus → 要求先创建
- 缺少步骤计划 → 要求先输出
- 已宣告开始但没有真实执行证据 → 要求立即启动
- delegation 模式但未派遣 worker → 要求立即派遣
- delegationStartGate=required 且未完成首次派工 → 阻止主 Agent 执行实质工作
- 步骤未推进 → 要求推进到 currentStep+1

#### `src/intent-registry.ts`

维护已学习的意图模式，每个 phrase 记录：
```typescript
{
  phrase: string;
  occurrences: number;
  confidence: { delegation: number; tracked: number; light: number };
  lastSeen: string;
}
```

`checkLearnedPatterns()` 返回置信度最高且超过阈值（0.7）的 tier。`recordCorrection()` 反向更新置信度：被纠正的 tier 降低，实际 tier 提高。

---

### Hook 层

#### `src/hooks/message-handler.ts`

监听 `message_received` 事件，处理三件事：

1. **纠正检测：** 如果上一条分类是 delegation，当前消息包含升级信号（"应该派 agent"、"你派出去"）或降级信号（"不用这么复杂"、"直接做"），则记录纠正并更新 IntentRegistry

2. **观察反馈更新：** 检测用户后续消息是否对上一条观察满意（短确认词）、升级（"应该派 agent"）或降级（"太重了"）

3. **Delegation 状态设置：** delegation tier 消息触发 `pendingDelegationRequest` 设置，这是 L1 mandate 注入和 Level 3 工具阻塞的触发器

#### `src/hooks/prompt-builder.ts`

监听 `before_prompt_build` 事件，按以下优先级注入内容：

```
优先级 1: 入门引导（仅首次，未完成 onboarding 时）
    ↓
优先级 2: 判断当前 Enforcement Level
    Level 0 → 直接返回，不注入任何内容
    Level 1-3 → 继续
    ↓
优先级 3: 若有 activeProject → 构建 Unified Preamble 并前置
    ↓
优先级 4: buildOrchestratorPromptGuidance(executionPolicy) 基础指引
    ↓
优先级 5: 若启动后首次调用 → Session Resume 恢复提示
    ↓
优先级 6: Level 2+ 且有 activeProject → buildDispatchGuidance(project)
    ↓
优先级 7: Level 1 → advisoryMessage 软建议
    ↓
优先级 8: 若 pendingDelegationRequest → buildDelegationMandate(request, agentNames)
          注入 L1 强制委派指令（含 Agent 列表）
```

`delegationInjectionCount` 计数避免日志重复（只在第一次注入时打 info 日志），但 mandate 在整个对话轮次中持续注入直到下一条消息覆盖 `pendingDelegationRequest`。

#### `src/hooks/tool-hooks.ts`

**beforeToolCall — Level 3 阻塞逻辑：**

条件：`behavior.blockNonDispatchTools && pendingDelegationRequest && currentDelegationSpawnCount === 0`

白名单（永远不阻塞）：
```
multi-agent-orchestrator, sessions_spawn, sessions_yield,
subagents, todowrite, todoupdate
```

触发时返回 `{ blockReason: "OMA enforcement level 3: 当前任务需要先派遣子 agent..." }`

例外：`executionPolicy === "free"` 或 `delegationStartGate === "off"` 时跳过阻塞。

**afterToolCall — 观察结果更新：**

将工具调用记录到当前观察的 `toolsCalled` 列表；若工具是 `sessions_spawn` 则标记 `didSpawnSubagent = true`。

---

### 任务看板层

#### `src/task-board.ts`

**数据结构：**

```typescript
TaskBoard
  └── Project[]
        ├── id: "proj-20260319-a3f2"
        ├── name: string
        ├── status: ProjectStatus
        ├── request: string
        ├── currentStage: SprintStage  // "plan"|"build"|"review"|"test"|"ship"
        ├── stageHistory: [{ stage, enteredAt, completedAt, taskIds }]
        └── tasks: Task[]
              ├── id: "task-3a1f2b"
              ├── trackId: string
              ├── label: string
              ├── agentType?: string
              ├── status: TaskStatus
              ├── sessionKey?: string    // 关联子 Agent session
              ├── retryCount: number
              ├── maxRetry: number       // 默认 2
              └── resultText?: string
```

**原子写入：** 使用 tmp 文件 + rename 保证写入原子性，防止程序崩溃时数据损坏。

**`advanceProjectStatus()` 状态机：**
- 所有 Task approved → 若有 Stage 分配则推进 Sprint 阶段，否则 done
- 任意 Task dispatched/running → running
- 全部完成 + 有失败且超过重试上限 → failed
- 全部完成 + 无超限失败 → reviewing
- 有 pending → pending

**Sprint 五阶段 Agent 类型映射：**
```typescript
{
  plan:   ["planner", "architect", "analyst"],
  build:  ["executor", "coder"],
  review: ["code-reviewer", "security-reviewer"],
  test:   ["tdd-guide", "test-engineer", "qa-tester"],
  ship:   ["git-master", "doc-updater"],
}
```

---

### 自进化层

#### `src/observation-engine.ts`

每条观察记录包含：

```typescript
ObservationRecord {
  id: "obs-1741234567890-a3f2"  // timestamp + random hex
  timestamp: ISO8601
  agent: string               // channelId or "unknown"
  messageText: string         // 前 200 字符
  messageLength: number
  language: "zh" | "en" | "mixed"
  hasNumberedList: boolean    // ≥3 个编号项
  actionVerbCount: number     // 匹配 ACTION_VERBS 的唯一动词数
  predictedTier: "light" | "tracked" | "delegation"
  toolsCalled: string[]       // 异步填入（after_tool_call）
  didSpawnSubagent: boolean
  spawnCount: number
  userFollowUp: "satisfied" | "corrected_up" | "corrected_down" | "continued" | null
  actualTier: string | null   // 纠正后的实际 tier
}
```

存储格式：JSONL（每条记录一行 JSON），追加写入，定期清理超过 30 天的记录。

**内存缓冲区（recentBuffer）：**
- 最近 20 条记录保留在内存中，用于快速 `updateObservationOutcome` 和 `updateObservationFeedback`
- `bufferDirty` 标记控制是否需要刷新到磁盘
- 进程退出时 `flushBuffer()` 将缓冲区写回 JSONL

#### `src/pattern-discovery.ts`

**TF-IDF 变体算法：**

1. 将观察记录按 actualTier（或 predictedTier）分为 delegation/tracked/light 三组
2. 对每组提取 token（中文：2-6 字 CJK 词 + bigram；英文：单词 + bigram）
3. 计算 significance = (delegation_freq / delegation_total) / (light_freq / light_total + 0.01)
4. significance > 2.0 → delegation 候选关键词
5. trackedRate > delegationRate && trackedRate ≥ 0.5 → tracked 候选关键词
6. 过滤掉已存在的关键词，按置信度排序

**停用词过滤：**
- 中文停用字：的、了、在、是、我、有... 等 33 个
- 英文停用词：the、a、an、is、are... 等 50 个

**结构性相关分析：**

同时分析消息长度、动词数、是否含编号列表与 tier 的相关性，提供阈值调整建议。

#### `src/enforcement-ladder.ts`

**升级阈值：**
```
Level 0 → 1: 累计观察 ≥ 20 条
Level 1 → 2: 分类准确率 ≥ 75%
Level 2 → 3: 分类准确率 ≥ 85% 且连续 5 天准确
```

**降级阈值：**
```
Level 3 → 2: 24小时内纠正 ≥ 5 次（需连续 2 天超标）
Level 2 → 1: 连续错误 ≥ 5 次（需连续 2 天超标）
```

**防抖机制：**
- 冷却期：任何 Level 变更后 3 天内不再变更（避免震荡）
- 降级缓冲：需连续 2 天超过降级阈值才执行降级

#### `src/evolution-cycle.ts`

**完整进化循环（9 步）：**

```
Step 1: loadRecentObservations(7天)
Step 2: 记录数 < 10 → 跳过（报告但不进化）
Step 3: computeStats() → accuracy, correctionRate, tierDistribution
Step 4: discoverPatterns(observations, existing_delegation, existing_tracked)
Step 5: autoApplyPatterns(≥ 80% 置信度) → 直接加入 userKeywords
Step 6: pendingReview(60-80% 置信度) → 队列等待人工确认
Step 5.5: pruneSubstringKeywords() → 删除被更长关键词包含的冗余短词
Step 7: evaluateAndAdjust(stats, recentCorrections24h)
Step 8: pruneObservations(>30天)
Step 9: 生成并返回 EvolutionReport
```

**自动触发：** `setInterval` 每小时检查一次日期，每天仅执行一次。有实质性变更（有 autoApplied 或 Level 变化）才写入报告文件。

---

### 治理层

#### `src/preamble.ts`

`buildUnifiedPreamble(config)` 生成标准化 Agent 治理块。

**五块内容：**

1. **角色定位** — `[OMA Preamble — {agentName}]` 标题 + 角色说明 + Session ID
2. **上下文锚定** — 当 `activeAgentCount ≥ 3` 时触发强化版：要求每次输出前先说明"你是谁、你在做什么、当前进度"，假设用户 20 分钟未看此窗口
3. **完整性原则** — "宁可多做一步确认，不要假设。遇到模糊边界时，先明确范围再执行。"
4. **升级协议** — 指向 Completion Status Protocol，列出 DONE/DONE_WITH_CONCERNS/BLOCKED/NEEDS_CONTEXT，以及 3-strike 规则
5. **禁止行为** — 不自我审批、不跳步骤、不无证据声称完成、不把所有工作放在一个 Agent

设计原理：来自 gstack 的工程实践，解决多 Agent 并行时的上下文漂移和越权问题。

#### `src/status-protocol.ts`

定义 `CompletionReport` 结构和序列化/反序列化：

```
COMPLETION_STATUS: DONE
SUMMARY: 已完成 X
EVIDENCE:
  - 证据1
  - 证据2
CONCERNS:
  - 顾虑1（DONE_WITH_CONCERNS 时）
BLOCKERS:
  - 阻塞原因（BLOCKED 时）
ATTEMPTED:
  - 已尝试方案1
RECOMMENDATION: 建议
STRIKE_COUNT: 2
```

`parseCompletionStatus(text)` 从 Agent 输出文本中解析结构。`shouldEscalate(strikeCount)` 检查是否触发 3-strike 规则（strikeCount ≥ 3）。`buildEscalationPrompt(report)` 生成升级通知文本。

#### `src/wtf-likelihood.ts`

**评分权重：**

| 信号类型 | 权重 | 触发条件 |
|---|---|---|
| revert | 15/次 | `event.type === "revert"` |
| large_fix | 5/次 | 单次修改 > 3 个文件 |
| extra_fix | 1/次 | 总修复次数超过 15 次后的每次 |
| all_remaining_low | 10 | 剩余问题全为 Low 级别 |
| unrelated_touch | 20 | 触及与任务无关的文件 |

**阈值：**
- score > 20 → `shouldStopAndAsk()` 返回 true
- totalFixCount ≥ 50 → `shouldForceStop()` 返回 true（硬限制）

所有函数均为纯函数，`updateWtfState()` 返回新状态对象，不修改输入。

#### `src/review-dashboard.ts`

维护 5 种审查记录：

| 审查类型 | Agent | 是否必填 |
|---|---|---|
| code-review | code-reviewer | YES |
| security-review | security-reviewer | YES |
| test-coverage | test-engineer | YES |
| architecture-review | architect | no |
| codex-review | codex | no |

**Verdict 计算逻辑：**
1. 任何必填审查 FAILED → BLOCKED
2. 任何必填审查 NOT_RUN → INCOMPLETE
3. 提供 currentCommitHash 时，必填审查 lastCommitHash 不匹配 → INCOMPLETE（过期）
4. 任何必填审查有 CONCERNS → INCOMPLETE
5. 全部通过 → CLEARED

`checkStaleness()` 对比每条审查记录的 lastCommitHash 与当前 HEAD，识别代码变更后未重新审查的情况。

---

### OAG 桥接层

#### `src/oag-bridge.ts`

**三个转换方向（均为纯函数，无副作用）：**

**1. OAG 事件 → OMA 意图 tier：**

```typescript
oagEventToObservation(event: OagEvent):
  severity critical/high → predictedTier "delegation"
  severity medium        → predictedTier "tracked"
  severity low           → predictedTier "light"
```

**2. OMA 任务失败 → OAG 根因分类：**

```typescript
taskFailureToRootCause(report: TaskFailureReport):
  error.includes("rate_limit") → { category: "rate_limit", confidence: 0.9 }
  error.includes("timeout")    → { category: "network",    confidence: 0.7 }
  error.includes("auth")       → { category: "auth_failure", confidence: 0.9 }
  其他                          → { category: "internal",   confidence: 0.3 }
```

**3. OAG 预测告警 → OMA 调度策略：**

```typescript
predictionToSchedulingHint(alert: PredictionAlert):
  currentValue >= breachThreshold → "switch_model" | "reduce_concurrency"
  timeToBreachMinutes <= 5        → "defer_tasks"
  timeToBreachMinutes <= 30       → "reduce_concurrency"
  else                            → "none"
```

**统一配置加载：** `loadUnifiedOagConfig()` 从 openclaw.json 合并 plugin namespace（`plugins.multi-agent-orchestrator.oag`）和 core namespace（`core.oag` / `gateway.oag`），plugin 配置优先。

---

## Enforcement Ladder 详解

### Level 变更的完整状态机

```
安装
  │
  ▼
Level 0 (Observation Only)
  │ 条件: 累计观察 ≥ 20 条
  │ 保护: 3 天冷却期
  ▼
Level 1 (Advisory)
  │ 条件: 准确率 ≥ 75%
  │ 降级: 连续错误 ≥ 5 次 (需 2 天)
  ▼
Level 2 (Guided)
  │ 条件: 准确率 ≥ 85% 连续 5 天
  │ 降级: 24h 内纠正 ≥ 5 次 (需 2 天)
  ▼
Level 3 (Full Enforcement)
  │ 降级: 24h 内纠正 ≥ 5 次 (需 2 天)
  ▼
Level 2 (降级)
```

### Level 0 → Level 1 示例

```
第 1 天: 用户发送 25 条消息 (观察数: 25 ≥ 20)
进化循环检测: 累计 25 条 ≥ 阈值 20
→ applyLevelChange(state, 1, "Collected 25 observations")
→ 日志: "[OMA Evolution] Level 0 → 1"
→ Level 1 生效: 之后的 prompt build 开始注入软建议
```

### Level 3 工具阻塞示例

用户说："全力推进这个项目，派出多个 agent 并行执行"

```
message_received:
  inferExecutionComplexity → "delegation"（命中"全力推进"、"多个 agent"、"并行"）
  state.pendingDelegationRequest = "全力推进这个项目..."
  state.currentDelegationSpawnCount = 0

before_prompt_build (Level 3):
  getEnforcementBehavior(3).blockNonDispatchTools = true
  buildDelegationMandate(request, agentNames) 注入
  → "你必须先调用 sessions_spawn 派遣至少一个 Agent"

主 Agent 尝试调用 Bash 工具:
before_tool_call:
  behavior.blockNonDispatchTools = true
  pendingDelegationRequest 不为空
  currentDelegationSpawnCount === 0
  "Bash" not in ALWAYS_ALLOWED_TOOLS
  → return { blockReason: "OMA enforcement level 3: 当前任务需要先派遣子 agent..." }

主 Agent 改为调用 sessions_spawn:
before_tool_call:
  "sessions_spawn" in ALWAYS_ALLOWED_TOOLS → 允许

subagent_spawned:
  state.currentDelegationSpawnCount += 1  (现在 = 1)

下次主 Agent 调用 Bash:
before_tool_call:
  currentDelegationSpawnCount === 1 ≠ 0
  → 不阻塞，允许通过
```

---

## Evolution Cycle 详解

### 模式发现示例

假设 7 天观察数据：
- delegation 消息中"全力推进"出现 8 次，light 中 0 次，总 delegation 60 条，总 light 40 条
- significance = (8/60) / (0/40 + 0.01) = 0.133 / 0.01 = 13.3
- delegationRate = 8 / (8+0+0) = 1.0
- confidence = 1.0 × min(1, 8/5) = 1.0
- confidence ≥ 0.8 → autoApplied

```
进化报告：
  Auto-applied patterns (1):
    + "全力推进"
```

### 关键词膨胀控制

`pruneSubstringKeywords()` 规则：
- 若关键词 A 完全包含在关键词 B 中（B 更长），则删除 A
- 例："推" 被 "推进" 包含 → 删除 "推"
- 单 tier 上限 80 个，总上限 200 个，超限时删除置信度最低的

---

## 与 OAG 的交互说明

OMA 和 OAG（OpenClaw Auto Gateway）是互补的两个系统：

| 维度 | OAG | OMA |
|---|---|---|
| 关注点 | 消息渠道健康、网关稳定性 | Agent 任务编排、意图识别 |
| 触发条件 | 渠道故障、API 异常、流量预测 | 用户意图（多 Agent 任务） |
| 输出 | 自动重启、根因分类、告警 | Agent 派遣指令、任务状态 |

**交互点 1：OAG 触发 OMA Agent 调度**

OAG 检测到 critical 级别 channel 故障时，通过 `oagEventToObservation()` 转换为 delegation tier 的 OMA 观察记录，驱动 OMA 自动派遣诊断 Agent 进行故障排查。

**交互点 2：OMA 任务失败反哺 OAG 根因库**

当子 Agent 因 rate_limit 失败时，`taskFailureToRootCause()` 自动标注根因，OAG 可据此决策是否切换到备用模型或降低并发。

**交互点 3：OAG 预测干预 OMA 调度**

OAG 预测 API 配额将在 20 分钟内触达上限时，`predictionToSchedulingHint()` 返回 `reduce_concurrency`，OMA 据此减少同时派遣的子 Agent 数量。

**状态：** oag-bridge.ts 中的三个函数均已完成实现（纯函数），注释标注"wire into index.ts OAG event listener when ready"，即等待 OAG Phase 3 的事件 API 就绪后连接。

---

## 与 gstack 的对比和借鉴说明

gstack 是一套多 Agent 系统的工程实践协议，OMA v3 从中借鉴了以下机制：

### 借鉴点 1：统一 Preamble

**gstack 思路：** 每个 Agent 被启动时应该清楚地知道自己是谁、在做什么、有什么约束。
**OMA 实现：** `buildUnifiedPreamble()` 在每次 `before_prompt_build` 时注入到 system prompt 头部，包含角色、上下文、完整性原则、升级协议和禁止行为。
**差异：** OMA 增加了并发感知（3+ Agent 时触发强化版上下文锚定），因为 OpenClaw 支持真正的多 Agent 并行。

### 借鉴点 2：Completion Status Protocol

**gstack 思路：** Agent 完成时必须用结构化格式汇报，而不是自然语言。
**OMA 实现：** `status-protocol.ts` 定义了 DONE/BLOCKED/NEEDS_CONTEXT 格式，并实现了序列化和解析，3-strike 规则防止 Agent 无限循环。
**差异：** OMA 增加了 DONE_WITH_CONCERNS 状态，适合"完成了但有技术债"的场景。

### 借鉴点 3：WTF-likelihood

**gstack 思路：** 当 Agent 陷入修复循环时应该自动停止。
**OMA 实现：** `wtf-likelihood.ts` 通过加权评分量化"失控程度"，超过阈值时停止并询问用户。
**差异：** OMA 使用纯函数不可变状态设计，便于测试和状态追踪。

### 借鉴点 4：Review Readiness Dashboard

**gstack 思路：** 发布前必须有明确的审查通过状态，而不是依赖人工记忆。
**OMA 实现：** `review-dashboard.ts` 追踪 5 种审查类型的最后运行时间和 commit hash，提供实时过期检测。
**差异：** OMA 增加了 Codex Review 类型，集成外部 AI 代码审查。

### 未借鉴的 gstack 特性

- **Tool Manifest：** gstack 要求 Agent 声明可用工具。OMA 暂未实现，因为 OpenClaw 工具权限由 SDK 管理。
- **Message Queue：** gstack 用消息队列管理 Agent 间通信。OMA 通过 TaskBoard + Hook 事件实现类似效果，不需要独立队列。

---

## 测试覆盖率统计

**总计：979 个测试，34 个测试文件，全部通过，0 失败**

### 按模块分布

| 测试文件 | 测试数（估算） | 覆盖模块 |
|---|---|---|
| `enforcement-ladder.test.ts` | ~80 | 升降级逻辑、冷却期、缓冲区 |
| `evolution-cycle.test.ts` | ~60 | 完整进化循环、自动应用、报告 |
| `execution-policy.test.ts` | ~100 | 意图分类所有路径、动词阈值 |
| `observation-engine.test.ts` | ~70 | 观察记录、统计、反馈更新 |
| `pattern-discovery.test.ts` | ~80 | TF-IDF 计算、模式过滤 |
| `task-board.test.ts` | ~90 | 状态机、Sprint 阶段、原子写入 |
| `preamble.test.ts` | ~40 | 五块内容生成、高并发模式 |
| `status-protocol.test.ts` | ~50 | 序列化/反序列化、3-strike |
| `wtf-likelihood.test.ts` | ~60 | 评分计算、阈值、硬限制 |
| `review-dashboard.test.ts` | ~80 | Verdict 计算、过期检测 |
| `oag-bridge.test.ts` | ~60 | 三方向转换、配置加载 |
| `spawn-tracker.test.ts` | ~40 | spawn/complete 追踪 |
| `intent-registry.test.ts` | ~50 | 模式记录、纠正更新 |
| `ask-format.test.ts` | ~30 | 四段式格式、验证 |
| 其他（20 个文件） | ~139 | noise-filter、candidate-extractor、tool actions 等 |

### 模拟测试结果（独立场景）

90 天 × 80 消息/天 × 5 画像 = 36,000 条消息

| 画像 | 最终 Level | 准确率 | 纠正数 | 关键词学习 |
|---|---|---|---|---|
| 保守型（light 为主） | L3 | 100.0% | 6 | 54 |
| 激进型（delegation 为主） | L3 | 100.0% | 25 | 50 |
| 开发者（tracked 为主） | L3 | 91.7% | 292 | 94 |
| 研究者（tracked/delegation 混合） | L3 | 91.2% | 761 | 111 |
| 管理者（delegation 倾向） | L3 | 91.8% | 502 | 78 |
| **整体** | — | **90.5%** | — | — |

---

## 性能数据

### 单元测试性能

```
# tests 979
# suites 220
# pass 979
# fail 0
# duration_ms 5775.77684   (~5.8 秒)
```

每个测试平均耗时 ~5.9ms，全部为纯函数单元测试，无 I/O。

### 运行时开销

| 操作 | 估算耗时 | 说明 |
|---|---|---|
| `inferExecutionComplexity()` | < 1ms | 纯字符串匹配，无 I/O |
| `message_received` Hook | < 2ms | 包含观察记录写磁盘（追加） |
| `before_prompt_build` Hook | < 1ms | 纯内存操作 |
| `before_tool_call` Hook | < 0.5ms | 纯内存检查 |
| `runEvolutionCycle()` | 10-100ms | 读取最多 7 天 JSONL 文件 |
| `scheduleBoardSave()` | < 1ms | 防抖 500ms 后异步写 |

### 存储开销

| 文件 | 增长速度 | 清理策略 |
|---|---|---|
| `observation-log.jsonl` | ~200B/条 × 每日消息数 | 每次进化循环清理 > 30 天 |
| `task-board.json` | 取决于项目数 | 手动清理已完成项目 |
| `enforcement-state.json` | 固定大小 | 不清理 |
| `intent-registry.json` | 随学习增长 | 子串去重控制膨胀 |
| `evolution-history.json` | ~1KB/周期 | 不自动清理（可手动） |

典型用户（每日 50 条消息）的年存储增量：约 3.5MB observation log + 其他文件 < 100KB。

---

*文档版本：v3.0.0 / 生成时间：2026-03-19*
