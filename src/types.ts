export type TrackContentType = "github-url" | "text-analysis" | "structured-data";

export type TrackInput = {
  trackId: string;
  label?: string;
  resultText: string;
  required?: boolean;
  contentType?: TrackContentType;
};

export type ExecutionPolicyMode =
  | "free"
  | "guided"
  | "tracked"
  | "delegation-first"
  | "strict-orchestrated";

export type DelegationStartGateMode = "off" | "advisory" | "required";

export type ExecutionGuardRequest = {
  request?: string;
  taskState?: string;
  hasTaskBus?: boolean;
  hasPlan?: boolean;
  hasCheckpoint?: boolean;
  hasWorkerStart?: boolean;
  hasTrackedExecution?: boolean;
  hasCompletedStep?: boolean;
  hasFinalMerge?: boolean;
  currentStep?: number;
  totalSteps?: number;
};

export type PlannedTrack = {
  trackId: string;
  label: string;
  goal: string;
  outputContract: string[];
  failureContract: string[];
  subagentPrompt: string;
  contentType?: TrackContentType;
};

export type CandidateItem = {
  title: string;
  url: string;
  raw: string;
  comments: number | null;
};

// ============================================================================
// M6: Agent Identity System
// ============================================================================

/**
 * Agent identity information for multi-agent coordination.
 */
export interface AgentIdentity {
  agentId: string;         // Unique identifier (session key)
  agentName: string;       // Display name (e.g., "security-reviewer-1")
  agentType: string;       // Type: "leader" | "worker" | "reviewer" | etc.
  teamName: string | null; // Team name if part of a team
  isLeader: boolean;       // Whether this agent is a team leader
  joinedAt: string;        // ISO timestamp when agent joined
}

// ============================================================================
// M6: Message Types
// ============================================================================

/**
 * Message types for inter-agent communication.
 * Using const object instead of enum for Node.js strip-only mode compatibility.
 */
export const MessageType = {
  message: "message",                           // Generic message
  join_request: "join_request",                 // Request to join a team
  join_approved: "join_approved",               // Join request approved
  plan_approval_request: "plan_approval_request", // Request plan approval
  plan_approved: "plan_approved",               // Plan approved
  task_blocked: "task_blocked",                 // Task is blocked
  task_completed: "task_completed",             // Task completed
  shutdown_request: "shutdown_request",         // Request agent shutdown
  broadcast: "broadcast",                       // Broadcast to all agents
} as const;

export type MessageType = typeof MessageType[keyof typeof MessageType];

/**
 * A message sent between agents.
 */
export interface TeamMessage {
  id: string;                    // Unique message ID
  type: MessageType;             // Message type
  from: string;                  // Sender agentId
  to: string | null;             // Receiver agentId, null for broadcast
  content: string;               // Message content
  timestamp: string;             // ISO timestamp
  metadata?: Record<string, unknown>; // Optional metadata
}
