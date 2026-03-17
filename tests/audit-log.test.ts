import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createAuditLog,
  logEvent,
  getRecentEntries,
  formatAuditReport,
} from "../src/audit-log.ts";

describe("createAuditLog", () => {
  it("creates empty log with default maxEntries", () => {
    const log = createAuditLog();
    assert.equal(log.entries.length, 0);
    assert.equal(log.maxEntries, 200);
  });

  it("creates log with custom maxEntries", () => {
    const log = createAuditLog(50);
    assert.equal(log.maxEntries, 50);
  });
});

describe("logEvent", () => {
  it("adds entry with timestamp", () => {
    const log = createAuditLog();
    const before = new Date().toISOString();
    logEvent(log, "plan_created", { trackCount: 3 });
    const after = new Date().toISOString();
    assert.equal(log.entries.length, 1);
    assert.equal(log.entries[0].event, "plan_created");
    assert.equal(log.entries[0].details.trackCount, 3);
    assert.ok(log.entries[0].timestamp >= before);
    assert.ok(log.entries[0].timestamp <= after);
  });

  it("adds multiple entries in order", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    logEvent(log, "merge_completed", {});
    assert.equal(log.entries.length, 2);
    assert.equal(log.entries[0].event, "plan_created");
    assert.equal(log.entries[1].event, "merge_completed");
  });

  it("respects maxEntries cap with FIFO eviction", () => {
    const log = createAuditLog(3);
    logEvent(log, "plan_created", { n: 1 });
    logEvent(log, "plan_created", { n: 2 });
    logEvent(log, "plan_created", { n: 3 });
    logEvent(log, "plan_created", { n: 4 });
    assert.equal(log.entries.length, 3);
    // First entry (n=1) should have been evicted
    assert.equal(log.entries[0].details.n, 2);
    assert.equal(log.entries[2].details.n, 4);
  });

  it("keeps exactly maxEntries when at cap", () => {
    const log = createAuditLog(2);
    for (let i = 0; i < 10; i++) {
      logEvent(log, "policy_check", { i });
    }
    assert.equal(log.entries.length, 2);
    assert.equal(log.entries[0].details.i, 8);
    assert.equal(log.entries[1].details.i, 9);
  });
});

describe("getRecentEntries", () => {
  it("returns all entries when no filter", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    logEvent(log, "merge_completed", {});
    const entries = getRecentEntries(log);
    assert.equal(entries.length, 2);
  });

  it("filters by event type", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    logEvent(log, "merge_completed", {});
    logEvent(log, "plan_created", {});
    const entries = getRecentEntries(log, "plan_created");
    assert.equal(entries.length, 2);
    assert.ok(entries.every((e) => e.event === "plan_created"));
  });

  it("respects limit parameter", () => {
    const log = createAuditLog();
    for (let i = 0; i < 5; i++) {
      logEvent(log, "policy_check", { i });
    }
    const entries = getRecentEntries(log, undefined, 3);
    assert.equal(entries.length, 3);
    // Should return most recent 3
    assert.equal(entries[0].details.i, 2);
    assert.equal(entries[2].details.i, 4);
  });

  it("returns empty array for unmatched event type", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    const entries = getRecentEntries(log, "tool_blocked");
    assert.equal(entries.length, 0);
  });

  it("does not mutate the log entries array", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    const entries = getRecentEntries(log);
    entries.push({ timestamp: "x", event: "policy_check", details: {} });
    assert.equal(log.entries.length, 1);
  });
});

describe("formatAuditReport", () => {
  it("produces readable text with timestamps and event names", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", { trackCount: 2 });
    const report = formatAuditReport(log);
    assert.match(report, /plan_created/);
    assert.match(report, /trackCount/);
  });

  it("returns empty string for empty log", () => {
    const log = createAuditLog();
    const report = formatAuditReport(log);
    assert.equal(report, "");
  });

  it("respects limit parameter showing most recent entries", () => {
    const log = createAuditLog();
    for (let i = 0; i < 5; i++) {
      logEvent(log, "policy_check", { i });
    }
    const report = formatAuditReport(log, 2);
    const lines = report.split("\n");
    assert.equal(lines.length, 2);
    assert.match(lines[0], /i=3/);
    assert.match(lines[1], /i=4/);
  });

  it("includes all entries when no limit specified", () => {
    const log = createAuditLog();
    logEvent(log, "plan_created", {});
    logEvent(log, "merge_completed", {});
    logEvent(log, "policy_check", {});
    const report = formatAuditReport(log);
    const lines = report.split("\n");
    assert.equal(lines.length, 3);
  });
});
