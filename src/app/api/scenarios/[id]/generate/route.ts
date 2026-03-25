import { NextRequest, NextResponse } from "next/server";
import { SCENARIOS } from "@/lib/generator/scenarios";
import { buildAnswerKey } from "@/lib/generator/answerKey";
import { getState, setState } from "@/lib/state/store";

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

  // Generate transfers
  const { transfers, injectedKeys, dynamicText, answerKeyNotes } = scenarioMeta.fn(targetDate);

  // Build answer key
  const answerKey = buildAnswerKey(scenarioId, targetDate, transfers, injectedKeys, answerKeyNotes);

  // Update state
  setState(scenarioId, {
    status: "submitted",
    targetDate,
    answerKey,
    lastRunAt: new Date().toISOString(),
    dynamicText: dynamicText ?? null,
  });

  return NextResponse.json({
    transfers,
    total: transfers.length,
    answerKey,
    dynamicText: dynamicText ?? null,
  });
}
