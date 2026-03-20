import { PARTNERS } from "./config";
import { generateSortedTimes } from "./timing";
import { makeContext } from "./types";
import {
  patternHappyPath,
  patternRetrySuccess,
  patternStagingFailure,
  patternPartialFile,
  patternPgpFailure,
  patternVirusScan,
  patternStalled,
  patternSlowDelivery,
} from "./patterns";
import type { Transfer, GeneratorContext } from "./types";

const FAIL_TYPES = ["pgp_failure", "staging_failure", "partial_file", "virus_scan"] as const;

// Generate a full realistic day of transfers across all partners
export function generateDay(
  dateStr: string, // YYYY-MM-DD
  volumeScale = 1.0,
  isWeekend = false,
  ctx?: GeneratorContext
): Transfer[] {
  const c = ctx ?? makeContext();
  const weekendFactor = isWeekend ? 0.4 : 1.0;
  const scale = volumeScale * weekendFactor;

  const transfers: Transfer[] = [];

  for (const [partnerKey, partner] of Object.entries(PARTNERS)) {
    const [lo, hi] = partner.volume_range;
    const count = Math.max(1, Math.round((lo + Math.random() * (hi - lo)) * scale));
    const times = generateSortedTimes(dateStr, count);

    const nHappy = Math.floor(count * 0.85);
    const nRetry = Math.floor(count * 0.05);
    const nFail = Math.floor(count * 0.05);
    const nSlow = Math.floor(count * 0.03);
    const nStalled = Math.max(0, count - nHappy - nRetry - nFail - nSlow);

    const patterns: string[] = [
      ...Array(nHappy).fill("happy"),
      ...Array(nRetry).fill("retry"),
      ...Array(nFail).fill("fail"),
      ...Array(nSlow).fill("slow"),
      ...Array(nStalled).fill("stalled"),
    ];

    // Pad to count
    while (patterns.length < count) patterns.push("happy");
    patterns.splice(count);

    // Shuffle
    for (let i = patterns.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [patterns[i], patterns[j]] = [patterns[j], patterns[i]];
    }

    for (let i = 0; i < count; i++) {
      const t = times[i];
      const pat = patterns[i];

      if (pat === "happy") {
        transfers.push(patternHappyPath(partnerKey, t, c));
      } else if (pat === "retry") {
        transfers.push(patternRetrySuccess(partnerKey, t, c));
      } else if (pat === "slow") {
        transfers.push(patternSlowDelivery(partnerKey, t, c));
      } else if (pat === "stalled") {
        transfers.push(patternStalled(partnerKey, t, c));
      } else {
        // fail — pick a random failure type, fall back to staging if partner doesn't support PGP
        const ft = FAIL_TYPES[Math.floor(Math.random() * FAIL_TYPES.length)];
        if (ft === "pgp_failure" && partner.pgp) {
          transfers.push(patternPgpFailure(partnerKey, t, c));
        } else if (ft === "staging_failure") {
          transfers.push(patternStagingFailure(partnerKey, t, c));
        } else if (ft === "partial_file") {
          transfers.push(patternPartialFile(partnerKey, t, c));
        } else if (ft === "virus_scan") {
          transfers.push(patternVirusScan(partnerKey, t, c));
        } else {
          transfers.push(patternStagingFailure(partnerKey, t, c));
        }
      }
    }
  }

  return transfers;
}
