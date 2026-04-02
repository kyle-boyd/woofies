"use client";

import { useState } from "react";
import type { AnswerKey, Finding } from "@/lib/generator/types";

export interface RunHistoryEntry {
  runAt: string; // ISO timestamp
  targetDate: string; // YYYY-MM-DD
  answerKey: AnswerKey;
}

function FindingCard({ f }: { f: Finding }) {
  const OUTCOME_COLORS = {
    FailTransfer: "border-red-200 bg-red-50",
    Stalled: "border-orange-200 bg-orange-50",
    Misrouted: "border-purple-200 bg-purple-50",
    SlowDelivery: "border-yellow-200 bg-yellow-50",
    RetrySuccess: "border-blue-200 bg-blue-50",
    Success: "border-green-200 bg-green-50",
  };

  return (
    <div className={`border rounded-lg p-3 mb-2 ${OUTCOME_COLORS[f.outcome]}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="font-medium text-sm">{f.description}</div>
        <span className="text-xs text-gray-500 whitespace-nowrap">{f.outcome}</span>
      </div>
      <div className="mt-1 text-xs text-gray-700 font-mono">{f.filename}</div>
      <div className="mt-0.5 text-xs text-gray-600">
        <span className="font-medium">Partner:</span> {f.partner} &nbsp;|&nbsp;
        <span className="font-medium">Start:</span> {f.startTime}
      </div>
      {f.errorMessage && (
        <div className="mt-1 text-xs text-gray-600">
          <span className="font-medium">Error:</span> <span className="font-mono">{f.errorMessage}</span>
        </div>
      )}
      <div className="mt-1 text-xs text-gray-500">{f.details}</div>
      <div className="mt-1 text-xs text-gray-400 font-mono">{f.arrivedfileKey}</div>
    </div>
  );
}

function AnswerKeyContent({ answerKey }: { answerKey: AnswerKey }) {
  return (
    <div className="mt-3">
      <div className="grid grid-cols-4 gap-2 mb-3 text-xs text-gray-500">
        <div><span className="font-medium text-gray-700">{answerKey.totalTransfers}</span> total</div>
        <div><span className="font-medium text-green-700">{answerKey.totalSuccess}</span> success</div>
        <div><span className="font-medium text-red-700">{answerKey.totalFailed}</span> failed</div>
        <div><span className="font-medium text-orange-700">{answerKey.totalStalled}</span> stalled</div>
      </div>
      {answerKey.notes && (
        <div className="mb-3 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5">
          {answerKey.notes}
        </div>
      )}
      {answerKey.findings.map(f => (
        <FindingCard key={f.arrivedfileKey} f={f} />
      ))}
    </div>
  );
}

export function AnswerKeyPanel({ answerKey }: { answerKey: AnswerKey }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-3 border-t pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{open ? "Hide answer key" : "Reveal answer key"}</span>
        <span className="ml-1 text-xs text-gray-400">
          ({answerKey.findings.length} finding{answerKey.findings.length !== 1 ? "s" : ""})
        </span>
      </button>

      {open && <AnswerKeyContent answerKey={answerKey} />}
    </div>
  );
}

export function RunHistoryPanel({ history }: { history: RunHistoryEntry[] }) {
  const [open, setOpen] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (history.length === 0) return null;

  // Show most recent first
  const sorted = [...history].reverse();

  return (
    <div className="mt-2 border-t pt-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>{open ? "Hide run history" : "Run history"}</span>
        <span className="ml-1 text-xs text-gray-400">({history.length} previous run{history.length !== 1 ? "s" : ""})</span>
      </button>

      {open && (
        <div className="mt-2 space-y-1">
          {sorted.map((entry, i) => {
            const isOpen = expandedIdx === i;
            const runDate = new Date(entry.runAt).toLocaleString(undefined, {
              month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
            });
            return (
              <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedIdx(isOpen ? null : i)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs text-left hover:bg-gray-50"
                >
                  <span className="font-medium text-gray-700">
                    {runDate} — target: {entry.targetDate}
                  </span>
                  <span className="text-gray-400 flex items-center gap-2">
                    <span>{entry.answerKey.findings.length} finding{entry.answerKey.findings.length !== 1 ? "s" : ""}</span>
                    <span>{isOpen ? "▾" : "▸"}</span>
                  </span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 border-t border-gray-100 bg-gray-50">
                    <AnswerKeyContent answerKey={entry.answerKey} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
