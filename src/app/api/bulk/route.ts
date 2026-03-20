import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { generateDay } from "@/lib/generator/dayGenerator";
import { isWeekend } from "@/lib/generator/timing";
import { storeSubmissionQueue } from "@/lib/state/store";
import { DateTime } from "luxon";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { mode, targetDate } = body as { mode: "day" | "week"; targetDate: string };

  if (!targetDate) return NextResponse.json({ error: "targetDate required" }, { status: 400 });

  const dates: string[] = [];
  if (mode === "week") {
    const start = DateTime.fromISO(targetDate, { zone: "America/New_York" });
    for (let i = 0; i < 5; i++) {
      const d = start.plus({ days: i });
      if (d.weekday <= 5) dates.push(d.toISODate()!);
    }
  } else {
    dates.push(targetDate);
  }

  const allTransfers: Array<[string, unknown[]]> = [];
  for (const d of dates) {
    const day = generateDay(d, 1.0, isWeekend(d));
    allTransfers.push(...(day as Array<[string, unknown[]]>));
  }

  const sessionId = randomUUID();
  storeSubmissionQueue(sessionId, allTransfers);

  return NextResponse.json({
    sessionId,
    total: allTransfers.length,
    dates,
  });
}
