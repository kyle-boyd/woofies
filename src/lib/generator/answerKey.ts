import { DateTime } from "luxon";
import { PARTNERS } from "./config";
import { SCENARIOS } from "./scenarios";
import type { Transfer, AnswerKey, Finding, FtvEvent } from "./types";

const ET = "America/New_York";

function formatET(ms: string | number): string {
  return DateTime.fromMillis(Number(ms), { zone: ET }).toFormat("yyyy-MM-dd HH:mm:ss 'ET'");
}

function getStartEvent(events: FtvEvent[]): FtvEvent | undefined {
  return events.find(e => e.Event === "StartTransfer");
}

function getErrorMessage(events: FtvEvent[]): string | undefined {
  const failTransfer = events.find(e => e.Event === "FailTransfer");
  if (failTransfer) return failTransfer.ERROR_MESSAGE as string;
  const failedDelivery = events.find(e => e.Event === "FailedDelivery");
  if (failedDelivery) return failedDelivery.ErrorMessage as string;
  return undefined;
}

function detectOutcome(events: FtvEvent[]): Finding["outcome"] {
  const hasFailTransfer = events.some(e => e.Event === "FailTransfer");
  const hasFailDelivery = events.some(e => e.Event === "FailedDelivery");
  const hasCompleteTransfer = events.some(e => e.Event === "CompleteTransfer");

  if (hasFailDelivery && hasCompleteTransfer) return "RetrySuccess";
  if (hasFailTransfer) return "FailTransfer";

  const isStalled = !hasFailTransfer && !hasCompleteTransfer;
  if (isStalled) return "Stalled";

  // Check for misroute or slow delivery
  const startDelivery = events.find(e => e.Event === "StartedDelivery");
  const completeDelivery = events.find(e => e.Event === "CompleteDelivery");
  if (startDelivery && completeDelivery) {
    const gapMinutes = (Number(completeDelivery.TIME) - Number(startDelivery.TIME)) / 1000 / 60;
    if (gapMinutes >= 40) return "SlowDelivery";

    const path = completeDelivery.ConsumerPath as string;
    if (path && path.toLowerCase().includes("operations")) return "Misrouted";
  }

  return "FailTransfer";
}

function buildDetails(outcome: Finding["outcome"], events: FtvEvent[]): string {
  switch (outcome) {
    case "FailTransfer": {
      const failDelivery = events.find(e => e.Event === "FailedDelivery");
      const failTransfer = events.find(e => e.Event === "FailTransfer");
      if (failDelivery) {
        return `Delivery failed at ${formatET(failDelivery.TIME as string)}. Error: "${failDelivery.ErrorMessage}". Transfer failed.`;
      }
      if (failTransfer) {
        return `Transfer failed at ${formatET(failTransfer.TIME as string)}. Error: "${failTransfer.ERROR_MESSAGE}".`;
      }
      return "Transfer failed.";
    }
    case "Stalled": {
      const lastEvt = events[events.length - 1];
      return `Last event: ${lastEvt?.Event} at ${formatET(lastEvt?.TIME as string)}. No completion or failure event — transfer appears hung.`;
    }
    case "Misrouted": {
      const delivEvt = events.find(e => e.Event === "CompleteDelivery");
      return `File delivered successfully but to wrong path: ${delivEvt?.ConsumerPath}. Expected delivery to Treasury (/Treasury/Inbox).`;
    }
    case "SlowDelivery": {
      const startD = events.find(e => e.Event === "StartedDelivery");
      const completeD = events.find(e => e.Event === "CompleteDelivery");
      if (startD && completeD) {
        const mins = Math.round((Number(completeD.TIME) - Number(startD.TIME)) / 1000 / 60);
        return `Delivery took ${mins} minutes (normal range: 5–30 seconds). StartedDelivery: ${formatET(startD.TIME as string)}, CompleteDelivery: ${formatET(completeD.TIME as string)}.`;
      }
      return "Delivery was unusually slow (45+ minutes).";
    }
    case "RetrySuccess": {
      const failD = events.find(e => e.Event === "FailedDelivery");
      return `First delivery attempt failed (${failD?.ErrorMessage ?? "unknown error"}). Second attempt succeeded.`;
    }
  }
}

// Look up partner display name from userId
function partnerNameFromUserId(userId: string): string {
  for (const p of Object.values(PARTNERS)) {
    if (p.user_id === userId) return p.name;
  }
  return userId;
}

export function buildAnswerKey(
  scenarioId: number,
  targetDate: string,
  allTransfers: Transfer[],
  injectedKeys: string[]
): AnswerKey {
  const scenarioMeta = SCENARIOS.find(s => s.id === scenarioId);
  const scenarioName = scenarioMeta?.name ?? `Scenario ${scenarioId}`;

  let totalSuccess = 0;
  let totalFailed = 0;
  let totalStalled = 0;

  for (const [, events] of allTransfers) {
    if (events.some(e => e.Event === "CompleteTransfer")) totalSuccess++;
    else if (events.some(e => e.Event === "FailTransfer")) totalFailed++;
    else totalStalled++;
  }

  const injectedSet = new Set(injectedKeys);
  const findings: Finding[] = [];

  for (const [arrivedKey, events] of allTransfers) {
    if (!injectedSet.has(arrivedKey)) continue;

    const startEvt = getStartEvent(events);
    const filename = (startEvt?.ProducerFilename as string) ?? "unknown";
    const partnerUserId = (startEvt?.ProducerUserId as string) ?? "";
    const partner = partnerNameFromUserId(partnerUserId);
    const startTime = startEvt ? formatET(startEvt.TIME as string) : "unknown";
    const errorMsg = getErrorMessage(events);
    const outcome = detectOutcome(events);
    const details = buildDetails(outcome, events);

    let description = "";
    switch (outcome) {
      case "FailTransfer": description = `Transfer failed — ${errorMsg ?? "see error"}`; break;
      case "Stalled": description = "Stalled transfer (no completion event)"; break;
      case "Misrouted": description = "Misrouted delivery — wrong destination"; break;
      case "SlowDelivery": description = "Slow delivery (45+ minutes)"; break;
      case "RetrySuccess": description = "Retry then success"; break;
    }

    findings.push({
      description,
      arrivedfileKey: arrivedKey,
      filename,
      partner,
      startTime,
      outcome,
      errorMessage: errorMsg,
      details,
    });
  }

  return {
    scenarioId,
    scenarioName,
    generatedAt: new Date().toISOString(),
    targetDate,
    totalTransfers: allTransfers.length,
    totalSuccess,
    totalFailed,
    totalStalled,
    findings,
  };
}
