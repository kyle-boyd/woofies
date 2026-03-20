"use client";

interface DripProgressBarProps {
  submitted: number;
  total: number;
  nextAtMs: number | null;
}

export function DripProgressBar({ submitted, total, nextAtMs }: DripProgressBarProps) {
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;

  let nextLabel = "";
  if (nextAtMs) {
    const d = new Date(nextAtMs);
    nextLabel = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/New_York",
    });
  }

  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>{submitted} / {total} events ({pct}%)</span>
        {nextLabel && <span>Next: {nextLabel} ET</span>}
      </div>
      <div className="w-full bg-gray-200 rounded-full h-1.5">
        <div
          className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
