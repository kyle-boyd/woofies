import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { SCENARIOS } from "@/lib/generator/scenarios";
import { buildAnswerKey } from "@/lib/generator/answerKey";
import { getState, setState, storeDripQueue } from "@/lib/state/store";
import { initDripQueue } from "@/lib/submission/drip";
import type { Transfer } from "@/lib/generator/types";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenarioId = Number(id);
  const state = getState(scenarioId);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (state.frozen) return NextResponse.json({ error: "Scenario is frozen" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const targetDate: string = body.targetDate ?? new Date().toISOString().slice(0, 10);

  const scenarioMeta = SCENARIOS.find(s => s.id === scenarioId);
  if (!scenarioMeta) return NextResponse.json({ error: "Unknown scenario" }, { status: 404 });

  const { transfers, injectedKeys } = scenarioMeta.fn(targetDate);
  const answerKey = buildAnswerKey(scenarioId, targetDate, transfers, injectedKeys);

  const sessionId = randomUUID();
  const queue = initDripQueue(sessionId, scenarioId, transfers as Transfer[]);
  storeDripQueue(queue);

  setState(scenarioId, {
    status: "drip_in_progress",
    targetDate,
    answerKey,
    dripSessionId: sessionId,
    lastRunAt: new Date().toISOString(),
  });

  return NextResponse.json({
    sessionId,
    totalEvents: queue.totalEvents,
    answerKey,
  });
}
