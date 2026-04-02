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

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

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

  // Randomly assign 4 failure modes to 4 of the 5 available partners
  const [p1, p2, p3, p4] = shuffled(["meridian", "lakeshore", "evergreen", "atlas", "jdeere"]);

  // 1. Staging failure (Saturday)
  const t1 = specificTime(saturdayStr, 10 + randInt(0, 5), randInt(0, 59));
  const [key1, evts1] = patternStagingFailure(p1, t1, c, undefined, undefined, `/staging/${p1}/outbound`);
  transfers.push([key1, evts1]);
  injectedKeys.push(key1);

  // 2. Partial file (Sunday)
  const t2 = specificTime(sundayStr, 9 + randInt(0, 4), randInt(0, 59));
  const [key2, evts2] = patternPartialFile(p2, t2, c);
  transfers.push([key2, evts2]);
  injectedKeys.push(key2);

  // 3. Delivery failure (Sunday)
  const t3 = specificTime(sundayStr, 11 + randInt(0, 5), randInt(0, 59));
  const dateForFilename = sundayStr.replace(/-/g, "");
  const [fn3] = generateFilename(p3, dateForFilename, c);
  const [key3, evts3] = patternStagingFailure(p3, t3, c, fn3);
  transfers.push([key3, evts3]);
  injectedKeys.push(key3);

  // 4. Stalled (Sunday, 2+ hours before "now")
  const t4 = specificTime(sundayStr, 8 + randInt(0, 5), randInt(0, 59));
  const [key4, evts4] = patternStalled(p4, t4, c);
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

  // Randomly assign which PGP partner has the bulk of failures and which has fewer
  const [majorPgp, minorPgp] = Math.random() < 0.5
    ? ["meridian", "jdeere"]
    : ["jdeere", "meridian"];

  // Major PGP partner: 8-12 failures, first one is the "corrupted input data" outlier
  const majorCount = randInt(8, 12);
  const majorTimes = generateSortedTimes(dateStr, majorCount).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 6 && h <= 12;
  }).slice(0, majorCount);

  for (let i = 0; i < majorTimes.length; i++) {
    const variant = i === 0 ? "corrupted input data" : "invalid key";
    const [key, evts] = patternPgpFailure(majorPgp, majorTimes[i], c, undefined, undefined, variant);
    transfers.push([key, evts]);
    if (i === 0) injectedKeys.push(key); // only the outlier goes in the answer key
  }

  // Minor PGP partner: 4-6 failures, all "invalid key"
  const minorCount = randInt(4, 6);
  const minorTimes = generateSortedTimes(dateStr, minorCount).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 6 && h <= 12;
  }).slice(0, minorCount);

  for (const t of minorTimes) {
    const [key, evts] = patternPgpFailure(minorPgp, t, c, undefined, undefined, "invalid key");
    transfers.push([key, evts]);
    // "invalid key" failures are background context — not injected into the answer key
  }

  return { transfers, injectedKeys };
}

// -----------------------------------------------------------------------
// Scenario 3: New Partner Onboarding
// -----------------------------------------------------------------------
const ONBOARDING_PARTNERS = {
  lakeshore: {
    name: "Lakeshore Clearing",
    fileTypesDesc: "margin_call_*.dat and collateral_*.dat",
    destApp: "Pinnacle Treasury App",
    destPath: "/Treasury/Inbox",
    destHost: "sftp-treasury.pinnaclenb.com",
  },
  atlas: {
    name: "Atlas Payroll Services",
    fileTypesDesc: "payroll_batch_*.csv",
    destApp: "Pinnacle Payroll System",
    destPath: "/Payroll/Inbox",
    destHost: "sftp-payroll.pinnaclenb.com",
  },
  evergreen: {
    name: "Evergreen Insurance Co.",
    fileTypesDesc: "claims_*.json",
    destApp: "Pinnacle Claims Processing",
    destPath: "/api/claims/ingest",
    destHost: "claims-api.pinnaclenb.com",
  },
} as const;

export function scenario3(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];

  // Pick a random partner as the newly onboarded one
  const onboardingKeys = Object.keys(ONBOARDING_PARTNERS) as Array<keyof typeof ONBOARDING_PARTNERS>;
  const newPartnerKey = onboardingKeys[Math.floor(Math.random() * onboardingKeys.length)];
  const onboarding = ONBOARDING_PARTNERS[newPartnerKey];

  // Normal background from all partners except the new partner
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === newPartnerKey) continue;
    const [lo, hi] = partner.volume_range;
    const count = randInt(lo, hi);
    const times = generateSortedTimes(dateStr, count);
    for (const t of times) {
      transfers.push(patternHappyPath(partnerKey, t, c));
    }
  }

  // New partner: 8-10 transfers
  const partnerCount = randInt(8, 10);
  const partnerTimes = generateSortedTimes(dateStr, partnerCount);

  for (let i = 0; i < partnerCount; i++) {
    const t = partnerTimes[i];
    if (i === partnerCount - 2) {
      // Misrouted: delivers to Operations instead of correct destination
      const [key, evts] = patternHappyPath(newPartnerKey, t, c, undefined, undefined, "operations");
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else if (i === partnerCount - 1) {
      // Slow delivery
      const [key, evts] = patternSlowDelivery(newPartnerKey, t, c, undefined, undefined, 45);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else {
      transfers.push(patternHappyPath(newPartnerKey, t, c));
    }
  }

  return {
    transfers,
    injectedKeys,
    dynamicText: {
      situation: `${onboarding.name} was onboarded as a new partner last week. You are doing a post-onboarding health check on their transfer activity to verify the configuration is correct. Per the onboarding spec, ${onboarding.name} sends ${onboarding.fileTypesDesc} and all of them should be delivered to the ${onboarding.destApp} (${onboarding.destPath} on ${onboarding.destHost}).`,
      tasks: [
        `How many transfers came from ${onboarding.name} today? Were they all successful?`,
        "Look at the delivery details — are all files going to the correct destination?",
        "Are the transfer speeds normal? Is anything unusually slow?",
        "Based on your findings, is this partner healthy or are there issues to address?",
      ],
    },
    answerKeyNotes: `${onboarding.name} generated ${partnerCount} transfers in this run.`,
  };
}

// -----------------------------------------------------------------------
// Scenario 4: Where's the Settlement File?
// -----------------------------------------------------------------------
const MISSING_FILE_PARTNERS = {
  meridian: {
    name: "Meridian Capital",
    filePrefix: "settlement",
    fileLabel: "settlement file",
  },
  lakeshore: {
    name: "Lakeshore Clearing",
    filePrefix: "margin_call",
    fileLabel: "margin call file",
  },
} as const;

export function scenario4(dateStr: string): ScenarioResult {
  const c = makeContext();
  const transfers: Transfer[] = [];
  const injectedKeys: string[] = [];
  const dateYMD = dateStr.replace(/-/g, "");

  // Pick which partner's sequential files are the subject of this scenario
  const filePartnerKeys = Object.keys(MISSING_FILE_PARTNERS) as Array<keyof typeof MISSING_FILE_PARTNERS>;
  const filePartnerKey = filePartnerKeys[Math.floor(Math.random() * filePartnerKeys.length)];
  const fileConfig = MISSING_FILE_PARTNERS[filePartnerKey];

  // Normal background (afternoon only, skip the file partner)
  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    if (partnerKey === filePartnerKey) continue;
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

  // 5 sequential files — first 4 succeed, 5th fails
  const fileTimes = generateSortedTimes(dateStr, 5).filter(t => {
    const h = t.setZone(ET).hour;
    return h >= 12 && h <= 17;
  }).slice(0, 5);

  while (fileTimes.length < 5) {
    fileTimes.push(specificTime(dateStr, 13 + fileTimes.length, randInt(0, 59)));
  }

  for (let i = 0; i < 5; i++) {
    const fn = `${fileConfig.filePrefix}_${dateYMD}_${String(i + 1).padStart(3, "0")}.dat`;
    const t = fileTimes[i];
    if (i < 4) {
      transfers.push(patternHappyPath(filePartnerKey, t, c, fn));
    } else {
      const [key, evts] = patternStagingFailure(filePartnerKey, t, c, fn, undefined, `/staging/${filePartnerKey}/outbound`);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    }
  }

  return {
    transfers,
    injectedKeys,
    dynamicText: {
      situation: `It's mid-afternoon. The Treasury team just called — they received ${fileConfig.fileLabel}s 001 through 004 from ${fileConfig.name} but file 005 is missing. They need it by end of day for reconciliation.`,
      tasks: [
        `Find ${fileConfig.fileLabel} 005. Is it in the system?`,
        "What happened to it? Where exactly did it fail?",
        "What's the error message? What does it tell you about the root cause?",
        "What would you tell the Treasury team?",
      ],
    },
  };
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
      regFiles.push(`reg_${rtype}_${String(seq).padStart(3, "0")}_${dateYMD}.dat`);
    }
  }

  // Shuffle
  for (let i = regFiles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [regFiles[i], regFiles[j]] = [regFiles[j], regFiles[i]];
  }

  // Ensure a fr2900 file is at position 0 so the retry-then-success always hits it
  const fr2900Idx = regFiles.findIndex(f => f.includes("fr2900"));
  if (fr2900Idx > 0) {
    [regFiles[0], regFiles[fr2900Idx]] = [regFiles[fr2900Idx], regFiles[0]];
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

  // The specific John Deere file at 9:15 AM — random ID each run
  const loanId6 = randInt(1000, 9999);
  const targetFilename6 = `loan_pkg_${loanId6}.zip.pgp`;
  const targetTime = specificTime(dateStr, 9, 15, 0);
  const [key1, evts1] = patternHappyPath("jdeere", targetTime, c, targetFilename6);
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

  return {
    transfers,
    injectedKeys,
    dynamicText: {
      situation: `You sent ${targetFilename6} to Pinnacle at 9:15 AM. Your internal team is asking for confirmation that Pinnacle received it successfully before they proceed with the loan processing workflow.`,
      tasks: [
        `Log into the portal. Find ${targetFilename6}.`,
        "Was it received successfully? What status do you see?",
        "Can you confirm when it was received and verify the file size?",
        "Write a one-sentence confirmation message to your internal team.",
      ],
    },
  };
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

  // John Deere: 8-10 successful, 1 virus scan failure mid-day — random ID each run
  const loanId7 = randInt(1000, 9999);
  const targetFilename7 = `loan_pkg_${loanId7}.zip.pgp`;
  const jdCount = randInt(8, 10);
  const jdTimes = generateSortedTimes(dateStr, jdCount + 1);
  const failIdx = Math.floor(jdCount / 2);

  for (let i = 0; i < jdTimes.length; i++) {
    if (i === failIdx) {
      const [key, evts] = patternVirusScan("jdeere", jdTimes[i], c, targetFilename7);
      transfers.push([key, evts]);
      injectedKeys.push(key);
    } else {
      transfers.push(patternHappyPath("jdeere", jdTimes[i], c));
    }
  }

  return {
    transfers,
    injectedKeys,
    dynamicText: {
      situation: `John Deere sent several loan packages to Pinnacle today. One of them — ${targetFilename7} — was rejected. You need to understand why so you can report back to your team.`,
    },
  };
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

  // Inject the specific partial file failure — random ID and sizes each run
  const loanId8 = randInt(1000, 9999);
  const targetFilename8 = `loan_pkg_${loanId8}.zip.pgp`;
  const expectedBytes8 = randInt(150000, 500000);
  const receivedBytes8 = randInt(Math.floor(expectedBytes8 / 5), Math.floor(expectedBytes8 / 2));
  const failTime = specificTime(dateStr, 10 + randInt(0, 3), randInt(0, 59));
  const [key, evts] = patternPartialFile("jdeere", failTime, c, targetFilename8, expectedBytes8, receivedBytes8);
  transfers.push([key, evts]);
  injectedKeys.push(key);

  return {
    transfers,
    injectedKeys,
    dynamicText: {
      situation: `${targetFilename8} from John Deere failed — a partial file was received (expected ${expectedBytes8.toLocaleString()} bytes, got ${receivedBytes8.toLocaleString()} bytes). This scenario is run by multiple participants to compare what information each user role can see.`,
    },
  };
}

// -----------------------------------------------------------------------
// Scenario registry — includes static metadata for the /scenarios view
// -----------------------------------------------------------------------
export interface ScenarioMeta {
  id: number;
  name: string;
  persona: string;
  personaRole: string;
  personaDescription: string;
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
    persona: "You",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    personaDescription:
      "You manage the MFT infrastructure at Pinnacle National Bank. You're responsible for ensuring all file transfers complete successfully, onboarding new partners, troubleshooting failures, and reporting transfer health to IT leadership. You know protocols, understand PGP, and can read log files. You use this platform all day.",
    situation:
      "It's Monday morning. You need to review weekend transfer activity and identify anything that needs immediate attention before the trading day begins.",
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
    persona: "You",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    personaDescription:
      "You manage the MFT infrastructure at Pinnacle National Bank. You're responsible for ensuring all file transfers complete successfully, onboarding new partners, troubleshooting failures, and reporting transfer health to IT leadership. You know protocols, understand PGP, and can read log files. You use this platform all day.",
    situation:
      "It's Friday morning. The security team rotated PGP keys last night. You need to check if the key rotation caused any issues with incoming file transfers.",
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
    persona: "You",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    personaDescription:
      "You manage the MFT infrastructure at Pinnacle National Bank. You're responsible for ensuring all file transfers complete successfully, onboarding new partners, troubleshooting failures, and reporting transfer health to IT leadership. You know protocols, understand PGP, and can read log files. You use this platform all day.",
    situation:
      "Lakeshore Clearing was onboarded as a new partner last week. You are doing a post-onboarding health check on their transfer activity to verify the configuration is correct. Per the onboarding spec, Lakeshore sends two file types — margin_call_*.dat and collateral_*.dat — and all of them should be delivered to the Pinnacle Treasury App (/Treasury/Inbox on sftp-treasury.pinnaclenb.com).",
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
    persona: "You",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    personaDescription:
      "You work in Pinnacle National Bank's operations team. You don't manage the MFT infrastructure, but you depend on file transfers to do your job. When a settlement file doesn't arrive, you're the one who gets the phone call. You know file names and partner names but not protocols or server internals.",
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
    persona: "You",
    personaRole: "Senior File Transfer Analyst, Pinnacle National Bank",
    personaDescription:
      "You work in Pinnacle National Bank's operations team. You don't manage the MFT infrastructure, but you depend on file transfers to do your job. When a settlement file doesn't arrive, you're the one who gets the phone call. You know file names and partner names but not protocols or server internals.",
    situation:
      "It's end of quarter. Pinnacle must submit 12 regulatory files to the Federal Reserve by 5 PM. You are monitoring the batch submission progress.",
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
    persona: "You",
    personaRole: "Operations Analyst, John Deere Financial",
    personaDescription:
      "You're a file operations coordinator at John Deere Financial. You send loan document packages to Pinnacle National Bank and need to confirm they were received. You have a portal login that shows only John Deere's transfers. You don't need to know what SFTP, PGP, or staging means — you just need to know: did it get there?",
    situation:
      "You sent loan_pkg_4471.zip.pgp to Pinnacle at 9:15 AM. Your internal team is asking for confirmation that Pinnacle received it successfully before they proceed with the loan processing workflow.",
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
    persona: "You",
    personaRole: "Operations Analyst, John Deere Financial",
    personaDescription:
      "You're a file operations coordinator at John Deere Financial. You send loan document packages to Pinnacle National Bank and need to confirm they were received. You have a portal login that shows only John Deere's transfers. You don't need to know what SFTP, PGP, or staging means — you just need to know: did it get there?",
    situation:
      "John Deere sent several loan packages to Pinnacle today. One of them — loan_pkg_4502.zip.pgp — was rejected. You need to understand why so you can report back to your team.",
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
    persona: "You",
    personaRole: "Compare how different user roles experience the same event",
    personaDescription:
      "This scenario is run by multiple participants at the same time — each assigned a different role. Depending on your assignment: you may be a Pinnacle MFT Admin who sees it as one of 15 alerts, a Pinnacle Operations Analyst who gets a call from the lending team, or a John Deere partner user who sees a failed transfer in the portal.",
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
