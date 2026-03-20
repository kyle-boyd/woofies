"use client";

import { useState, useCallback, useRef } from "react";
import type { ScenarioState } from "@/lib/state/types";
import type { ScenarioMeta } from "@/lib/generator/scenarios";
import { StatusBadge } from "./StatusBadge";
import { AnswerKeyPanel } from "./AnswerKeyPanel";
import { DripProgressBar } from "./DripProgressBar";

function saveToLocalStorage(id: number, state: Partial<ScenarioState>) {
  try {
    const key = `woofies_scenario_${id}`;
    const existing = JSON.parse(localStorage.getItem(key) ?? "{}");
    localStorage.setItem(key, JSON.stringify({ ...existing, ...state }));
  } catch {}
}

interface Props {
  meta: ScenarioMeta;
  state: ScenarioState;
  onRefresh: () => void;
}

export function ScenarioCard({ meta, state, onRefresh }: Props) {
  const [targetDate, setTargetDate] = useState(
    state.targetDate ?? new Date().toISOString().slice(0, 10)
  );
  const [loading, setLoading] = useState<"submit" | "drip" | null>(null);
  const [progress, setProgress] = useState<{ submitted: number; total: number } | null>(null);
  const [dripProgress, setDripProgress] = useState<{ submitted: number; total: number; nextAt: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitErrors, setSubmitErrors] = useState<string[]>([]);
  const dripRef = useRef<{ sessionId: string; total: number } | null>(null);
  const abortRef = useRef(false);

  const handleGenerateSubmit = useCallback(async () => {
    setLoading("submit");
    setError(null);
    setProgress(null);
    setSubmitErrors([]);
    abortRef.current = false;

    try {
      // Step 1: generate and get session
      const res = await fetch(`/api/scenarios/${meta.id}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, total, answerKey } = await res.json();
      setProgress({ submitted: 0, total });

      // Step 2: submit loop
      let remaining = total;
      while (remaining > 0 && !abortRef.current) {
        const nextRes = await fetch(`/api/submit/next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId, batchSize: 10 }),
        });
        if (!nextRes.ok) throw new Error(await nextRes.text());
        const data = await nextRes.json();
        remaining = data.remaining;
        if (data.errors?.length > 0) {
          setSubmitErrors(prev => [...prev, ...data.errors]);
        }
        setProgress({ submitted: total - remaining, total });
        if (data.done) break;
        await new Promise(r => setTimeout(r, 50));
      }

      // Persist answer key to localStorage
      saveToLocalStorage(meta.id, {
        status: "submitted",
        targetDate,
        answerKey,
        lastRunAt: new Date().toISOString(),
      });
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
    }
  }, [meta.id, targetDate, onRefresh]);

  const handleGenerateDrip = useCallback(async () => {
    setLoading("drip");
    setError(null);
    setDripProgress(null);
    abortRef.current = false;

    try {
      const res = await fetch(`/api/scenarios/${meta.id}/drip`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetDate }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { sessionId, totalEvents } = await res.json();
      dripRef.current = { sessionId, total: totalEvents };
      setDripProgress({ submitted: 0, total: totalEvents, nextAt: null });

      // Drip poll loop: call /drip/next every 500ms
      let remaining = totalEvents;
      while (remaining > 0 && !abortRef.current) {
        await new Promise(r => setTimeout(r, 500));
        const nextRes = await fetch(`/api/scenarios/${meta.id}/drip/next`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        if (!nextRes.ok) break;
        const data = await nextRes.json();
        remaining = data.remaining;
        setDripProgress({
          submitted: totalEvents - remaining,
          total: totalEvents,
          nextAt: data.nextAt,
        });
        if (data.done) break;
      }

      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(null);
      dripRef.current = null;
    }
  }, [meta.id, targetDate, onRefresh]);

  const handleFreeze = useCallback(async () => {
    await fetch(`/api/scenarios/${meta.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ frozen: !state.frozen }),
    });
    saveToLocalStorage(meta.id, { frozen: !state.frozen });
    onRefresh();
  }, [meta.id, state.frozen, onRefresh]);

  const isRunning = loading !== null;
  const isFrozen = state.frozen;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-mono text-gray-400 shrink-0">#{meta.id}</span>
          <h3 className="text-base font-semibold text-gray-900 truncate">{meta.name}</h3>
          <StatusBadge status={state.status} />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <label className="text-xs text-gray-500">{meta.dateLabel}</label>
          <input
            type="date"
            value={targetDate}
            onChange={e => setTargetDate(e.target.value)}
            disabled={isFrozen || isRunning}
            className="text-xs border border-gray-300 rounded px-2 py-1 disabled:opacity-50"
          />
        </div>
      </div>

      <p className="mt-2 text-sm text-gray-600 line-clamp-2">{meta.situation}</p>

      <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
        <span>~{meta.transferRange[0]}–{meta.transferRange[1]} transfers</span>
        <span>·</span>
        <span>~{Math.round(meta.transferRange[0] * 9 / 60)}–{Math.round(meta.transferRange[1] * 9 / 60)} min to drip</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={handleGenerateSubmit}
          disabled={isFrozen || isRunning}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-alpine-700 text-white border border-alpine-900 hover:bg-alpine-800 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading === "submit" ? "Submitting…" : "Generate & Submit"}
        </button>
        <button
          onClick={handleGenerateDrip}
          disabled={isFrozen || isRunning}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-alpine-500 text-white border border-alpine-700 hover:bg-alpine-600 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading === "drip" ? "Dripping…" : "Generate & Drip"}
        </button>
        <button
          onClick={handleFreeze}
          disabled={isRunning}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg border disabled:opacity-40 disabled:cursor-not-allowed ${
            isFrozen
              ? "bg-green-50 border-green-300 text-green-700 hover:bg-green-100"
              : "bg-alpine-50 border-alpine-300 text-alpine-700 hover:bg-alpine-100"
          }`}
        >
          {isFrozen ? "Unfreeze" : "Freeze"}
        </button>
        {isRunning && (
          <button
            onClick={() => { abortRef.current = true; }}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-300 text-red-600 hover:bg-red-50"
          >
            Stop
          </button>
        )}
      </div>

      {loading === "submit" && progress && (
        <div className="mt-2">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{progress.submitted} / {progress.total} transfers</span>
            <span>{Math.round((progress.submitted / progress.total) * 100)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-alpine-500 h-1.5 rounded-full transition-all duration-200"
              style={{ width: `${Math.round((progress.submitted / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {loading === "drip" && dripProgress && (
        <DripProgressBar
          submitted={dripProgress.submitted}
          total={dripProgress.total}
          nextAtMs={dripProgress.nextAt}
        />
      )}

      {error && (
        <div className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded p-2">
          {error}
        </div>
      )}

      {submitErrors.length > 0 && (
        <div className="mt-2 text-xs text-orange-700 bg-orange-50 border border-orange-200 rounded p-2">
          <p className="font-medium mb-1">{submitErrors.length} transfer{submitErrors.length !== 1 ? "s" : ""} failed to submit:</p>
          <ul className="list-disc ml-3 space-y-0.5 max-h-24 overflow-y-auto">
            {submitErrors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      {state.answerKey && <AnswerKeyPanel answerKey={state.answerKey} />}
    </div>
  );
}
