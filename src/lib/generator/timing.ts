import { DateTime } from "luxon";
import { HOUR_WEIGHTS } from "./config";
import { weightedChoice } from "./keys";

const ET = "America/New_York";

// Generate a random business-hour DateTime for the given date string (YYYY-MM-DD)
export function randomBusinessTime(dateStr: string): DateTime {
  // Build weighted hour list
  const hours: number[] = [];
  const weights: number[] = [];
  for (let h = 6; h <= 20; h++) {
    hours.push(h);
    weights.push(HOUR_WEIGHTS[h]);
  }
  const hour = weightedChoice(hours, weights);
  const minute = Math.floor(Math.random() * 60);
  const second = Math.floor(Math.random() * 60);

  return DateTime.fromObject(
    { year: parseInt(dateStr.slice(0, 4)), month: parseInt(dateStr.slice(5, 7)), day: parseInt(dateStr.slice(8, 10)), hour, minute, second },
    { zone: ET }
  );
}

// Generate N random business-hour timestamps for a given date, sorted ascending
export function generateSortedTimes(dateStr: string, count: number): DateTime[] {
  const times: DateTime[] = [];
  for (let i = 0; i < count; i++) {
    times.push(randomBusinessTime(dateStr));
  }
  return times.sort((a, b) => a.toMillis() - b.toMillis());
}

// Generate a specific time on a date
export function specificTime(dateStr: string, hour: number, minute: number, second = 0): DateTime {
  return DateTime.fromObject(
    { year: parseInt(dateStr.slice(0, 4)), month: parseInt(dateStr.slice(5, 7)), day: parseInt(dateStr.slice(8, 10)), hour, minute, second },
    { zone: ET }
  );
}

// Format date as YYYYMMDD
export function dateToYMD(dt: DateTime): string {
  return dt.setZone(ET).toFormat("yyyyMMdd");
}

// Get the preceding Saturday and Sunday for a Monday date string
export function weekendDates(mondayStr: string): [string, string] {
  const monday = DateTime.fromISO(mondayStr, { zone: ET });
  const saturday = monday.minus({ days: 2 }).toISODate()!;
  const sunday = monday.minus({ days: 1 }).toISODate()!;
  return [saturday, sunday];
}

// Check if a date is a weekend
export function isWeekend(dateStr: string): boolean {
  const dt = DateTime.fromISO(dateStr, { zone: ET });
  return dt.weekday === 6 || dt.weekday === 7; // Saturday=6, Sunday=7
}
