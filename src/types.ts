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
