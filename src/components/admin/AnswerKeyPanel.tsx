"use client";

import { useState } from "react";
import type { AnswerKey, Finding } from "@/lib/generator/types";

function FindingCard({ f }: { f: Finding }) {
  const OUTCOME_COLORS = {
    FailTransfer: "border-red-200 bg-red-50",
    Stalled: "border-orange-200 bg-orange-50",
    Misrouted: "border-purple-200 bg-purple-50",
    SlowDelivery: "border-yellow-200 bg-yellow-50",
    RetrySuccess: "border-blue-200 bg-blue-50",
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

      {open && (
        <div className="mt-3">
          <div className="grid grid-cols-4 gap-2 mb-3 text-xs text-gray-500">
            <div><span className="font-medium text-gray-700">{answerKey.totalTransfers}</span> total</div>
            <div><span className="font-medium text-green-700">{answerKey.totalSuccess}</span> success</div>
            <div><span className="font-medium text-red-700">{answerKey.totalFailed}</span> failed</div>
            <div><span className="font-medium text-orange-700">{answerKey.totalStalled}</span> stalled</div>
          </div>
          {answerKey.findings.map(f => (
            <FindingCard key={f.arrivedfileKey} f={f} />
          ))}
        </div>
      )}
    </div>
  );
}
