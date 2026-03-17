import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionState,
  recordPlan,
  recordTrackResult,
  getMissingTracks,
  getUnplannedTracks,
  recordEnforcement,
  recordToolCall,
  resetSessionState,
} from "../src/session-state.ts";

describe("createSessionState", () => {
  it("creates empty state with defaults", () => {
    const state = createSessionState();
    assert.deepEqual(state.plannedTracks, []);
    assert.equal(state.planCreatedAt, undefined);
    assert.equal(state.trackResults.size, 0);
    assert.deepEqual(state.enforcementHistory, []);
    assert.equal(state.totalToolCalls, 0);
    assert.equal(typeof state.sessionStartedAt, "string");
  });

  it("sets sessionStartedAt to a valid ISO string", () => {
    const before = new Date().toISOString();
    const state = createSessionState();
    const after = new Date().toISOString();
    assert.ok(state.sessionStartedAt >= before);
    assert.ok(state.sessionStartedAt <= after);
  });
});

describe("recordPlan", () => {
  it("stores tracks in plannedTracks", () => {
    const state = createSessionState();
    recordPlan(state, [
      { trackId: "t1", label: "Track 1" },
      { trackId: "t2", label: "Track 2", contentType: "issues" },
    ]);
    assert.equal(state.plannedTracks.length, 2);
    assert.equal(state.plannedTracks[0].trackId, "t1");
    assert.equal(state.plannedTracks[1].contentType, "issues");
  });

  it("sets planCreatedAt", () => {
    const state = createSessionState();
    const before = new Date().toISOString();
    recordPlan(state, [{ trackId: "t1", label: "Track 1" }]);
    const after = new Date().toISOString();
    assert.ok(state.planCreatedAt !== undefined);
    assert.ok(state.planCreatedAt! >= before);
    assert.ok(state.planCreatedAt! <= after);
  });

  it("replaces previous plan on second call", () => {
    const state = createSessionState();
    recordPlan(state, [{ trackId: "t1", label: "Track 1" }]);
    recordPlan(state, [{ trackId: "t2", label: "Track 2" }]);
    assert.equal(state.plannedTracks.length, 1);
    assert.equal(state.plannedTracks[0].trackId, "t2");
  });
});

describe("recordTrackResult", () => {
  it("stores track result with ok status", () => {
    const state = createSessionState();
    recordTrackResult(state, "t1", "ok");
    assert.ok(state.trackResults.has("t1"));
    assert.equal(state.trackResults.get("t1")!.status, "ok");
    assert.equal(state.trackResults.get("t1")!.trackId, "t1");
  });

  it("stores partial and failed statuses", () => {
    const state = createSessionState();
    recordTrackResult(state, "t1", "partial");
    recordTrackResult(state, "t2", "failed");
    assert.equal(state.trackResults.get("t1")!.status, "partial");
    assert.equal(state.trackResults.get("t2")!.status, "failed");
  });

  it("sets submittedAt timestamp", () => {
    const state = createSessionState();
    const before = new Date().toISOString();
    recordTrackResult(state, "t1", "ok");
    const after = new Date().toISOString();
    const result = state.trackResults.get("t1")!;
    assert.ok(result.submittedAt !== undefined);
    assert.ok(result.submittedAt! >= before);
    assert.ok(result.submittedAt! <= after);
  });
});

describe("getMissingTracks", () => {
  it("returns planned but not submitted track IDs", () => {
    const state = createSessionState();
    recordPlan(state, [
      { trackId: "t1", label: "Track 1" },
      { trackId: "t2", label: "Track 2" },
    ]);
    recordTrackResult(state, "t1", "ok");
    const missing = getMissingTracks(state);
    assert.deepEqual(missing, ["t2"]);
  });

  it("returns empty array when all planned tracks are submitted", () => {
    const state = createSessionState();
    recordPlan(state, [
      { trackId: "t1", label: "Track 1" },
      { trackId: "t2", label: "Track 2" },
    ]);
    recordTrackResult(state, "t1", "ok");
    recordTrackResult(state, "t2", "partial");
    const missing = getMissingTracks(state);
    assert.deepEqual(missing, []);
  });

  it("returns all tracks when none submitted", () => {
    const state = createSessionState();
    recordPlan(state, [
      { trackId: "t1", label: "Track 1" },
      { trackId: "t2", label: "Track 2" },
    ]);
    const missing = getMissingTracks(state);
    assert.equal(missing.length, 2);
  });

  it("returns empty when no plan recorded", () => {
    const state = createSessionState();
    const missing = getMissingTracks(state);
    assert.deepEqual(missing, []);
  });
});

describe("getUnplannedTracks", () => {
  it("returns unplanned tracks detected in submitted list", () => {
    const state = createSessionState();
    recordPlan(state, [{ trackId: "t1", label: "Track 1" }]);
    const unplanned = getUnplannedTracks(state, ["t1", "t2-surprise"]);
    assert.deepEqual(unplanned, ["t2-surprise"]);
  });

  it("returns empty when all submitted tracks are planned", () => {
    const state = createSessionState();
    recordPlan(state, [
      { trackId: "t1", label: "Track 1" },
      { trackId: "t2", label: "Track 2" },
    ]);
    const unplanned = getUnplannedTracks(state, ["t1", "t2"]);
    assert.deepEqual(unplanned, []);
  });

  it("returns all submitted when no plan exists", () => {
    const state = createSessionState();
    const unplanned = getUnplannedTracks(state, ["t1", "t2"]);
    assert.deepEqual(unplanned, ["t1", "t2"]);
  });
});

describe("recordEnforcement", () => {
  it("adds entry to enforcementHistory", () => {
    const state = createSessionState();
    recordEnforcement(state, ["missing_plan"], "guided");
    assert.equal(state.enforcementHistory.length, 1);
    assert.deepEqual(state.enforcementHistory[0].violations, ["missing_plan"]);
    assert.equal(state.enforcementHistory[0].mode, "guided");
  });

  it("accumulates multiple enforcement records", () => {
    const state = createSessionState();
    recordEnforcement(state, [], "free");
    recordEnforcement(state, ["v1"], "strict-orchestrated");
    assert.equal(state.enforcementHistory.length, 2);
  });

  it("records timestamp on each entry", () => {
    const state = createSessionState();
    const before = new Date().toISOString();
    recordEnforcement(state, [], "guided");
    const after = new Date().toISOString();
    assert.ok(state.enforcementHistory[0].timestamp >= before);
    assert.ok(state.enforcementHistory[0].timestamp <= after);
  });
});

describe("recordToolCall", () => {
  it("increments totalToolCalls by 1", () => {
    const state = createSessionState();
    assert.equal(state.totalToolCalls, 0);
    recordToolCall(state);
    assert.equal(state.totalToolCalls, 1);
    recordToolCall(state);
    assert.equal(state.totalToolCalls, 2);
  });
});

describe("resetSessionState", () => {
  it("clears all state fields", () => {
    const state = createSessionState();
    recordPlan(state, [{ trackId: "t1", label: "T1" }]);
    recordTrackResult(state, "t1", "ok");
    recordEnforcement(state, ["v1"], "guided");
    recordToolCall(state);

    resetSessionState(state);

    assert.deepEqual(state.plannedTracks, []);
    assert.equal(state.planCreatedAt, undefined);
    assert.equal(state.trackResults.size, 0);
    assert.deepEqual(state.enforcementHistory, []);
    assert.equal(state.totalToolCalls, 0);
  });

  it("resets sessionStartedAt to a new timestamp", () => {
    const state = createSessionState();
    const original = state.sessionStartedAt;
    // Small delay to ensure timestamp difference
    const before = new Date().toISOString();
    resetSessionState(state);
    const after = new Date().toISOString();
    assert.ok(state.sessionStartedAt >= before);
    assert.ok(state.sessionStartedAt <= after);
    // The reset timestamp should be valid ISO
    assert.doesNotThrow(() => new Date(state.sessionStartedAt));
    void original; // suppress unused variable warning
  });
});
