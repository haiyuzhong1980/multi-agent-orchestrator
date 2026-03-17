export interface OrchestratorSessionState {
  // Plan state
  plannedTracks: Array<{
    trackId: string;
    label: string;
    contentType?: string;
  }>;
  planCreatedAt?: string;

  // Execution state (derived from spawn tracker, but also from tool calls)
  trackResults: Map<
    string,
    {
      trackId: string;
      submittedAt?: string;
      status?: "ok" | "partial" | "failed";
    }
  >;

  // Policy state
  enforcementHistory: Array<{
    timestamp: string;
    violations: string[];
    mode: string;
  }>;

  // Session metadata
  sessionStartedAt: string;
  totalToolCalls: number;
}

export function createSessionState(): OrchestratorSessionState {
  return {
    plannedTracks: [],
    planCreatedAt: undefined,
    trackResults: new Map(),
    enforcementHistory: [],
    sessionStartedAt: new Date().toISOString(),
    totalToolCalls: 0,
  };
}

/**
 * Record planned tracks from plan_tracks action.
 */
export function recordPlan(
  state: OrchestratorSessionState,
  tracks: Array<{ trackId: string; label: string; contentType?: string }>,
): void {
  state.plannedTracks = tracks.map((t) => ({
    trackId: t.trackId,
    label: t.label,
    contentType: t.contentType,
  }));
  state.planCreatedAt = new Date().toISOString();
}

/**
 * Record enforcement result.
 */
export function recordEnforcement(
  state: OrchestratorSessionState,
  violations: string[],
  mode: string,
): void {
  state.enforcementHistory.push({
    timestamp: new Date().toISOString(),
    violations,
    mode,
  });
}

/**
 * Record track result submission from validate_and_merge.
 */
export function recordTrackResult(
  state: OrchestratorSessionState,
  trackId: string,
  status: "ok" | "partial" | "failed",
): void {
  state.trackResults.set(trackId, {
    trackId,
    submittedAt: new Date().toISOString(),
    status,
  });
}

/**
 * Check track coverage: were all planned tracks submitted?
 * Returns list of missing track IDs.
 */
export function getMissingTracks(state: OrchestratorSessionState): string[] {
  return state.plannedTracks
    .filter((t) => !state.trackResults.has(t.trackId))
    .map((t) => t.trackId);
}

/**
 * Check for unplanned tracks: tracks submitted but not in the plan.
 */
export function getUnplannedTracks(
  state: OrchestratorSessionState,
  submittedTrackIds: string[],
): string[] {
  const plannedIds = new Set(state.plannedTracks.map((t) => t.trackId));
  return submittedTrackIds.filter((id) => !plannedIds.has(id));
}

/**
 * Increment tool call counter.
 */
export function recordToolCall(state: OrchestratorSessionState): void {
  state.totalToolCalls += 1;
}

/**
 * Reset session state (for new session).
 */
export function resetSessionState(state: OrchestratorSessionState): void {
  state.plannedTracks = [];
  state.planCreatedAt = undefined;
  state.trackResults = new Map();
  state.enforcementHistory = [];
  state.sessionStartedAt = new Date().toISOString();
  state.totalToolCalls = 0;
}
