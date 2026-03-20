import { NextRequest, NextResponse } from "next/server";
import { makeContext } from "@/lib/generator/types";
import { generateFilename } from "@/lib/generator/filenames";
import { randomBusinessTime } from "@/lib/generator/timing";
import {
  patternHappyPath,
  patternRetrySuccess,
  patternPgpFailure,
  patternStagingFailure,
  patternPartialFile,
  patternVirusScan,
  patternStalled,
  patternSlowDelivery,
} from "@/lib/generator/patterns";
import { PARTNERS } from "@/lib/generator/config";
import type { Transfer } from "@/lib/generator/types";

const PATTERN_FNS: Record<string, (pk: string, dt: ReturnType<typeof randomBusinessTime>, ctx: ReturnType<typeof makeContext>) => Transfer> = {
  happy_path: patternHappyPath,
  retry_success: patternRetrySuccess,
  pgp_failure: patternPgpFailure,
  staging_failure: patternStagingFailure,
  partial_file: patternPartialFile,
  virus_scan: patternVirusScan,
  stalled: patternStalled,
  slow_delivery: patternSlowDelivery,
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const {
    partnerKey = "meridian",
    pattern = "happy_path",
    date = new Date().toISOString().slice(0, 10),
    submit = false,
  } = body as {
    partnerKey?: string;
    pattern?: string;
    date?: string;
    submit?: boolean;
  };

  if (!PARTNERS[partnerKey]) {
    return NextResponse.json({ error: `Unknown partner: ${partnerKey}` }, { status: 400 });
  }
  const patternFn = PATTERN_FNS[pattern];
  if (!patternFn) {
    return NextResponse.json({ error: `Unknown pattern: ${pattern}` }, { status: 400 });
  }

  const ctx = makeContext();
  const dateYMD = date.replace(/-/g, "");
  const startTime = randomBusinessTime(date);
  const [arrivedKey, events] = patternFn(partnerKey, startTime, ctx);

  let submissionResult: { status: number; body: string; ok: boolean } | null = null;

  if (submit) {
    const endpoint = process.env.SYNCROFY_ENDPOINT;
    const apiKey = process.env.SYNCROFY_API_KEY;
    const authHeader = process.env.SYNCROFY_AUTH_HEADER ?? "token";

    if (!endpoint || !apiKey) {
      return NextResponse.json({ error: "SYNCROFY_ENDPOINT and SYNCROFY_API_KEY not configured" }, { status: 500 });
    }

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", [authHeader]: apiKey },
        body: JSON.stringify(events),
      });
      const responseBody = await res.text();
      submissionResult = { status: res.status, body: responseBody, ok: res.ok };
    } catch (err) {
      submissionResult = {
        status: 0,
        body: err instanceof Error ? err.message : String(err),
        ok: false,
      };
    }
  }

  return NextResponse.json({
    arrivedKey,
    partnerKey,
    partnerName: PARTNERS[partnerKey].name,
    pattern,
    date,
    startTime: startTime.toISO(),
    eventCount: events.length,
    events,
    submissionResult,
  });
}
