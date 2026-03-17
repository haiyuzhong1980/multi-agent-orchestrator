import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  inferExecutionComplexity,
  shouldRequireTaskBus,
  shouldRequireDelegation,
  buildExecutionPolicyReport,
} from "../src/execution-policy.ts";

describe("inferExecutionComplexity", () => {
  it('returns delegation for Chinese "真实执行一个多 agent 调研"', () => {
    assert.equal(inferExecutionComplexity("真实执行一个多 agent 调研"), "delegation");
  });

  it('returns light for short Chinese "按步骤部署" (< 15 chars)', () => {
    assert.equal(inferExecutionComplexity("按步骤部署"), "light");
  });

  it('returns light for Chinese "查一下"', () => {
    assert.equal(inferExecutionComplexity("查一下"), "light");
  });

  it('returns tracked for English "deploy step by step with multiple agents" (2 markers: deploy + step by step)', () => {
    assert.equal(inferExecutionComplexity("deploy step by step with multiple agents"), "tracked");
  });

  it('returns light for English "audit the security" (1 marker, < 50 chars)', () => {
    assert.equal(inferExecutionComplexity("audit the security"), "light");
  });

  it('returns light for English "hello"', () => {
    assert.equal(inferExecutionComplexity("hello"), "light");
  });

  it('returns delegation for mixed "multi agent 调研任务" (>= 15 chars)', () => {
    assert.equal(inferExecutionComplexity("multi agent 调研任务"), "delegation");
  });

  it("returns light for empty string", () => {
    assert.equal(inferExecutionComplexity(""), "light");
  });

  it("returns light for undefined", () => {
    assert.equal(inferExecutionComplexity(undefined), "light");
  });

  it("returns light for short Chinese 分步骤 (< 15 chars)", () => {
    assert.equal(inferExecutionComplexity("请分步骤处理"), "light");
  });

  it("returns light for short English step by step (< 15 chars)", () => {
    assert.equal(inferExecutionComplexity("do it step by step"), "light");
  });

  it("returns delegation for sub-agent keyword (>= 15 chars)", () => {
    assert.equal(inferExecutionComplexity("use a subagent now"), "delegation");
  });

  it("returns delegation for delegate keyword", () => {
    assert.equal(inferExecutionComplexity("delegate this task"), "delegation");
  });

  it("returns light for download keyword alone (1 marker, < 50 chars)", () => {
    assert.equal(inferExecutionComplexity("download the package"), "light");
  });

  it("returns light for install keyword alone (1 marker, < 50 chars)", () => {
    assert.equal(inferExecutionComplexity("install the dependencies"), "light");
  });

  it('returns tracked for "configure the server" (2 markers: configure + config substring)', () => {
    assert.equal(inferExecutionComplexity("configure the server"), "tracked");
  });

  it("prioritizes delegation over tracked when both markers match", () => {
    assert.equal(inferExecutionComplexity("multi agent deploy step by step"), "delegation");
  });

  it("returns light for short 检查 keyword (< 15 chars)", () => {
    assert.equal(inferExecutionComplexity("检查一下配置"), "light");
  });

  it("returns light for short 汇报进度 keyword (< 15 chars)", () => {
    assert.equal(inferExecutionComplexity("请汇报进度"), "light");
  });

  it("returns delegation for 子 agent keyword (>= 15 chars)", () => {
    assert.equal(inferExecutionComplexity("请派出子 agent 执行任务"), "delegation");
  });

  it("returns delegation for dispatch keyword", () => {
    assert.equal(inferExecutionComplexity("dispatch workers now"), "delegation");
  });

  it("returns delegation for worker keyword (>= 15 chars)", () => {
    assert.equal(inferExecutionComplexity("spawn a worker process"), "delegation");
  });

  // Fix A: Short-circuit tests
  it('returns light for "你好" (trivial greeting)', () => {
    assert.equal(inferExecutionComplexity("你好"), "light");
  });

  it('returns light for "check" (< 15 chars)', () => {
    assert.equal(inferExecutionComplexity("check"), "light");
  });

  it('returns light for "hello, how are you" (trivial greeting pattern)', () => {
    assert.equal(inferExecutionComplexity("hello, how are you"), "light");
  });

  it('returns light for "帮我检查一下" (< 15 chars, no compound evidence)', () => {
    assert.equal(inferExecutionComplexity("帮我检查一下"), "light");
  });

  // Fix B: Compound evidence tests
  it('returns tracked for two keywords "请按步骤执行完整的部署和安装流程" (2+ markers)', () => {
    assert.equal(inferExecutionComplexity("请按步骤执行完整的部署和安装流程"), "tracked");
  });

  it("returns tracked for long request with single keyword (> 50 chars)", () => {
    assert.equal(
      inferExecutionComplexity("please configure the entire deployment pipeline for our production environment"),
      "tracked",
    );
  });

  it("returns tracked for two English markers: deploy + download", () => {
    assert.equal(inferExecutionComplexity("deploy and download all dependencies for the project"), "tracked");
  });

  it("returns light for single marker request exactly at 50 chars boundary", () => {
    // 50 chars exactly with "check" marker — should NOT be tracked (must be > 50)
    const text = "please check this item for me right now ok thanks!"; // 50 chars
    assert.equal(text.length, 50);
    assert.equal(inferExecutionComplexity(text), "light");
  });

  it("returns tracked for single marker request just over 50 chars", () => {
    const text = "please check this item for me right now ok thanks!!"; // 51 chars
    assert.equal(text.length, 51);
    assert.equal(inferExecutionComplexity(text), "tracked");
  });
});

describe("shouldRequireTaskBus", () => {
  it("returns false for free + light", () => {
    assert.equal(shouldRequireTaskBus("free", "light"), false);
  });

  it("returns true for free + tracked", () => {
    assert.equal(shouldRequireTaskBus("free", "tracked"), true);
  });

  it("returns true for free + delegation", () => {
    assert.equal(shouldRequireTaskBus("free", "delegation"), true);
  });

  it("returns false for guided + light", () => {
    assert.equal(shouldRequireTaskBus("guided", "light"), false);
  });

  it("returns true for guided + tracked", () => {
    assert.equal(shouldRequireTaskBus("guided", "tracked"), true);
  });

  it("returns true for guided + delegation", () => {
    assert.equal(shouldRequireTaskBus("guided", "delegation"), true);
  });

  it("returns true for tracked + light", () => {
    assert.equal(shouldRequireTaskBus("tracked", "light"), true);
  });

  it("returns true for tracked + tracked", () => {
    assert.equal(shouldRequireTaskBus("tracked", "tracked"), true);
  });

  it("returns true for tracked + delegation", () => {
    assert.equal(shouldRequireTaskBus("tracked", "delegation"), true);
  });

  it("returns true for delegation-first + light", () => {
    assert.equal(shouldRequireTaskBus("delegation-first", "light"), true);
  });

  it("returns true for delegation-first + tracked", () => {
    assert.equal(shouldRequireTaskBus("delegation-first", "tracked"), true);
  });

  it("returns true for strict-orchestrated + light", () => {
    assert.equal(shouldRequireTaskBus("strict-orchestrated", "light"), true);
  });

  it("returns true for strict-orchestrated + tracked", () => {
    assert.equal(shouldRequireTaskBus("strict-orchestrated", "tracked"), true);
  });

  it("returns true for strict-orchestrated + delegation", () => {
    assert.equal(shouldRequireTaskBus("strict-orchestrated", "delegation"), true);
  });
});

describe("shouldRequireDelegation", () => {
  it("returns true for delegation-first + tracked", () => {
    assert.equal(shouldRequireDelegation("delegation-first", "tracked"), true);
  });

  it("returns false for delegation-first + light", () => {
    assert.equal(shouldRequireDelegation("delegation-first", "light"), false);
  });

  it("returns true for free + delegation", () => {
    assert.equal(shouldRequireDelegation("free", "delegation"), true);
  });

  it("returns false for guided + light", () => {
    assert.equal(shouldRequireDelegation("guided", "light"), false);
  });

  it("returns false for free + light", () => {
    assert.equal(shouldRequireDelegation("free", "light"), false);
  });

  it("returns false for free + tracked", () => {
    assert.equal(shouldRequireDelegation("free", "tracked"), false);
  });

  it("returns true for strict-orchestrated + tracked", () => {
    assert.equal(shouldRequireDelegation("strict-orchestrated", "tracked"), true);
  });

  it("returns true for strict-orchestrated + light (always require delegation)", () => {
    assert.equal(shouldRequireDelegation("strict-orchestrated", "light"), true);
  });

  it("returns true for strict-orchestrated + delegation", () => {
    assert.equal(shouldRequireDelegation("strict-orchestrated", "delegation"), true);
  });

  it("returns true for guided + delegation", () => {
    assert.equal(shouldRequireDelegation("guided", "delegation"), true);
  });
});

describe("buildExecutionPolicyReport", () => {
  const baseState = {
    hasTaskBus: true,
    hasPlan: true,
    hasCheckpoint: false,
    hasWorkerStart: true,
    hasTrackedExecution: true,
    hasCompletedStep: false,
    hasFinalMerge: false,
    currentStep: 0,
    totalSteps: 0,
  };

  it("produces no violations when all requirements are met for free + light", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "free",
      delegationStartGate: "off",
      request: "hello",
      state: {
        hasTaskBus: false,
        hasPlan: false,
        hasCheckpoint: false,
        hasWorkerStart: false,
        hasTrackedExecution: false,
      },
    });
    assert.equal(details.violations.length, 0);
  });

  it("adds violation when task bus required but missing", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "tracked",
      delegationStartGate: "off",
      request: "step by step deploy and install everything",
      state: {
        hasTaskBus: false,
        hasPlan: true,
        hasWorkerStart: true,
        hasTrackedExecution: true,
      },
    });
    assert.ok(details.violations.some((v: string) => v.includes("task bus")));
  });

  it("adds violation when plan required but missing", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "guided",
      delegationStartGate: "off",
      request: "deploy step by step and then install all the dependencies",
      state: {
        hasTaskBus: true,
        hasPlan: false,
        hasWorkerStart: true,
        hasTrackedExecution: true,
      },
    });
    assert.ok(details.violations.some((v: string) => v.includes("步骤计划")));
  });

  it("adds violation when checkpoint announced but no real execution", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "free",
      delegationStartGate: "off",
      request: "hello",
      state: {
        hasCheckpoint: true,
        hasWorkerStart: false,
        hasTrackedExecution: false,
      },
    });
    assert.ok(details.violations.some((v: string) => v.includes("真实执行")));
  });

  it("advisory mode with no worker adds suggestion to nextActions, not violations", () => {
    const { details, report } = buildExecutionPolicyReport({
      mode: "free",
      delegationStartGate: "advisory",
      request: "dispatch workers now",
      state: {
        hasTaskBus: true,
        hasPlan: true,
        hasWorkerStart: false,
        hasTrackedExecution: false,
      },
    });
    // The advisory suggestion goes to nextActions (not violations)
    assert.ok(report.includes("建议"));
    // delegation is required for "dispatch" keyword in free mode
    // check that advisory suggestion is present whether or not there are violations
    const allNextActions = details.requiredNow.join(" ") + report;
    assert.ok(allNextActions.includes("建议") || report.includes("advisory"));
  });

  it("required gate with no worker adds hard violation", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "delegation-first",
      delegationStartGate: "required",
      request: "multi agent deploy",
      state: {
        hasTaskBus: true,
        hasPlan: true,
        hasCheckpoint: false,
        hasWorkerStart: false,
        hasTrackedExecution: false,
      },
    });
    assert.ok(details.violations.length > 0);
  });

  it("adds violation about final merge when all steps done but no finalMerge", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "tracked",
      delegationStartGate: "off",
      request: "step by step deploy and install",
      state: {
        ...baseState,
        currentStep: 3,
        totalSteps: 3,
        hasFinalMerge: false,
      },
    });
    assert.ok(details.violations.some((v: string) => v.includes("汇总") || v.includes("验收")));
  });

  it("adds violation about advancing when a step is completed with remaining steps", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "tracked",
      delegationStartGate: "off",
      request: "step by step deploy and install",
      state: {
        ...baseState,
        hasCompletedStep: true,
        currentStep: 1,
        totalSteps: 3,
      },
    });
    assert.ok(details.violations.some((v: string) => v.includes("Step 1") || v.includes("推进")));
  });

  it("free mode + light task produces no requirements", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "free",
      delegationStartGate: "off",
      request: "hello",
      state: {},
    });
    assert.equal(details.requireTaskBus, false);
    assert.equal(details.requireDelegation, false);
  });

  it("report contains policy mode string", () => {
    const { report } = buildExecutionPolicyReport({
      mode: "guided",
      delegationStartGate: "off",
      request: "hello",
      state: { hasPlan: true },
    });
    assert.ok(report.includes("guided"));
  });

  it("resumePrompt contains required actions when violations exist", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "tracked",
      delegationStartGate: "off",
      request: "step by step deploy and install all dependencies",
      state: { hasTaskBus: false, hasPlan: false },
    });
    assert.ok(details.resumePrompt.includes("tracked"));
  });

  it("strict-orchestrated always requires task bus even for light task", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "strict-orchestrated",
      delegationStartGate: "off",
      request: "hello",
      state: { hasTaskBus: false, hasPlan: true, hasWorkerStart: true },
    });
    assert.equal(details.requireTaskBus, true);
    assert.ok(details.violations.some((v: string) => v.includes("task bus")));
  });

  it("strict-orchestrated always requires delegation even for light task", () => {
    const { details } = buildExecutionPolicyReport({
      mode: "strict-orchestrated",
      delegationStartGate: "off",
      request: "hello",
      state: { hasTaskBus: true, hasPlan: true, hasWorkerStart: false },
    });
    assert.equal(details.requireDelegation, true);
    assert.ok(details.violations.some((v: string) => v.includes("worker/subagent")));
  });
});
