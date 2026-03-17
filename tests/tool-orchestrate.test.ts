import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createMultiAgentOrchestratorTool } from "../src/tool.ts";
import { createEmptyBoard } from "../src/task-board.ts";

function makeTool(board = createEmptyBoard()) {
  return {
    tool: createMultiAgentOrchestratorTool({ board }),
    board,
  };
}

// ── orchestrate action ────────────────────────────────────────────────────

describe("orchestrate action", () => {
  it("creates a project with tasks and returns dispatch guidance", async () => {
    const { tool, board } = makeTool();
    const result = await tool.execute("test-1", {
      action: "orchestrate",
      request: "查 issues 最近 7 天",
    });
    assert.ok(result.content[0].text.includes("OMA Dispatch Plan"));
    assert.equal(board.projects.length, 1);
    assert.ok(board.projects[0].tasks.length > 0);
  });

  it("returns project id and task list in details", async () => {
    const { tool, board } = makeTool();
    const result = await tool.execute("test-2", {
      action: "orchestrate",
      request: "查 issues",
    });
    assert.ok(typeof result.details.projectId === "string");
    assert.ok(Array.isArray(result.details.tasks));
    assert.ok((result.details.tasks as unknown[]).length > 0);
  });

  it("creates correct tasks from templateIds", async () => {
    const { tool, board } = makeTool();
    const result = await tool.execute("test-3", {
      action: "orchestrate",
      request: "run security check",
      templateIds: ["security-audit", "performance-review"],
    });
    assert.equal(board.projects[0].tasks.length, 2);
    const trackIds = board.projects[0].tasks.map((t) => t.trackId);
    assert.ok(trackIds.includes("security-audit-track"));
    assert.ok(trackIds.includes("performance-review-track"));
    assert.ok(result.content[0].text.includes("Security Audit"));
  });

  it("creates correct tasks from agentType matching keyword inference", async () => {
    const { tool, board } = makeTool();
    await tool.execute("test-4", {
      action: "orchestrate",
      request: "查 discussions 最近 14 天",
    });
    const tasks = board.projects[0].tasks;
    assert.ok(tasks.some((t) => t.trackId === "discussions-track"));
  });

  it("throws error when request is empty", async () => {
    const { tool } = makeTool();
    await assert.rejects(
      () => tool.execute("test-5", { action: "orchestrate", request: "" }),
      /request is required/,
    );
  });

  it("throws error when request is missing", async () => {
    const { tool } = makeTool();
    await assert.rejects(
      () => tool.execute("test-6", { action: "orchestrate" }),
      /request is required/,
    );
  });

  it("sets all tasks to pending initially", async () => {
    const { tool, board } = makeTool();
    await tool.execute("test-7", {
      action: "orchestrate",
      request: "查 issues",
    });
    const tasks = board.projects[0].tasks;
    assert.ok(tasks.every((t) => t.status === "pending"));
  });

  it("dispatch guidance contains sessions_spawn instruction", async () => {
    const { tool } = makeTool();
    const result = await tool.execute("test-8", {
      action: "orchestrate",
      request: "查 issues",
    });
    assert.ok(result.content[0].text.includes("sessions_spawn"));
  });

  it("dispatch guidance contains validate_and_merge instruction", async () => {
    const { tool } = makeTool();
    const result = await tool.execute("test-9", {
      action: "orchestrate",
      request: "查 issues",
    });
    assert.ok(result.content[0].text.includes("validate_and_merge"));
  });

  it("project name is truncated to 50 chars from request", async () => {
    const { tool, board } = makeTool();
    const longRequest = "a".repeat(100);
    await tool.execute("test-10", { action: "orchestrate", request: longRequest });
    assert.ok(board.projects[0].name.length <= 50);
  });

  it("each task has a subagentPrompt", async () => {
    const { tool, board } = makeTool();
    await tool.execute("test-11", {
      action: "orchestrate",
      request: "查 issues",
    });
    const tasks = board.projects[0].tasks;
    for (const task of tasks) {
      assert.ok(typeof task.subagentPrompt === "string");
      assert.ok(task.subagentPrompt.length > 0);
    }
  });

  it("multiple orchestrate calls create separate projects", async () => {
    const { tool, board } = makeTool();
    await tool.execute("test-12a", { action: "orchestrate", request: "查 issues" });
    await tool.execute("test-12b", { action: "orchestrate", request: "查 discussions" });
    assert.equal(board.projects.length, 2);
    assert.notEqual(board.projects[0].id, board.projects[1].id);
  });
});
