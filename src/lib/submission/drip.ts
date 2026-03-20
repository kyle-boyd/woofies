import type { FtvEvent, Transfer } from "@/lib/generator/types";

export interface DripEvent {
  arrivedFileKey: string;
  event: FtvEvent;
  scheduledMs: number; // wall-clock millisecond when this event should be submitted
}

export interface DripQueue {
  sessionId: string;
  scenarioId: number;
  events: DripEvent[];
  cursor: number; // index of next event to submit
  totalEvents: number;
  status: "pending" | "running" | "complete";
}

// Build a DripQueue from transfers with fixed inter-event gaps.
// Events are assigned wall-clock times starting from `startMs` (default: now).
// Within each transfer: 1-2s between events.
// Between transfers: 2-4s gap after the last event of one before the first of the next.
export function initDripQueue(
  sessionId: string,
  scenarioId: number,
  transfers: Transfer[],
  startMs = Date.now()
): DripQueue {
  // Flatten and sort all events by their simulated TIME (earliest first)
  const flat: Array<{ arrivedFileKey: string; event: FtvEvent; simulatedMs: number }> = [];

  for (const [arrivedFileKey, events] of transfers) {
    for (const event of events) {
      flat.push({ arrivedFileKey, event, simulatedMs: Number(event.TIME) });
    }
  }

  flat.sort((a, b) => a.simulatedMs - b.simulatedMs);

  // Assign real wall-clock scheduledMs with fixed gaps
  const INTRA_TRANSFER_GAP_MS = 1500; // 1.5s between events in same transfer
  const INTER_TRANSFER_GAP_MS = 3000; // 3s between last event of one transfer and first of next

  const scheduled: DripEvent[] = [];
  let currentMs = startMs;
  let prevArrivedKey: string | null = null;

  for (const item of flat) {
    const isNewTransfer = item.arrivedFileKey !== prevArrivedKey;
    if (prevArrivedKey !== null) {
      currentMs += isNewTransfer ? INTER_TRANSFER_GAP_MS : INTRA_TRANSFER_GAP_MS;
    }
    scheduled.push({
      arrivedFileKey: item.arrivedFileKey,
      event: item.event,
      scheduledMs: currentMs,
    });
    prevArrivedKey = item.arrivedFileKey;
  }

  return {
    sessionId,
    scenarioId,
    events: scheduled,
    cursor: 0,
    totalEvents: scheduled.length,
    status: "pending",
  };
}

// Pop all events that are due (scheduledMs <= nowMs), up to maxBatch
export function popDueEvents(
  queue: DripQueue,
  nowMs = Date.now(),
  maxBatch = 20
): DripEvent[] {
  const due: DripEvent[] = [];
  while (
    queue.cursor < queue.events.length &&
    queue.events[queue.cursor].scheduledMs <= nowMs &&
    due.length < maxBatch
  ) {
    due.push(queue.events[queue.cursor]);
    queue.cursor++;
  }
  return due;
}

// Returns the wall-clock ms of the next scheduled event (or null if complete)
export function nextScheduledMs(queue: DripQueue): number | null {
  if (queue.cursor >= queue.events.length) return null;
  return queue.events[queue.cursor].scheduledMs;
}
