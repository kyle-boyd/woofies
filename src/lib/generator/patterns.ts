import { DateTime } from "luxon";
import { PARTNERS } from "./config";
import { generateKey, generateDeliveryKey, advanceTime, randInt } from "./keys";
import { generateFilename } from "./filenames";
import {
  buildStartTransfer,
  buildProcessDetails,
  buildProcessing,
  buildStartedDelivery,
  buildCompleteDelivery,
  buildFailedDelivery,
  buildCompleteTransfer,
  buildFailTransfer,
} from "./events";
import { randomProcessingSteps } from "./processing";
import type { FtvEvent, GeneratorContext, Transfer } from "./types";
import type { EventSource } from "./config";
import { pickEventSource } from "./keys";

const RETRY_ERRORS = [
  "Connection timeout",
  "Connection refused",
  "Remote host not responding",
];

// Helper: add processing steps (ZIP/PGP go as ProcessDetails, others as PROCESSING)
function addProcessingSteps(
  events: FtvEvent[],
  dt: DateTime,
  arrivedKey: string,
  steps: [FtvEvent[], DateTime]
): DateTime {
  return steps[1];
}

// -----------------------------------------------------------------------
// Pattern 1: Happy path — ~85% of transfers
// -----------------------------------------------------------------------
export function patternHappyPath(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number,
  destKey?: string
): Transfer {
  const p = PARTNERS[partnerKey];
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "SUCCESS", source));

  const [procEvents, afterProc] = randomProcessingSteps(t, arrivedKey, filename, source);
  events.push(...procEvents);
  t = afterProc;

  t = advanceTime(t, 2, 5);
  const deliveryKey = generateDeliveryKey(t, ctx);
  events.push(buildStartedDelivery(t, arrivedKey, deliveryKey, partnerKey, filename, fileSize, destKey, source));

  t = advanceTime(t, 5, 30);
  events.push(buildCompleteDelivery(t, arrivedKey, deliveryKey, partnerKey, filename, destKey, source));

  t = advanceTime(t, 1, 3);
  events.push(buildCompleteTransfer(t, arrivedKey, "Transfer Successful", source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 2: Retry then success — ~5%
// -----------------------------------------------------------------------
export function patternRetrySuccess(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number,
  destKey?: string
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "Retry", source));

  const [procEvents, afterProc] = randomProcessingSteps(t, arrivedKey, filename, source);
  events.push(...procEvents);
  t = afterProc;

  // First delivery attempt — fails
  t = advanceTime(t, 2, 5);
  const deliveryKey1 = generateDeliveryKey(t, ctx);
  events.push(buildStartedDelivery(t, arrivedKey, deliveryKey1, partnerKey, filename, fileSize, destKey, source));
  t = advanceTime(t, 5, 30);
  const errMsg = RETRY_ERRORS[Math.floor(Math.random() * RETRY_ERRORS.length)];
  events.push(buildFailedDelivery(t, arrivedKey, deliveryKey1, partnerKey, filename, errMsg, destKey, source));

  // Retry after 60-300 seconds
  t = advanceTime(t, 60, 300);
  const deliveryKey2 = generateDeliveryKey(t, ctx);
  events.push(buildStartedDelivery(t, arrivedKey, deliveryKey2, partnerKey, filename, fileSize, destKey, source));
  t = advanceTime(t, 5, 30);
  events.push(buildCompleteDelivery(t, arrivedKey, deliveryKey2, partnerKey, filename, destKey, source));

  t = advanceTime(t, 1, 3);
  events.push(buildCompleteTransfer(t, arrivedKey, "Transfer Successful", source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 3: PGP decrypt failure
// -----------------------------------------------------------------------
export function patternPgpFailure(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number,
  errorVariant = "invalid key"
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "SUCCESS", source));

  // ZIP step if .zip.pgp
  if (filename.endsWith(".zip.pgp") || filename.endsWith(".zip")) {
    t = advanceTime(t, 1, 3);
    events.push(buildProcessDetails(t, arrivedKey, "ZIP", filename.replace(".pgp", ""), source));
  }

  // PGP decrypt fails
  t = advanceTime(t, 1, 3);
  events.push(buildProcessing(t, arrivedKey, "PGP",
    filename.replace(".pgp", "").replace(".zip", ""),
    "Failed", `Decrypt failed: ${errorVariant}`, source));

  t = advanceTime(t, 1, 2);
  events.push(buildFailTransfer(t, arrivedKey, "Processing failure: PGP decrypt", source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 4: Staging/delivery failure
// -----------------------------------------------------------------------
export function patternStagingFailure(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number,
  stagingPath?: string
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }
  const path = stagingPath ?? `/staging/${partnerKey}/outbound`;

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "SUCCESS", source));

  const [procEvents, afterProc] = randomProcessingSteps(t, arrivedKey, filename, source);
  events.push(...procEvents);
  t = afterProc;

  t = advanceTime(t, 2, 5);
  const deliveryKey = generateDeliveryKey(t, ctx);
  events.push(buildStartedDelivery(t, arrivedKey, deliveryKey, partnerKey, filename, fileSize, undefined, source));

  t = advanceTime(t, 5, 15);
  events.push(buildFailedDelivery(t, arrivedKey, deliveryKey, partnerKey, filename,
    `Staging area full: ${path} — disk space exceeded`, undefined, source));

  t = advanceTime(t, 1, 3);
  events.push(buildFailTransfer(t, arrivedKey, "Delivery failed: staging error", source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 5: Partial file received
// -----------------------------------------------------------------------
export function patternPartialFile(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  expectedSize?: number,
  receivedSize?: number
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename) {
    const [fn] = generateFilename(partnerKey, dateStr, ctx);
    filename = fn;
  }
  const exp = expectedSize ?? randInt(200_000, 5_000_000);
  const rec = receivedSize ?? randInt(Math.floor(exp / 5), Math.floor(exp / 2));

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, exp, "SUCCESS", source));

  t = advanceTime(t, 1, 3);
  events.push(buildProcessDetails(t, arrivedKey, "Validate Checksum", filename, source));

  t = advanceTime(t, 1, 2);
  events.push(buildFailTransfer(t, arrivedKey,
    `Partial file received: expected ${exp} bytes, received ${rec} bytes`, source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 6: Virus scan failure
// -----------------------------------------------------------------------
export function patternVirusScan(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number
): Transfer {
  const p = PARTNERS[partnerKey];
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "SUCCESS", source));

  // ZIP + PGP if applicable
  if (p.pgp && filename.endsWith(".pgp")) {
    t = advanceTime(t, 1, 3);
    events.push(buildProcessDetails(t, arrivedKey, "ZIP", filename.replace(".pgp", ""), source));
    t = advanceTime(t, 1, 3);
    events.push(buildProcessDetails(t, arrivedKey, "PGP", filename.replace(".zip.pgp", ""), source));
  }

  t = advanceTime(t, 1, 3);
  events.push(buildProcessing(t, arrivedKey, "Virus Scan", filename,
    "Failed", "Threat detected: Trojan.GenericKD", source));

  t = advanceTime(t, 1, 2);
  events.push(buildFailTransfer(t, arrivedKey, "File quarantined — virus scan failure", source));

  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 7: Stalled transfer
// -----------------------------------------------------------------------
export function patternStalled(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "InProgress", source));

  t = advanceTime(t, 1, 3);
  const layer = filename.endsWith(".zip") || filename.endsWith(".zip.pgp") ? "ZIP" : "Normalize Data";
  events.push(buildProcessDetails(t, arrivedKey, layer, filename, source));

  // No further events — transfer appears stalled
  return [arrivedKey, events];
}

// -----------------------------------------------------------------------
// Pattern 8: Slow delivery
// -----------------------------------------------------------------------
export function patternSlowDelivery(
  partnerKey: string,
  startTime: DateTime,
  ctx: GeneratorContext,
  filename?: string,
  fileSize?: number,
  delayMinutes = 45,
  destKey?: string
): Transfer {
  const dateStr = startTime.toFormat("yyyyMMdd");
  if (!filename || !fileSize) {
    const [fn, fs] = generateFilename(partnerKey, dateStr, ctx);
    filename = filename ?? fn;
    fileSize = fileSize ?? fs;
  }

  const source: EventSource = pickEventSource();
  const arrivedKey = generateKey(startTime, ctx);
  const events: FtvEvent[] = [];
  let t = startTime;

  events.push(buildStartTransfer(partnerKey, t, arrivedKey, filename, fileSize, "SUCCESS", source));

  const [procEvents, afterProc] = randomProcessingSteps(t, arrivedKey, filename, source);
  events.push(...procEvents);
  t = afterProc;

  t = advanceTime(t, 2, 5);
  const deliveryKey = generateDeliveryKey(t, ctx);
  events.push(buildStartedDelivery(t, arrivedKey, deliveryKey, partnerKey, filename, fileSize, destKey, source));

  // Long delay
  t = t.plus({ minutes: delayMinutes });
  events.push(buildCompleteDelivery(t, arrivedKey, deliveryKey, partnerKey, filename, destKey, source));

  t = advanceTime(t, 1, 3);
  events.push(buildCompleteTransfer(t, arrivedKey, "Transfer Successful", source));

  return [arrivedKey, events];
}
