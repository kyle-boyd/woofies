// Core event and transfer types

export interface FtvEvent {
  STAGE: string;
  Event: string;
  TIME: string;
  ARRIVEDFILE_KEY: string;
  EVENT_KEY: string;
  EVENT_SOURCE_NAME: string;
  EVENT_SOURCE_URL: string;
  EVENT_SOURCE_TYPE: string;
  [key: string]: unknown;
}

// [arrivedFileKey, events[]]
export type Transfer = [string, FtvEvent[]];

// Returned by each scenario function
export interface ScenarioResult {
  transfers: Transfer[];
  injectedKeys: string[]; // arrivedFileKeys of injected anomalies (failures, misroutes, etc.)
}

// Mutable context passed through generator calls (replaces Python module globals)
export interface GeneratorContext {
  keyCounter: number;
  batchCounter: number;
  loanIdCounter: number;
}

export function makeContext(opts?: Partial<GeneratorContext>): GeneratorContext {
  return {
    keyCounter: opts?.keyCounter ?? 0,
    batchCounter: opts?.batchCounter ?? 1,
    loanIdCounter: opts?.loanIdCounter ?? 4000,
  };
}

// Answer key types
export interface Finding {
  description: string;
  arrivedfileKey: string;
  filename: string;
  partner: string;
  startTime: string; // human-readable ET timestamp
  outcome: "FailTransfer" | "Stalled" | "Misrouted" | "SlowDelivery" | "RetrySuccess";
  errorMessage?: string;
  details: string;
}

export interface AnswerKey {
  scenarioId: number;
  scenarioName: string;
  generatedAt: string; // ISO timestamp
  targetDate: string; // YYYY-MM-DD
  totalTransfers: number;
  totalSuccess: number;
  totalFailed: number;
  totalStalled: number;
  findings: Finding[];
}
