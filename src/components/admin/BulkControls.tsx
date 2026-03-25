"use client";

import { useState } from "react";
import { SCENARIOS } from "@/lib/generator/scenarios";

export function BulkControls({ onRefresh, onResetStart, onResetEnd }: { onRefresh: () => void; onResetStart: () => void; onResetEnd: () => void }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState<"day" | "week" | "reset" | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);

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
      const { transfers, total } = await res.json();

      // Submit in batches (client drives cursor, no server session)
      const batchSize = 20;
      let cursor = 0;
      while (cursor < total) {
        const batch = transfers.slice(cursor, cursor + batchSize);
        const nextRes = await fetch(`/api/submit/next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transfers: batch }),
        });
        if (!nextRes.ok) break;
        cursor += batch.length;
        setResult(`Submitting: ${cursor} / ${total}…`);
        if (cursor < total) await new Promise(r => setTimeout(r, 50));
      }
      setResult(`Done — submitted ${total} transfers`);
      onRefresh();
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
    }
  }

  async function resetAll() {
    setShowResetModal(false);
    setLoading("reset");
    setResult(null);
    onResetStart();
    try {
      const res = await fetch("/api/scenarios", { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
      // Clear localStorage for all scenarios
      for (const s of SCENARIOS) {
        localStorage.removeItem(`woofies_scenario_${s.id}`);
      }
      setResult("All scenarios reset");
      onRefresh();
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(null);
      onResetEnd();
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
        <button
          onClick={() => setShowResetModal(true)}
          disabled={loading !== null}
          className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-600 bg-red-50 hover:bg-red-100 disabled:opacity-40 ml-auto"
        >
          {loading === "reset" ? "Resetting…" : "Reset all"}
        </button>
        {result && <span className="text-xs text-gray-500">{result}</span>}
      </div>

      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 max-w-sm w-full mx-4">
            <h3 className="text-sm font-bold text-gray-900 mb-2">Reset all scenarios?</h3>
            <p className="text-sm text-gray-600 mb-5">
              This will reset all scenarios to <span className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">not_run</span>. This cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowResetModal(false)}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={resetAll}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-600 text-white hover:bg-red-700"
              >
                Reset all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
