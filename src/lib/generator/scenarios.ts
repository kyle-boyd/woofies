import { DateTime } from "luxon";
import { PARTNERS } from "./config";
import { makeContext } from "./types";
import { generateSortedTimes, specificTime, weekendDates, isWeekend } from "./timing";
import { generateFilename } from "./filenames";
import { generateKey, generateDeliveryKey, advanceTime, randInt, pickEventSource } from "./keys";
import {
  buildStartTransfer, buildProcessing, buildStartedDelivery,
  buildFailedDelivery, buildFailTransfer,
} from "./events";
import { randomProcessingSteps } from "./processing";
import { generateDay } from "./dayGenerator";
import {
  patternHappyPath,
  patternRetrySuccess,
  patternPgpFailure,
  patternStagingFailure,
  patternPartialFile,
  patternVirusScan,
  patternStalled,
  patternSlowDelivery,
} from "./patterns";
import type { Transfer, ScenarioResult, GeneratorContext } from "./types";

const ET = "America/New_York";

// -----------------------------------------------------------------------
// Scenario 1: Monday Morning Triage
// -----------------------------------------------------------------------
export function scenario1(dateStr: string): ScenarioResult {
  const c = makeContext();
  const [saturdayStr, sundayStr] = weekendDates(dateStr);
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Weekend traffic for both days
  for (const d of [saturdayStr, sundayStr]) {
    transfers.push(...generateDay(d, 1.0, true, c));
  }

  // 1. Staging failure from Lakeshore (Saturday)
  const t1 = specificTime(saturdayStr, 10 + randInt(0, 5), randInt(0, 59));
  const [key1, evts1] = patternStagingFailure("lakeshore", t1, c, undefined, undefined, "/staging/lakeshore/outbound");
  transfers.push([key1, evts1]);
  injectedKeys.push(key1);

  // 2. Partial file from Meridian (Sunday)
  const t2 = specificTime(sundayStr, 9 + randInt(0, 4), randInt(0, 59));
  const [key2, evts2] = patternPartialFile("meridian", t2, c);
  transfers.push([key2, evts2]);
  injectedKeys.push(key2);

  // 3. Delivery failure from Evergreen (Sunday)
  const t3 = specificTime(sundayStr, 11 + randInt(0, 5), randInt(0, 59));
  const dateForFilename = sundayStr.replace(/-/g, "");
  const [fn3] = generateFilename("evergreen", dateForFilename, c);
  const [key3, evts3] = patternStagingFailure("evergreen", t3, c, fn3);
  transfers.push([key3, evts3]);
  injectedKeys.push(key3);

  // 4. Stalled Atlas Payroll (Sunday, 2+ hours before "now")
  const t4 = specificTime(sundayStr, 8 + randInt(0, 5), randInt(0, 59));
  const [key4, evts4] = patternStalled("atlas", t4, c);
  transfers.push([key4, evts4]);
  injectedKeys.push(key4);

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 2: PGP Key Rotation Fallout
// -----------------------------------------------------------------------
export function scenario2(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Normal background traffic (morning only, ~1/3 of daily)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    const [lo, hi] = partner.volume_range;
    const count = Math.max(1, randInt(Math.floor(lo / 3), Math.floor(hi / 3)));
    // Times between 6-12 AM only
    const times = generateSortedTimes(dateStr, count).filter(t => {
      const h = t.setZone(ET).hour;
      return h >= 6 && h <= 12;
    });
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // PGP failures from Meridian (8-12)
  const meridianCount = randInt(8, 12);
  const meridianTimes = generateSortedTimes(dateStr, meridianCount).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 6 && h <= 12;
  }).slice(0, meridianCount);

  for (let i = 0; i < meridianTimes.length; i++) {
    const variant = i === 0 ? "corrupted input data" : "invalid key";
    const [key, evts] = patternPgpFailure("meridian", meridianTimes[i], c, undefined, undefined, variant);
    transfers.push([key, evts]);
    injectedKeys.push(key);
  }

  // PGP failures from John Deere (4-6)
  const jdeereCount = randInt(4, 6);
  const jdeereTimes = generateSortedTimes(dateStr, jdeereCount).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 6 && h <= 12;
  }).slice(0, jdeereCount);

  for (const t of jdeereTimes) {
    const [key, evts] = patternPgpFailure("jdeere", t, c, undefined, undefined, "invalid key");
    transfers.push([key, evts]);
    injectedKeys.push(key);
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 3: New Partner Onboarding
// -----------------------------------------------------------------------
export function scenario3(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Normal background from all partners except Lakeshore
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === "lakeshore") continue;
    const [lo, hi] = partner.volume_range;
    const count = randInt(lo, hi);
    const times = generateSortedTimes(dateStr, count);
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // Lakeshore: 8-10 transfers
  const lakeCount = randInt(8, 10);
  const lakeTimes = generateSortedTimes(dateStr, lakeCount);

  for (let i = 0; i < lakeCount; i++) {
    const t = lakeTimes[i];
    if (i === lakeCount - 2) {
      // Misrouted: delivers to Operations instead of Treasury
      const [key, evts] = patternHappyPath("lakeshore", t, c, undefined, undefined, "operations");
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else if (i === lakeCount - 1) {
      // Slow delivery
      const [key, evts] = patternSlowDelivery("lakeshore", t, c, undefined, undefined, 45);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else {
      transfers.push(patternHappyPath("lakeshore", t, c));
    }
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 4: Where's the Settlement File?
// -----------------------------------------------------------------------
export function scenario4(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];
  const dateYMD = dateStr.replace(/-/g, "");

  // Normal background (afternoon only, skip Meridian)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === "meridian") continue;
    const [lo, hi] = partner.volume_range;
    const count = Math.max(1, randInt(Math.floor(lo / 3), Math.floor(hi / 3)));
    const times = generateSortedTimes(dateStr, count).filter(t => {
      const h = t.setZone(ET).hour;
      return h >= 12 && h <= 17;
    });
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // 5 Meridian settlement files — first 4 succeed, 5th fails
  const settlementTimes = generateSortedTimes(dateStr, 5).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 12 && h <= 17;
  }).slice(0, 5);

  // Ensure we have exactly 5 times, pad if needed
  while (settlementTimes.length < 5) {
    settlementTimes.push(specificTime(dateStr, 13 + settlementTimes.length, randInt(0, 59)));
  }

  for (let i = 0; i < 5; i++) {
    const fn = `settlement_${dateYMD}_${String(i + 1).padStart(3, "0")}.dat`;
    const t = settlementTimes[i];
    if (i < 4) {
      transfers.push(patternHappyPath("meridian", t, c, fn));
    } else {
      const [key, evts] = patternStagingFailure("meridian", t, c, fn, undefined, "/staging/meridian/outbound");
      transfers.push([key, evts]);
      injectedKeys.push(key);
    }
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 5: End-of-Quarter Regulatory Batch
// -----------------------------------------------------------------------
export function scenario5(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];
  const dateYMD = dateStr.replace(/-/g, "");

  // Normal background traffic (afternoon, skip fedline)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === "fedline") continue;
    const [lo, hi] = partner.volume_range;
    const count = Math.max(1, randInt(Math.floor(lo / 4), Math.floor(hi / 4)));
    const times = generateSortedTimes(dateStr, count).filter(t => {
      const h = t.setZone(ET).hour;
      return h >= 13 && h <= 17;
    });
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // 12 regulatory files
  const regFiles: string[] = [];
  for (const rtype of ["call_report", "fr2900", "ffiec009"]) {
    for (let seq = 1; seq <= 4; seq++) {
      regFiles.push(`reg_${rtype}_${dateYMD}.dat`);
    }
  }

  // Shuffle
  for (let i = regFiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [regFiles[i], regFiles[j]] = [regFiles[j], regFiles[i]];
  }

  // 11 times between 1-4 PM, 1 late at 4:15 PM
  const regTimes = generateSortedTimes(dateStr, 11).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 13 && h <= 16;
  }).slice(0, 11);
  while (regTimes.length < 11) {
    regTimes.push(specificTime(dateStr, 13 + regTimes.length % 3, randInt(0, 59)));
  }

  const lateTime = specificTime(dateStr, 16, 15, randInt(0, 59));

  for (let i = 0; i < regFiles.length; i++) {
    const fn = regFiles[i];
    if (i === 0) {
      // Retry then success
      const [key, evts] = patternRetrySuccess("fedline", regTimes[0], c, fn);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else if (i === 1) {
      // Permanent failure: FailedDelivery with rejection error
      const t = regTimes[1];
      const source = pickEventSource();
      const arrivedKey = generateKey(t, c);
      const evts = [];
      const [, fileSize] = generateFilename("fedline", dateYMD, c);

      let curr = t;
      evts.push(buildStartTransfer("fedline", curr, arrivedKey, fn, fileSize, "SUCCESS", source));

      const [procEvts, afterProc] = randomProcessingSteps(curr, arrivedKey, fn, source);
      evts.push(...procEvts);
      curr = afterProc;

      curr = advanceTime(curr, 2, 5);
      const dk = generateDeliveryKey(curr, c);
      evts.push(buildStartedDelivery(curr, arrivedKey, dk, "fedline", fn, fileSize, undefined, source));
      curr = advanceTime(curr, 10, 30);
      evts.push(buildFailedDelivery(curr, arrivedKey, dk, "fedline", fn,
        "Remote endpoint rejected: invalid submission format", undefined, source));
      curr = advanceTime(curr, 1, 3);
      evts.push(buildFailTransfer(curr, arrivedKey,
        "Delivery failed: endpoint rejected submission", source));

      transfers.push([arrivedKey, evts]);
      injectedKeys.push(arrivedKey);
    } else if (i === 11) {
      // Late file at 4:15 PM
      const [key, evts] = patternHappyPath("fedline", lateTime, c, fn);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else {
      const t = i < regTimes.length ? regTimes[i] : regTimes[regTimes.length - 1];
      transfers.push(patternHappyPath("fedline", t, c, fn));
    }
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 6: Did You Receive Our File?
// -----------------------------------------------------------------------
export function scenario6(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Normal background (all partners except jdeere)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === "jdeere") continue;
    const [lo, hi] = partner.volume_range;
    const count = randInt(lo, hi);
    const times = generateSortedTimes(dateStr, count);
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // The specific John Deere file at 9:15 AM
  const targetTime = specificTime(dateStr, 9, 15, 0);
  const [key1, evts1] = patternHappyPath("jdeere", targetTime, c, "loan_pkg_4471.zip.pgp");
  transfers.push([key1, evts1]);
  injectedKeys.push(key1);

  // 2-3 other successful John Deere transfers for context
  const otherCount = randInt(2, 3);
  const otherTimes = generateSortedTimes(dateStr, otherCount).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 8 && h <= 16;
  });
  for (const t of otherTimes) {
    transfers.push(patternHappyPath("jdeere", t, c));
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 7: Why Was My File Rejected?
// -----------------------------------------------------------------------
export function scenario7(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Normal background (all partners except jdeere)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === "jdeere") continue;
    const [lo, hi] = partner.volume_range;
    const count = randInt(lo, hi);
    const times = generateSortedTimes(dateStr, count);
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // John Deere: 8-10 successful, 1 virus scan failure mid-day
  const jdCount = randInt(8, 10);
  const jdTimes = generateSortedTimes(dateStr, jdCount + 1);
  const failIdx = Math.floor(jdCount / 2);

  for (let i = 0; i < jdTimes.length; i++) {
    if (i === failIdx) {
      const [key, evts] = patternVirusScan("jdeere", jdTimes[i], c, "loan_pkg_4502.zip.pgp");
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else {
      transfers.push(patternHappyPath("jdeere", jdTimes[i], c));
    }
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 8: The Same Failure, Three Perspectives
// -----------------------------------------------------------------------
export function scenario8(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Full day of normal traffic
  transfers.push(...generateDay(dateStr, 1.0, isWeekend(dateStr), c));

  // Inject the specific partial file failure
  const failTime = specificTime(dateStr, 10 + randInt(0, 3), randInt(0, 59));
  const [key, evts] = patternPartialFile("jdeere", failTime, c, "loan_pkg_4488.zip.pgp", 245000, 112000);
  transfers.push([key, evts]);
  injectedKeys.push(key);

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario registry — includes static metadata for the /scenarios view
// -----------------------------------------------------------------------
export interface ScenarioMeta {
  id: number;
  name: string;
  persona: string;
  personaRole: string;
  situation: string;
  tasks: string[];
  fn: (dateStr: string) => ScenarioResult;
  dateLabel: string; // hint for the date picker
  transferRange: [number, number]; // approximate [min, max] transfers generated
}

export const SCENARIOS: ScenarioMeta[] = [
  {
    id: 1,
    name: "Monday Morning Triage",
    persona: "David Chen",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    situation:
      "It's Monday morning. David needs to review weekend transfer activity and identify anything that needs immediate attention before the trading day begins.",
    tasks: [
      "Review the weekend activity. How many transfers ran? How many succeeded vs. failed?",
      "Identify the failed transfers. What went wrong with each?",
      "Prioritize: which failure needs attention first and why?",
      "Is there anything still in progress that shouldn't be?",
    ],
    fn: scenario1,
    dateLabel: "Monday date (data covers Sat + Sun)",
    transferRange: [225, 330],
  },
  {
    id: 2,
    name: "PGP Key Rotation Fallout",
    persona: "David Chen",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    situation:
      "It's Friday morning. The security team rotated PGP keys last night. David needs to check if the key rotation caused any issues with incoming file transfers.",
    tasks: [
      "Are there any transfer failures this morning? How many and from which partners?",
      "What's the common error message? What's the likely root cause?",
      "Is there an outlier — a failure with a different error message? What might explain it?",
      "Which partners are completely unaffected? Why?",
    ],
    fn: scenario2,
    dateLabel: "Friday date (generates 6 AM–12 PM data)",
    transferRange: [80, 120],
  },
  {
    id: 3,
    name: "New Partner Onboarding",
    persona: "David Chen",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    situation:
      "Lakeshore Clearing was onboarded as a new partner last week. David is doing a post-onboarding health check on their transfer activity to verify the configuration is correct.",
    tasks: [
      "How many transfers came from Lakeshore today? Were they all successful?",
      "Look at the delivery details — are all files going to the correct destination?",
      "Are the transfer speeds normal? Is anything unusually slow?",
      "Based on your findings, is this partner healthy or are there issues to address?",
    ],
    fn: scenario3,
    dateLabel: "Health check date",
    transferRange: [260, 380],
  },
  {
    id: 4,
    name: "Where's the Settlement File?",
    persona: "David Chen",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    situation:
      "It's mid-afternoon. The Treasury team just called — they received settlement files 001 through 004 from Meridian Capital but file 005 is missing. They need it by end of day for reconciliation.",
    tasks: [
      "Find settlement file 005. Is it in the system?",
      "What happened to it? Where exactly did it fail?",
      "What's the error message? What does it tell you about the root cause?",
      "What would you tell the Treasury team?",
    ],
    fn: scenario4,
    dateLabel: "Afternoon date (12 PM–5 PM data)",
    transferRange: [50, 80],
  },
  {
    id: 5,
    name: "End-of-Quarter Regulatory Batch",
    persona: "David Chen",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    situation:
      "It's end of quarter. Pinnacle must submit 12 regulatory files to the Federal Reserve by 5 PM. David is monitoring the batch submission progress.",
    tasks: [
      "How many of the 12 regulatory files have been submitted successfully?",
      "Which file(s) failed? What's the error message?",
      "Is there a file that arrived unusually late? When?",
      "It's 4:45 PM — what's the overall status? Can Pinnacle meet the 5 PM deadline?",
    ],
    fn: scenario5,
    dateLabel: "Quarter-end date (1 PM–5 PM data)",
    transferRange: [65, 110],
  },
  {
    id: 6,
    name: "Did You Receive Our File?",
    persona: "Karen Mitchell",
    personaRole: "Operations Analyst, John Deere Financial",
    situation:
      "Karen sent loan_pkg_4471.zip.pgp to Pinnacle at 9:15 AM. Her internal team is asking for confirmation that Pinnacle received it successfully before they proceed with the loan processing workflow.",
    tasks: [
      "Log into the portal. Find loan_pkg_4471.zip.pgp.",
      "Was it received successfully? What status do you see?",
      "Can you confirm when it was received and verify the file size?",
      "Write a one-sentence confirmation message to your internal team.",
    ],
    fn: scenario6,
    dateLabel: "File submission date",
    transferRange: [270, 390],
  },
  {
    id: 7,
    name: "Why Was My File Rejected?",
    persona: "Karen Mitchell",
    personaRole: "Operations Analyst, John Deere Financial",
    situation:
      "John Deere sent several loan packages to Pinnacle today. One of them — loan_pkg_4502.zip.pgp — was rejected. Karen needs to understand why so she can report back to her team.",
    tasks: [
      "Find the rejected file. What status does it show?",
      "What reason is given for the rejection?",
      "Is the error message understandable to someone outside Pinnacle?",
      "What would you tell your internal team at John Deere?",
    ],
    fn: scenario7,
    dateLabel: "File rejection date",
    transferRange: [275, 400],
  },
  {
    id: 8,
    name: "The Same Failure, Three Perspectives",
    persona: "Multiple participants",
    personaRole: "Compare how different user roles experience the same event",
    situation:
      "loan_pkg_4488.zip.pgp from John Deere failed — a partial file was received (expected 245,000 bytes, got 112,000 bytes). This scenario is run by multiple participants to compare what information each user role can see.",
    tasks: [
      "Find the failed transfer.",
      "What information do you see about the failure?",
      "How complete is the error information from your perspective?",
    ],
    fn: scenario8,
    dateLabel: "Failure date",
    transferRange: [275, 410],
  },
];
