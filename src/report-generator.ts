import { type Project, getProjectSummary } from "./task-board.ts";

/**
 * Generate a comprehensive project completion report.
 */
export function generateProjectReport(project: Project): string {
  const summary = getProjectSummary(project);

  const lines: string[] = [];

  lines.push(`# 项目报告: ${project.name}`);
  lines.push(`状态: ${project.status}`);
  lines.push(`创建时间: ${project.createdAt}`);
  lines.push(`原始请求: ${project.request}`);
  lines.push("");

  // Overview
  lines.push("## 概览");
  lines.push(`- 总任务: ${summary.total}`);
  lines.push(`- 通过: ${summary.approved}`);
  lines.push(`- 拒绝: ${summary.rejected}`);
  lines.push(`- 失败: ${summary.failed}`);
  lines.push("");

  // Task details
  lines.push("## 任务详情");
  for (const task of project.tasks) {
    const icon =
      task.reviewStatus === "approved"
        ? "✅"
        : task.reviewStatus === "rejected"
          ? "❌"
          : task.status === "failed"
            ? "💥"
            : "⏳";
    lines.push(`### ${icon} ${task.label} (${task.id})`);
    lines.push(`- 状态: ${task.status}`);
    if (task.agentType) lines.push(`- Agent: ${task.agentType}`);
    if (task.reviewStatus) lines.push(`- 验收: ${task.reviewStatus}`);
    if (task.reviewReason) lines.push(`- 原因: ${task.reviewReason}`);
    if (task.retryCount > 0) lines.push(`- 重试次数: ${task.retryCount}`);
    if (task.resultSummary) {
      lines.push(`- 结果摘要:`);
      lines.push(`  ${task.resultSummary.slice(0, 500)}`);
    }
    lines.push("");
  }

  // Conclusion
  lines.push("## 结论");
  if (summary.approved === summary.total && summary.total > 0) {
    lines.push("所有任务均通过验收。项目完成。");
  } else if (summary.approved > 0) {
    lines.push(
      `${summary.approved}/${summary.total} 任务通过，${summary.rejected + summary.failed} 任务未通过。`,
    );
  } else {
    lines.push("所有任务均未通过验收。项目失败。");
  }

  return lines.join("\n");
}
