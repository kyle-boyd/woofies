import { NextRequest, NextResponse } from "next/server";
import { getSubmissionQueue, advanceSubmissionCursor, deleteSubmissionQueue } from "@/lib/state/store";
import { submitTransfer } from "@/lib/submission/client";
import type { FtvEvent } from "@/lib/generator/types";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  await params; // id not needed here, we use sessionId
  const body = await req.json().catch(() => ({}));
  const { sessionId, batchSize = 10 } = body as { sessionId: string; batchSize?: number };

  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const queue = getSubmissionQueue(sessionId);
  if (!queue) return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });

  const { transfers, cursor } = queue;
  const end = Math.min(cursor + batchSize, transfers.length);
  const batch = transfers.slice(cursor, end);

  let submitted = 0;
  const errors: string[] = [];

  for (const [key, events] of batch) {
    try {
      await submitTransfer(events as FtvEvent[]);
      submitted++;
    } catch (err) {
      errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (submitted < batch.length) {
      await delay(50 + Math.random() * 50);
    }
  }

  advanceSubmissionCursor(sessionId, batch.length);
  const newCursor = cursor + batch.length;
  const remaining = transfers.length - newCursor;
  const done = remaining === 0;

  if (done) deleteSubmissionQueue(sessionId);

  return NextResponse.json({ submitted, errors, remaining, done, total: transfers.length });
}
