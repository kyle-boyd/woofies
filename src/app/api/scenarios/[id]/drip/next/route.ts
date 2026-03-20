import { NextRequest, NextResponse } from "next/server";
import { getDripQueue, getState, setState } from "@/lib/state/store";
import { submitTransfer } from "@/lib/submission/client";
import { popDueEvents, nextScheduledMs } from "@/lib/submission/drip";
import type { FtvEvent } from "@/lib/generator/types";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenarioId = Number(id);
  const body = await req.json().catch(() => ({}));
  const { sessionId } = body as { sessionId: string };

  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const queue = getDripQueue(sessionId);
  if (!queue) return NextResponse.json({ error: "Drip session not found or expired" }, { status: 404 });

  const dueEvents = popDueEvents(queue, Date.now(), 20);

  let submitted = 0;
  const errors: string[] = [];

  // Group due events by arrivedFileKey and submit each transfer atomically
  // (we only submit a "transfer batch" of events for the same key)
  // For simplicity: submit each event individually (Syncrofy accepts single-event arrays too)
  for (const dripEvent of dueEvents) {
    try {
      await submitTransfer([dripEvent.event] as FtvEvent[]);
      submitted++;
    } catch (err) {
      errors.push(`${dripEvent.arrivedFileKey}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (submitted < dueEvents.length) {
      await delay(30);
    }
  }

  const remaining = queue.totalEvents - queue.cursor;
  const done = remaining === 0;
  const nextAt = nextScheduledMs(queue);

  if (done) {
    queue.status = "complete";
    const state = getState(scenarioId);
    if (state && state.status === "drip_in_progress") {
      setState(scenarioId, { status: "submitted" });
    }
  }

  return NextResponse.json({ submitted, errors, remaining, done, nextAt });
}
