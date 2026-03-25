// In-memory scenario state store.
//
// State is attached to `globalThis` so it survives Next.js hot-module
// replacement in dev mode (where each route handler can get a fresh module
// instance but they all share the same Node.js global).
//
// NOTE: On Vercel serverless each function instance has its own memory.
// State can be lost on cold starts. The admin client persists state to
// localStorage and rehydrates the server on page load via PATCH /api/scenarios/[id].
// For multi-user or persistent sessions, replace this with Vercel KV.

import type { ScenarioState, ScenarioStatus } from "./types";
import type { AnswerKey } from "@/lib/generator/types";
import type { DripQueue } from "@/lib/submission/drip";
import { SCENARIOS } from "@/lib/generator/scenarios";

// eslint-disable-next-line no-var
declare global {
  var __woofiesScenarioStates: Map<number, ScenarioState> | undefined;
  var __woofiesDripQueues: Map<string, DripQueue> | undefined;
}

function getScenarioStates(): Map<number, ScenarioState> {
  if (!globalThis.__woofiesScenarioStates) {
    const map = new Map<number, ScenarioState>();
    for (const s of SCENARIOS) {
      map.set(s.id, {
        id: s.id,
        status: "not_run",
        targetDate: null,
        answerKey: null,
        frozen: false,
        dripSessionId: null,
        lastRunAt: null,
        dynamicText: null,
      });
    }
    globalThis.__woofiesScenarioStates = map;
  }
  return globalThis.__woofiesScenarioStates;
}

function getDripQueues(): Map<string, DripQueue> {
  if (!globalThis.__woofiesDripQueues) {
    globalThis.__woofiesDripQueues = new Map();
  }
  return globalThis.__woofiesDripQueues;
}

export function getAllStates(): ScenarioState[] {
  const states = getScenarioStates();
  return SCENARIOS.map(s => states.get(s.id)!);
}

export function getState(id: number): ScenarioState | undefined {
  return getScenarioStates().get(id);
}

export function setState(id: number, patch: Partial<ScenarioState>): ScenarioState {
  const states = getScenarioStates();
  const existing = states.get(id);
  if (!existing) throw new Error(`Unknown scenario ${id}`);
  const updated = { ...existing, ...patch };
  states.set(id, updated);
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

export function finishScenario(id: number): void {
  setState(id, { status: "finished", frozen: false });
}

export function resetAllScenarios(): void {
  const states = getScenarioStates();
  for (const s of SCENARIOS) {
    states.set(s.id, {
      id: s.id,
      status: "not_run",
      targetDate: null,
      answerKey: null,
      frozen: false,
      dripSessionId: null,
      lastRunAt: null,
      dynamicText: null,
    });
  }
}

// Drip queue management
export function storeDripQueue(queue: DripQueue): void {
  getDripQueues().set(queue.sessionId, queue);
}

export function getDripQueue(sessionId: string): DripQueue | undefined {
  return getDripQueues().get(sessionId);
}

export function deleteDripQueue(sessionId: string): void {
  getDripQueues().delete(sessionId);
}
