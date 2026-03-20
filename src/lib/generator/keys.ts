import { DateTime } from "luxon";
import { EVENT_SOURCES, type EventSource } from "./config";
import type { GeneratorContext } from "./types";

const ET = "America/New_York";

// Generate ARRIVEDFILE_KEY: YYYYMMDDHHmmSSffffffNNN
// ffffffNNN = 6-digit fractional seconds (000000) + 3-digit counter
export function generateKey(dt: DateTime, ctx: GeneratorContext): string {
  ctx.keyCounter = (ctx.keyCounter + 1) % 1000;
  const base = dt.setZone(ET).toFormat("yyyyMMddHHmmss");
  const frac = String(100000 + Math.floor(Math.random() * 900000));
  const seq = String(ctx.keyCounter).padStart(3, "0");
  return `${base}${frac}${seq}`;
}

// Generate a new delivery EVENT_KEY (different from ARRIVEDFILE_KEY)
export function generateDeliveryKey(dt: DateTime, ctx: GeneratorContext): string {
  ctx.keyCounter = (ctx.keyCounter + 1) % 1000;
  const base = dt.setZone(ET).toFormat("yyyyMMddHHmmss");
  const frac = String(100000 + Math.floor(Math.random() * 900000));
  const seq = String(ctx.keyCounter).padStart(3, "0");
  return `${base}${frac}${seq}`;
}

// Unix millisecond timestamp as a string (integer, matching Python's int(dt.timestamp() * 1000))
export function msTimestamp(dt: DateTime): string {
  return String(Math.floor(dt.toMillis()));
}

// Advance a DateTime by a random number of seconds in [minSec, maxSec]
export function advanceTime(dt: DateTime, minSec: number, maxSec: number): DateTime {
  const seconds = minSec + Math.random() * (maxSec - minSec);
  return dt.plus({ seconds });
}

// Pick a random event source — call once per transfer, reuse across all events
export function pickEventSource(): EventSource {
  return EVENT_SOURCES[Math.floor(Math.random() * EVENT_SOURCES.length)];
}

// Random integer in [min, max] inclusive
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Weighted random choice
export function weightedChoice<T>(items: T[], weights: number[]): T {
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

// Format a DateTime as a human-readable ET timestamp
export function formatET(dt: DateTime): string {
  return dt.setZone(ET).toFormat("yyyy-MM-dd HH:mm:ss 'ET'");
}
