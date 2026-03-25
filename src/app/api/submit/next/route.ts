import { NextRequest, NextResponse } from "next/server";
import { submitTransfer } from "@/lib/submission/client";
import type { FtvEvent } from "@/lib/generator/types";

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// Stateless submit endpoint — caller sends the batch of transfers directly.
// No server-side session required.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { transfers } = body as { transfers: Array<[string, FtvEvent[]]> };

  if (!transfers?.length) return NextResponse.json({ submitted: 0, errors: [] });

  let submitted = 0;
  const errors: string[] = [];

  for (const [key, events] of transfers) {
    try {
      await submitTransfer(events as FtvEvent[]);
      submitted++;
    } catch (err) {
      errors.push(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (submitted < transfers.length) {
      await delay(50 + Math.random() * 50);
    }
  }

  return NextResponse.json({ submitted, errors });
}
