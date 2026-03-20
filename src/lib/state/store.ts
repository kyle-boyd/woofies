// In-memory scenario state store.
//
// NOTE: On Vercel serverless each function instance has its own memory.
// State can be lost on cold starts. The admin client persists state to
// localStorage and rehydrates the server on page load via PATCH /api/scenarios/[id].
// For multi-user or persistent sessions, replace this with Vercel KV.

import type { ScenarioState, ScenarioStatus } from "./types";
import type { AnswerKey } from "@/lib/generator/types";
import type { DripQueue } from "@/lib/submission/drip";
import { SCENARIOS } from "@/lib/generator/scenarios";

// In-memory state
const scenarioStates = new Map<number, ScenarioState>();

// In-memory submission queues (sessionId → Transfer[])
const submissionQueues = new Map<string, { transfers: Array<[string, unknown[]]>; cursor: number }>();

// In-memory drip queues
const dripQueues = new Map<string, DripQueue>();

// Initialize all 8 scenarios in not_run state
function initStore() {
  for (const s of SCENARIOS) {
    scenarioStates.set(s.id, {
      id: s.id,
      status: "not_run",
      targetDate: null,
      answerKey: null,
      frozen: false,
      dripSessionId: null,
      lastRunAt: null,
    });
  }
}
initStore();

export function getAllStates(): ScenarioState[] {
  return SCENARIOS.map(s => scenarioStates.get(s.id)!);
}

export function getState(id: number): ScenarioState | undefined {
  return scenarioStates.get(id);
}

export function setState(id: number, patch: Partial<ScenarioState>): ScenarioState {
  const existing = scenarioStates.get(id);
  if (!existing) throw new Error(`Unknown scenario ${id}`);
  const updated = { ...existing, ...patch };
  scenarioStates.set(id, updated);
  return updated;
}

export function setStatus(id: number, status: ScenarioStatus): void {
  setState(id, { status });
}

export function setAnswerKey(id: number, key: AnswerKey): void {
  setState(id, { answerKey: key });
}

export function freezeScenario(id: number): void {
  setState(id, { frozen: true, status: "frozen" });
}

export function unfreezeScenario(id: number): void {
  setState(id, { frozen: false, status: "submitted" });
}

// Submission queue management
export function storeSubmissionQueue(
  sessionId: string,
  transfers: Array<[string, unknown[]]>
): void {
  submissionQueues.set(sessionId, { transfers, cursor: 0 });
}

export function getSubmissionQueue(sessionId: string) {
  return submissionQueues.get(sessionId);
}

export function advanceSubmissionCursor(sessionId: string, by: number): void {
  const q = submissionQueues.get(sessionId);
  if (q) q.cursor += by;
}

export function deleteSubmissionQueue(sessionId: string): void {
  submissionQueues.delete(sessionId);
}

// Drip queue management
export function storeDripQueue(queue: DripQueue): void {
  dripQueues.set(queue.sessionId, queue);
}

export function getDripQueue(sessionId: string): DripQueue | undefined {
  return dripQueues.get(sessionId);
}

export function deleteDripQueue(sessionId: string): void {
  dripQueues.delete(sessionId);
}
