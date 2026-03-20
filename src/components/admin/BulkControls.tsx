"use client";

import { useState } from "react";

export function BulkControls({ onRefresh }: { onRefresh: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState<"day" | "week" | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(mode: "day" | "week") {
    setLoading(mode);
    setResult(null);
    try {
      const res = await fetch("/api/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, targetDate: date }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, total } = await res.json();

      // Submit loop
      let remaining = total;
      while (remaining > 0) {
        const nextRes = await fetch(`/api/submit/next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, batchSize: 20 }),
        });
        if (!nextRes.ok) break;
        const data = await nextRes.json();
        remaining = data.remaining;
        setResult(`Submitting: ${total - remaining} / ${total}…`);
        if (data.done) break;
        await new Promise(r => setTimeout(r, 50));
      }
      setResult(`Done — submitted ${total} transfers`);
      onRefresh();
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 mb-6">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Bulk generation</h2>
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <label className="text-xs text-gray-500 mr-1">Start date</label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            disabled={loading !== null}
            className="text-xs border border-gray-300 rounded px-2 py-1 disabled:opacity-50"
          />
        </div>
        <button
          onClick={() => run("day")}
          disabled={loading !== null}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-alpine-700 text-white border border-alpine-900 hover:bg-alpine-800 disabled:opacity-40"
        >
          {loading === "day" ? "Running…" : "Generate full day"}
        </button>
        <button
          onClick={() => run("week")}
          disabled={loading !== null}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-alpine-700 text-white border border-alpine-900 hover:bg-alpine-800 disabled:opacity-40"
        >
          {loading === "week" ? "Running…" : "Generate week (5 days)"}
        </button>
        {result && <span className="text-xs text-gray-500">{result}</span>}
      </div>
    </div>
  );
}
