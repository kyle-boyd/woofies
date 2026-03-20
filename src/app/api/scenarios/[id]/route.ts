import { NextRequest, NextResponse } from "next/server";
import { getState, setState, freezeScenario, unfreezeScenario } from "@/lib/state/store";

export function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return params.then(({ id }) => {
    const state = getState(Number(id));
    if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(state);
  });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenarioId = Number(id);
  const state = getState(scenarioId);
  if (!state) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  if (typeof body.frozen === "boolean") {
    if (body.frozen) {
      freezeScenario(scenarioId);
    } else {
      unfreezeScenario(scenarioId);
    }
  }

  if (typeof body.targetDate === "string") {
    setState(scenarioId, { targetDate: body.targetDate });
  }

  // Client rehydration: accept full state patch for localStorage → server sync
  if (body.rehydrate && typeof body.status === "string") {
    setState(scenarioId, {
      status: body.status,
      targetDate: body.targetDate ?? null,
      answerKey: body.answerKey ?? null,
      frozen: body.frozen ?? false,
      dripSessionId: body.dripSessionId ?? null,
      lastRunAt: body.lastRunAt ?? null,
    });
  }

  return NextResponse.json(getState(scenarioId));
}
