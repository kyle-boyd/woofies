import type { AnswerKey } from "@/lib/generator/types";

export type ScenarioStatus = "not_run" | "submitted" | "drip_in_progress" | "frozen";

export interface ScenarioState {
  id: number;
  status: ScenarioStatus;
  targetDate: string | null; // YYYY-MM-DD
  answerKey: AnswerKey | null;
  frozen: boolean;
  dripSessionId: string | null;
  lastRunAt: string | null; // ISO timestamp
}
