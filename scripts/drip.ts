#!/usr/bin/env node
/**
 * Local drip CLI — submit scenario or day data with realistic timing.
 *
 * Usage:
 *   npm run drip -- --scenario 2 --date 2026-03-20
 *   npm run drip -- --day --date 2026-03-20
 *   npm run drip -- --scenario 4 --date 2026-03-20 --dry-run
 */

import { config } from "dotenv";
import path from "path";

// Load .env.local from project root
config({ path: path.resolve(process.cwd(), ".env.local") });

import { SCENARIOS } from "@/lib/generator/scenarios";
import { generateDay } from "@/lib/generator/dayGenerator";
import { isWeekend } from "@/lib/generator/timing";
import { initDripQueue, popDueEvents, nextScheduledMs } from "@/lib/submission/drip";
import { submitTransfer } from "@/lib/submission/client";
import type { Transfer } from "@/lib/generator/types";

function parseArgs(): { scenario?: number; day: boolean; date: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let scenario: number | undefined;
  let day = false;
  let date = new Date().toISOString().slice(0, 10);
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scenario" && args[i + 1]) {
      scenario = parseInt(args[++i]);
    } else if (args[i] === "--day") {
      day = true;
    } else if (args[i] === "--date" && args[i + 1]) {
      date = args[++i];
    } else if (args[i] === "--dry-run") {
      dryRun = true;
    }
  }

  return { scenario, day, date, dryRun };
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const { scenario, day, date, dryRun } = parseArgs();

  if (!scenario && !day) {
    console.error("Usage: npm run drip -- --scenario N --date YYYY-MM-DD");
    console.error("       npm run drip -- --day --date YYYY-MM-DD");
    process.exit(1);
  }

  let transfers: Transfer[];

  if (scenario) {
    const meta = SCENARIOS.find(s => s.id === scenario);
    if (!meta) {
      console.error(`Unknown scenario ${scenario}. Valid: 1-8`);
      process.exit(1);
    }
    console.log(`Generating scenario ${scenario}: ${meta.name} for ${date}…`);
    const result = meta.fn(date);
    transfers = result.transfers;
    console.log(`  Injected keys: ${result.injectedKeys.length}`);
  } else {
    console.log(`Generating full day for ${date}…`);
    transfers = generateDay(date, 1.0, isWeekend(date));
  }

  console.log(`Generated ${transfers.length} transfers`);

  if (dryRun) {
    let totalEvents = 0;
    for (const [, evts] of transfers) totalEvents += evts.length;
    console.log(`--dry-run: total events would be ${totalEvents}. Skipping submission.`);
    return;
  }

  const queue = initDripQueue("cli", 0, transfers);
  console.log(`Drip queue: ${queue.totalEvents} events`);
  console.log(`Estimated time: ~${Math.ceil(queue.totalEvents * 1.5 / 60)} minutes`);
  console.log("Starting drip… (Ctrl+C to stop)\n");

  let submitted = 0;
  const start = Date.now();

  while (queue.cursor < queue.totalEvents) {
    const due = popDueEvents(queue, Date.now(), 5);

    if (due.length === 0) {
      const nextMs = nextScheduledMs(queue);
      if (nextMs) {
        const waitMs = Math.max(0, nextMs - Date.now());
        if (waitMs > 0) await delay(Math.min(waitMs, 500));
      }
      continue;
    }

    for (const dripEvent of due) {
      try {
        await submitTransfer([dripEvent.event]);
        submitted++;
        const pct = Math.round((queue.cursor / queue.totalEvents) * 100);
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ${submitted} events (${pct}%) — ${elapsed}s`);
      } catch (err) {
        console.error(`\n  Error: ${err}`);
      }
    }

    await delay(30);
  }

  console.log(`\n\nDone! Submitted ${submitted} events in ${Math.round((Date.now() - start) / 1000)}s`);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
