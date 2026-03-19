# OpenClaw Multi-Agent Orchestrator (OMA) v3.0.0

> 自进化的多 Agent 编排系统 — 从意图识别到任务派遣到结果验收的全链路智能调度

面向 [OpenClaw](https://github.com/openclaw) 的确定性多 Agent 任务编排系统。OMA v3 在 v2 自进化引擎的基础上，引入了四级渐进式强制执行机制、统一 Preamble 治理层、WTF-likelihood 自我刹车、OAG 桥接层，以及完整的 gstack 行为协议吸收，形成从意图检测到任务派遣到结果验收的闭环。

> **命名说明：** 产品名为 **OpenClaw Multi-Agent Orchestrator (OMA)**。内部插件 ID 保持 `multi-agent-orchestrator` 以兼容现有配置。斜杠命令使用 `mao-` 前缀（如 `/mao-agents`、`/mao-board`）。

---

## 核心能力

### 1. 三级意图识别 (Execution Policy)

OMA 在每条用户消息到达时实时分类，判断执行路径。

**三个等级：**

| 等级 | 触发条件 | 典型场景 |
|---|---|---|
| `light` | 极短确认词（"好"、"ok"、"收到"）或问候语 | "好的"、"嗯" |
| `tracked` | 含任务动词 + 足够长度，或 2 个以上行动词 | "帮我配置一下 nginx"、"修复这个 bug" |
| `delegation` | 含多 Agent 关键词、4+ 行动词、3+ 条编号列表，或用户自定义委派关键词 | "全力推进这个项目，派出子 agent 并行执行" |

**分类逻辑（按优先级）：**
1. 用户自定义关键词（最高优先级，可覆盖所有内置规则）
2. 极短确认词快速通道 → light
3. 已学习的意图模式（IntentRegistry）
4. Regex 委派模式（如 `从M0推进到M4`、`释放.*力量`）
5. 静态委派标记词（30 个中文 + 英文关键词）
6. 复合行动词计数（4+ → delegation，3 → tracked，2 → tracked）
7. 编号列表结构（3+ 条且长度 > 80 字符 → delegation）
8. 长度兜底（> 6 字符 → tracked）

**5 种执行策略模式：**

| 模式 | 行为 |
|---|---|
| `free` | 最小约束，无结构性要求 |
| `guided` | 非平凡任务需要书面计划 |
| `tracked` | 需要 task-bus 和逐步汇报 |
| `delegation-first` | 需要 task-bus、步骤计划，复杂任务需要真实 worker 委派（**默认**） |
| `strict-orchestrated` | 最强模式，适用于长期运行的多 Agent 用户可见执行 |

**配置示例：**
```json
{
  "plugins": {
    "multi-agent-orchestrator": {
      "executionPolicy": "delegation-first",
      "delegationStartGate": "required"
    }
  }
}
```

---

### 2. 四级渐进式强制执行 (Enforcement Ladder)

OMA 通过观察用户行为，自动升降执行强度，从安静观察逐步提升到工具硬阻塞。

**四个等级：**

| 等级 | 名称 | 行为 | 升级条件 |
|---|---|---|---|
| **Level 0** | Observation Only | 静默，仅记录，不注入任何指引 | 累计 20 次观察 |
| **Level 1** | Advisory | 软性建议（"这个任务可能适合派遣子 Agent"），不阻塞 | 分类准确率 ≥ 75% |
| **Level 2** | Guided | 注入系统 prompt 编排指引 + 待处理任务调度计划 | 准确率 ≥ 85% 连续 5 天 |
| **Level 3** | Full Enforcement | Level 2 + **硬阻塞非调度工具**，直到至少派遣一个 Agent | 触发 5+ 纠正/24h → 降回 Level 2 |

**降级保护机制：**
- 3 天冷却期：任何级别变更后 3 天内不再变更
- 2 天降级缓冲：需要连续 2 天超过降级阈值才实际降级

**相关命令：**
```bash
/mao-level              # 查看当前 Level 及升降级进度
/mao-reset              # 重置到 Level 0
```

---

### 3. Sprint 流水线编排 (Task Board)

OMA 维护一个持久化任务看板，跨会话追踪每个项目的完整生命周期。

**Sprint 五阶段：**

```
plan → build → review → test → ship
```

每个阶段分配对应类型的 Agent：
- `plan`：planner、architect、analyst
- `build`：executor、coder
- `review`：code-reviewer、security-reviewer
- `test`：tdd-guide、test-engineer、qa-tester
- `ship`：git-master、doc-updater

**项目状态流：**

```
pending → planning → dispatching → running → reviewing → done
                                                        ↓
                                                      failed (retry 后仍失败)
```

**4 个核心工具动作：**

| 动作 | 用途 |
|---|---|
| `plan_tracks` | 将请求分解为类型化的研究 track，每个 track 配子 Agent prompt 模板 |
| `enforce_execution_policy` | 检查是否需要创建 task-bus、生成计划、派遣 worker 或推进下一步 |
| `validate_and_merge` | 接收子 Agent 原始输出，过滤噪音，提取 GitHub 链接项，去重，输出结构化报告 |
| `orchestrate` | 一站式：规划 → 创建项目 → 持久化 → 返回调度指引 |

**相关命令：**
```bash
/mao-board              # 查看所有项目和任务
/mao-project <id>       # 查看特定项目详情
/mao-review             # 审查当前活跃项目结果
/mao-resume             # 检测中断的工作并恢复
/mao-report [id]        # 生成项目完成报告
```

---

### 4. 自我进化引擎 (Evolution Engine, EV1–EV6)

OMA 从每次交互中学习，持续优化意图检测和 Agent 编排能力。

**进化周期（每 24 小时自动触发）：**

1. 加载最近 7 天的观察记录
2. 计算分类准确率和纠正率
3. 运行模式发现（TF-IDF 算法）
4. 自动应用高置信度模式（≥ 80%）
5. 队列中等置信度模式（60%–80%，待人工确认）
6. 评估并自动升降 Enforcement Level
7. 清理超过 30 天的旧观察记录

**模式发现算法：**

基于 TF-IDF 变体，计算每个词汇在 delegation 消息 vs light 消息中的显著性：

```
significance = (freq_in_delegation / total_delegation) / (freq_in_light / total_light + 0.01)
```

significance > 2.0 且置信度 ≥ 60% 的词汇被识别为新委派关键词候选。

**相关命令：**
```bash
/mao-observations       # 查看观察统计（准确率、纠正率、分布）
/mao-discover           # 手动运行模式发现
/mao-learned            # 查看学习到的意图模式（2+ 次出现）
/mao-evolve             # 手动触发一次进化循环
/mao-evolution-history  # 查看最近 5 次进化报告
/mao-export             # 导出模式供团队共享
/mao-import <file>      # 导入共享模式
/mao-keyword <tier> <phrase>  # 添加自定义关键词
```

---

### 5. OAG 桥接层 (OAG Bridge)

OMA 与 OpenClaw 自治网关（OAG）双向集成，实现故障驱动的 Agent 调度。

**三个集成方向：**

1. **OAG 事件 → OMA 观察：** OAG 检测到 channel 故障时，自动转换为 OMA 的意图 tier（critical/high → delegation，medium → tracked，low → light），触发对应强度的 Agent 调度。

2. **OMA 任务失败 → OAG 根因分类：** OMA 的任务失败报告自动映射到 OAG 根因类别（rate_limit、network、auth_failure、internal），帮助 OAG 决策是否需要切换模型或降低并发。

3. **OAG 预测告警 → OMA 调度提示：** OAG 提前预测资源瓶颈时，OMA 根据距离触发阈值的时间自动调整调度策略：
   - 已超阈值 → 立即切换模型或降低并发
   - 5 分钟内 → 推迟非关键任务
   - 30 分钟内 → 主动降低并发
   - > 30 分钟 → 无需操作

---

### 6. 治理层（借鉴 gstack）

v3 引入了完整的 Agent 治理协议，确保多 Agent 并行执行时的可观测性和可控性。

#### 6.1 统一 Preamble（Unified Preamble）

每个被 OMA 派遣的 Agent 在 system prompt 头部注入标准化治理块，包含五个部分：

| 块 | 内容 |
|---|---|
| 角色定位 | Agent 名称、角色、Session ID |
| 上下文锚定 | 3+ Agent 并行时强制重定位（假设用户 20 分钟未看此窗口） |
| 完整性原则 | "宁可多做一步确认，不要假设。Completeness > Speed。" |
| 升级协议 | 指向 Completion Status Protocol（DONE / BLOCKED / NEEDS_CONTEXT） |
| 禁止行为 | 不自我审批、不跳步骤、不无证据声称完成 |

#### 6.2 Completion Status Protocol

每个 Agent 完成任务时必须输出标准格式报告：

```
COMPLETION_STATUS: DONE
SUMMARY: 已完成 nginx 配置，端口 443 已监听
EVIDENCE:
  - nginx -t 返回 OK
  - curl https://example.com 返回 200
```

四种状态：
- `DONE`：完成，附证据
- `DONE_WITH_CONCERNS`：完成但有顾虑
- `BLOCKED`：被阻塞，列出原因和已尝试方案
- `NEEDS_CONTEXT`：缺少上下文

**3-strike 规则：** 同一问题连续失败 3 次必须 STOP 并升级，不再自行重试。

#### 6.3 AskUserQuestion 治理（Ask Format）

向用户提问时必须使用四段式格式，避免无结构的开放性提问：

```
[项目: OMA | 分支: main | 当前任务: 配置 nginx]

请确认部署方式：

推荐: 选项 [A]

选项:
  A. Docker 部署 (人工: ~30min / AI: ~5min) ← 推荐
     使用 docker-compose，隔离性好，易于回滚
     完整性: 9/10
  B. 直接部署 (人工: ~15min / AI: ~3min)
     直接修改系统配置，不依赖 Docker
     完整性: 7/10
```

#### 6.4 WTF-likelihood 自我刹车

监控 Agent 执行过程中的"失控信号"，当分数超过 20 时自动停止并询问用户：

| 信号 | 权重 | 说明 |
|---|---|---|
| 回退（revert） | 15/次 | 代码被回退说明方向有问题 |
| 大范围修复（>3 文件） | 5/次 | 范围扩大是危险信号 |
| 额外修复（超过 15 次后） | 1/次 | 修复过多说明根因未解决 |
| 触及无关文件 | 20 | 越界操作 |
| 仅剩 Low 级问题 | 10 | 可能在打磨无关紧要的细节 |

硬限制：累计修复 50 次强制停止，要求人工接管。

#### 6.5 Review Readiness Dashboard

发布前（/ship）必须通过的审查看板，以 ASCII 表格呈现：

```
+=========================================================================+
|               REVIEW READINESS DASHBOARD                                |
+=========================================================================+
| Review            | Runs | Last Run            | Status    | Required  |
|-------------------|------|---------------------|-----------|-----------|
| Code Review       |    2 | 2026-03-19 14:30    | CLEAR     | YES       |
| Security Review   |    1 | 2026-03-19 14:35    | CLEAR     | YES       |
| Test Coverage     |    3 | 2026-03-19 14:40    | CLEAR     | YES       |
| Architecture Rev  |    0 | --                  | NOT_RUN   | no        |
| Codex Review      |    0 | --                  | NOT_RUN   | no        |
+-------------------------------------------------------------------------+
| VERDICT: CLEARED — All required reviews passed                          |
+=========================================================================+
```

三种 verdict：
- `CLEARED`：所有必填审查通过
- `INCOMPLETE`：有必填审查未运行或已过期
- `BLOCKED`：有必填审查失败

---

## 架构图

```
用户消息
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              message_received Hook                  │
│  inferExecutionComplexity()                         │
│    ├─ 用户自定义关键词（最高优先级）                     │
│    ├─ 已学习模式（IntentRegistry）                    │
│    ├─ Regex 委派模式（10 个）                         │
│    ├─ 静态委派标记词（30 个）                          │
│    └─ 复合行动词 / 编号列表 / 长度兜底                  │
│  → 分类为 light / tracked / delegation               │
│  → 记录 ObservationRecord（JSONL）                   │
│  → 若 delegation → state.pendingDelegationRequest   │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              before_prompt_build Hook               │
│  getEnforcementBehavior(level)                      │
│    ├─ Level 0: 不注入任何内容                         │
│    ├─ Level 1: 注入软性建议                           │
│    ├─ Level 2: 注入编排指引 + 调度计划                 │
│    └─ Level 3: Level 2 + 注入强制委派指令              │
│  若有 activeProject → 注入 Unified Preamble           │
│  若启动后首次调用 → 注入 Session Resume               │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              before_tool_call Hook (Level 3)        │
│  若 pendingDelegationRequest 且 currentDelegationSpawnCount == 0:  │
│    → 阻塞非 ALWAYS_ALLOWED_TOOLS 工具               │
│    → 返回 blockReason: "请先派遣子 Agent"             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│          multi-agent-orchestrator Tool              │
│  orchestrate → 创建 Project + Tasks → TaskBoard     │
│  plan_tracks → 分解请求为 Track 列表                 │
│  enforce_execution_policy → 策略合规检查             │
│  validate_and_merge → 合并子 Agent 结果             │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              subagent_spawned Hook                  │
│  recordSpawn(spawnTracker)                          │
│  state.currentDelegationSpawnCount += 1             │
│  找到对应 Task → updateTaskStatus("dispatched")     │
│  advanceProjectStatus()                             │
└─────────────────────────────────────────────────────┘
    │
    ▼
[ 子 Agent 执行中... ]
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              subagent_ended Hook                    │
│  recordCompletion(spawnTracker)                     │
│  processSubagentResult() → 更新 Task 状态            │
│  isProjectReadyForReview() → reviewProject()        │
│    ├─ 需要重试 → prepareRetries()                   │
│    └─ 全部通过 → project.status = "done"            │
│                 → generateProjectReport()            │
└─────────────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────────────┐
│              每日进化循环（每小时检查，每天执行）          │
│  runEvolutionCycle()                                │
│    ├─ loadRecentObservations(7d)                    │
│    ├─ computeStats() → accuracy, correctionRate     │
│    ├─ discoverPatterns() → TF-IDF 新关键词           │
│    ├─ autoApplyPatterns(≥80% 置信度)                │
│    ├─ evaluateAndAdjust() → 升降 Enforcement Level  │
│    └─ pruneObservations(>30d)                       │
└─────────────────────────────────────────────────────┘
```

---

## 模块清单（38 个源文件）

### 核心引擎

| 文件 | 功能 |
|---|---|
| `index.ts` | 插件入口：注册工具、Hooks、20+ 命令、CLI |
| `src/tool.ts` | 工具 execute() 分发器（4 个动作） |
| `src/schema.ts` | 工具 JSON Schema 定义 |
| `src/types.ts` | 共享 TypeScript 类型定义 |
| `src/constants.ts` | 共享常量（ACTION_VERBS、停用词、信号正则） |
| `src/plugin-state.ts` | 插件状态容器（聚合所有子系统状态） |

### 意图识别层

| 文件 | 功能 |
|---|---|
| `src/execution-policy.ts` | 三级意图分类（light/tracked/delegation）+ 5 模式策略引擎 |
| `src/intent-registry.ts` | 意图模式注册表（内置 + 学习 + 用户自定义） |
| `src/user-keywords.ts` | 用户自定义关键词管理（三个 tier） |

### Hook 层

| 文件 | 功能 |
|---|---|
| `src/hooks/message-handler.ts` | message_received：意图分类、观察记录、纠正检测 |
| `src/hooks/prompt-builder.ts` | before_prompt_build：Preamble + 指引 + 强制指令注入 |
| `src/hooks/tool-hooks.ts` | before/after_tool_call：Level 3 工具硬阻塞 |
| `src/hooks/subagent-hooks.ts` | subagent_spawned/ended：任务状态更新、自动审查 |

### 任务看板层（E1–E6）

| 文件 | 功能 |
|---|---|
| `src/task-board.ts` | Project/Task 数据模型、Sprint 五阶段、原子 JSON 持久化 |
| `src/result-collector.ts` | 子 Agent 结果处理（E3） |
| `src/review-gate.ts` | 自动审查、通过/拒绝、重试准备（E4） |
| `src/session-resume.ts` | 启动时中断检测和恢复（E5） |
| `src/report-generator.ts` | 项目完成报告生成（E6） |
| `src/session-state.ts` | Session 级别的编排状态追踪 |
| `src/spawn-tracker.ts` | 子 Agent 生命周期追踪（spawn/complete） |
| `src/audit-log.ts` | 会话级审计日志（最多 200 条） |

### 自进化层（EV1–EV6）

| 文件 | 功能 |
|---|---|
| `src/observation-engine.ts` | 行为观测：每条消息的特征提取和记录（JSONL） |
| `src/pattern-discovery.ts` | TF-IDF 模式发现：从观察中挖掘新关键词 |
| `src/enforcement-ladder.ts` | 四级渐进式强制：自动升降级逻辑 |
| `src/evolution-cycle.ts` | 每日进化循环：分析→发现→应用→调整 |
| `src/onboarding.ts` | 首次运行问卷：初始化偏好和关键词 |
| `src/pattern-export.ts` | 模式导出/导入（团队共享） |

### 治理层（v3 新增）

| 文件 | 功能 |
|---|---|
| `src/preamble.ts` | 统一 Preamble 生成器（五块治理协议） |
| `src/status-protocol.ts` | Completion Status Protocol（DONE/BLOCKED/NEEDS_CONTEXT） |
| `src/ask-format.ts` | AskUserQuestion 四段式格式治理 |
| `src/wtf-likelihood.ts` | WTF-likelihood 自我刹车（权重评分 + 硬限制） |
| `src/review-dashboard.ts` | Review Readiness Dashboard（发布前门禁） |
| `src/oag-bridge.ts` | OAG 双向桥接层（事件转换 + 调度提示） |

### 研究与报告层

| 文件 | 功能 |
|---|---|
| `src/track-planner.ts` | Track 规划、窗口推断、子 Agent prompt 生成 |
| `src/track-templates.ts` | 10 个内置 Track 模板 |
| `src/report-builder.ts` | 5 段式结构化报告组装 |
| `src/noise-filter.ts` | 噪音过滤（14 个脏标记 + 7 个工具日志标记） |
| `src/candidate-extractor.ts` | GitHub 链接项提取 |
| `src/agent-registry.ts` | 144 个 Agent 注册表加载和搜索 |
| `src/prompt-guidance.ts` | 系统 prompt 指引构建 |
| `src/ofms-bridge.ts` | OFMS 共享记忆读写 |
| `src/url-utils.ts` | URL 分类工具 |

---

## 配置参数

在 `openclaw.plugin.json` 中设置：

```json
{
  "id": "multi-agent-orchestrator",
  "plugins": {
    "multi-agent-orchestrator": {
      "enabledPromptGuidance": true,
      "maxItemsPerTrack": 8,
      "executionPolicy": "delegation-first",
      "delegationStartGate": "required"
    }
  }
}
```

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `enabledPromptGuidance` | boolean | `true` | 是否在 system prompt 注入编排指引 |
| `maxItemsPerTrack` | integer 1–20 | `8` | 去重后每 track 最大保留项数 |
| `executionPolicy` | enum | `delegation-first` | 执行策略模式（见上表） |
| `delegationStartGate` | enum | `required` | 委派门禁（off / advisory / required） |

**环境变量：**

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OFMS_SHARED_ROOT` | `~/.openclaw/shared-memory` | OFMS 共享记忆根路径 |
| `AGENCY_AGENTS_PATH` | `~/Documents/agency-agents-backup` | Agency Agents 库路径（144 个 Agent） |

---

## 安装与使用

```bash
# 安装
cd ~/.openclaw/extensions
git clone https://github.com/haiyuzhong1980/openclaw-multi-agent-orchestrator
cd openclaw-multi-agent-orchestrator
npm install

# 在 openclaw.config.json 中注册
{
  "extensions": ["~/.openclaw/extensions/openclaw-multi-agent-orchestrator"]
}
```

**首次使用（入门引导）：**

安装后首次发送消息时，OMA 自动展示入门问卷，根据你的工作类型和偏好初始化 Enforcement Level 和自定义关键词。如需重新引导：

```bash
/mao-setup
```

**基本使用流程：**

1. 发送需要多 Agent 的任务（如"全力推进这个项目"）
2. OMA 检测到 delegation tier，在下一次 prompt 构建时注入强制委派指令
3. Level 3 下，主 Agent 在未派遣子 Agent 前调用其他工具将被阻塞
4. 主 Agent 调用 `multi-agent-orchestrator action=orchestrate` 创建项目和任务
5. 子 Agent 被派遣，OMA 自动追踪执行状态
6. 所有子 Agent 完成后，OMA 自动审查结果，标记通过/失败
7. 使用 `/mao-board` 查看项目状态，`/mao-report` 获取完整报告

---

## 测试

```bash
# 运行所有测试（979 个）
npm test

# 运行确定性自测（不需要真实 API）
/maotest

# CLI 自测
openclaw mao-selftest

# 30 天模拟（验证自进化引擎）
./tests/simulation/run.sh

# 90 天压测
./tests/simulation/run.sh --days 90 --messages 80
```

**测试覆盖（v3.0.0）：**
- 979 个单元测试，全部通过
- 34 个测试文件，覆盖所有核心模块
- 模拟测试：5 种用户画像 × 90 天 × 80 消息 = 36,000 条，整体准确率 90.5%

---

## 版本历史

### v3.0.0 — gstack 治理层吸收

**新增功能：**
- **统一 Preamble（preamble.ts）** — 标准化 Agent 治理块，支持 3+ Agent 并行时的上下文重定位
- **Completion Status Protocol（status-protocol.ts）** — 结构化任务完成报告，含 3-strike 升级规则
- **AskUserQuestion 治理（ask-format.ts）** — 四段式提问格式（Re-ground + 问题 + 推荐 + 选项+完整性评分）
- **WTF-likelihood 自我刹车（wtf-likelihood.ts）** — 失控检测评分系统，阈值 20 停止询问，50 强制停止
- **Review Readiness Dashboard（review-dashboard.ts）** — 发布前 ASCII 看板（code/security/test/architecture/codex）
- **OAG 桥接层（oag-bridge.ts）** — OAG 事件↔OMA 观察双向转换，故障驱动 Agent 调度
- **L1 强制委派指令注入** — delegation tier 消息自动触发 Preamble + mandate 注入
- **Level 3 工具硬阻塞** — 强制先派遣 Agent 的执行门禁（tool-hooks.ts）
- **子 Agent 生命周期追踪（spawn-tracker.ts）** — 精确的 spawn/complete 计数，替代自报告 flag

**架构重构：**
- 将 Hook 逻辑拆分为独立文件（message-handler / prompt-builder / tool-hooks / subagent-hooks）
- 提取共享常量到 constants.ts（消除 ACTION_VERBS、停用词的重复定义）
- 插件状态统一通过 plugin-state.ts 管理

### v2.0.1 — 模拟测试 & 自进化修复

- 新增模拟测试框架（15 画像、90 天场景）
- 修复 Level 震荡（3 天冷却期 + 2 天降级缓冲）
- 修复关键词膨胀（单 tier 上限 80 + 子串去重）
- 修复研究者误分类（复合动词阈值 3→4）
- 732 测试通过

### v2.0.0 — 自进化意图检测

- 观察引擎、模式发现（TF-IDF）、强制梯度、每日进化循环
- 入门引导、用户关键词、模式导出/导入
- 700 测试通过

### v1.x — 任务看板 & 执行引擎

- M0–M4：工具骨架、噪音过滤、5 段报告、Agent 注册表、OFMS 集成
- E1–E6：任务看板、调度指引、结果收集、审查门禁、会话恢复、报告生成

---

## 许可证

MIT

## 作者

[haiyuzhong1980](https://github.com/haiyuzhong1980)
