import { DateTime } from "luxon";
import { randomBytes } from "crypto";
import { advanceTime } from "./keys";
import { buildProcessDetails, buildProcessing } from "./events";
import type { FtvEvent } from "./types";
import type { EventSource } from "./config";

const PROCESSING_STEPS = [
  "Normalize Data",
  "Generate Checksum",
  "Validate Checksum",
  "Store Checksum",
  "Virus Scan",
  "Add to Archive",
  "Validate Archive",
] as const;

const STEP_ORDER = [
  "Normalize Data", "Generate Checksum", "Validate Checksum", "Store Checksum",
  "Add to Archive", "Validate Archive", "Virus Scan",
] as const;

function randomChecksum(): string {
  return randomBytes(16).toString("hex");
}

// Generate 2-5 random processing step events, returning [events, finalDt].
// Matches the Python reference: emits ProcessDetails for PGP/ZIP layers first,
// then PROCESSING events for the remaining steps.
export function randomProcessingSteps(
  startDt: DateTime,
  arrivedKey: string,
  filename: string,
  source?: EventSource
): [FtvEvent[], DateTime] {
  const events: FtvEvent[] = [];
  let dt = startDt;

  // Emit ProcessDetails for PGP/ZIP layers (matches Python logic)
  if (filename.endsWith(".pgp")) {
    const inner = filename.replace(".pgp", "");
    dt = advanceTime(dt, 1, 3);
    events.push(buildProcessDetails(dt, arrivedKey, "PGP", inner, source));
    if (inner.endsWith(".zip")) {
      dt = advanceTime(dt, 1, 3);
      events.push(buildProcessDetails(dt, arrivedKey, "ZIP", inner.replace(".zip", ""), source));
    }
  } else if (filename.endsWith(".zip")) {
    dt = advanceTime(dt, 1, 3);
    events.push(buildProcessDetails(dt, arrivedKey, "ZIP", filename.replace(".zip", ""), source));
  }

  // Pick 2-5 random PROCESSING steps in logical order
  const count = 2 + Math.floor(Math.random() * 4);
  const pool = [...PROCESSING_STEPS].sort(() => Math.random() - 0.5).slice(0, count);
  const ordered = STEP_ORDER.filter(s => pool.includes(s));

  const baseName = filename.replace(".pgp", "").replace(".zip", "");
  for (const step of ordered) {
    dt = advanceTime(dt, 1, 3);
    let layerFilename = baseName;
    if (step === "Generate Checksum" || step === "Validate Checksum" || step === "Store Checksum") {
      layerFilename = `${baseName}.${randomChecksum().slice(0, 8)}.chk`;
    }
    const msg = step === "Generate Checksum" ? `Checksum: ${randomChecksum().slice(0, 8)}` : "";
    events.push(buildProcessing(dt, arrivedKey, step, layerFilename, "Success", msg, source));
  }

  return [events, dt];
}
