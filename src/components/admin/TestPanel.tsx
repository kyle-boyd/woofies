"use client";

import { useState } from "react";

const PARTNERS = [
  { key: "meridian", label: "Meridian Capital Group (SFTP, PGP)" },
  { key: "lakeshore", label: "Lakeshore Clearing (CD)" },
  { key: "evergreen", label: "Evergreen Insurance Co. (HTTP)" },
  { key: "atlas", label: "Atlas Payroll Services (SFTP PULL)" },
  { key: "jdeere", label: "John Deere Financial (SFTP, PGP)" },
  { key: "fedline", label: "Federal Reserve FedLine (FTPS)" },
];

const PATTERNS = [
  { key: "happy_path", label: "1 — Happy path (full success)" },
  { key: "retry_success", label: "2 — Retry then success" },
  { key: "pgp_failure", label: "3 — PGP decrypt failure" },
  { key: "staging_failure", label: "4 — Staging/delivery failure" },
  { key: "partial_file", label: "5 — Partial file received" },
  { key: "virus_scan", label: "6 — Virus scan failure" },
  { key: "stalled", label: "7 — Stalled transfer" },
  { key: "slow_delivery", label: "8 — Slow delivery (45 min)" },
];

interface LogEntry {
  id: number;
  ts: string;
  type: "info" | "event" | "success" | "error" | "response";
  label: string;
  content?: string;
}

let logId = 0;

function LogLine({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false);

  const COLOR = {
    info: "text-gray-400",
    event: "text-blue-400",
    success: "text-green-400",
    error: "text-red-400",
    response: "text-yellow-300",
  };

  const hasContent = !!entry.content;

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div
        className={`flex gap-2 ${hasContent ? "cursor-pointer hover:opacity-80" : ""} ${COLOR[entry.type]}`}
        onClick={hasContent ? () => setExpanded(e => !e) : undefined}
      >
        <span className="text-gray-600 shrink-0">{entry.ts}</span>
        {hasContent && <span className="shrink-0">{expanded ? "▾" : "▸"}</span>}
        <span>{entry.label}</span>
      </div>
      {expanded && entry.content && (
        <pre className="mt-1 ml-8 p-2 bg-gray-900 rounded text-gray-200 overflow-x-auto text-xs whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
          {entry.content}
        </pre>
      )}
    </div>
  );
}

export function TestPanel() {
  const [open, setOpen] = useState(false);
  const [partnerKey, setPartnerKey] = useState("meridian");
  const [pattern, setPattern] = useState("happy_path");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);

  function addLog(type: LogEntry["type"], label: string, content?: string) {
    const ts = new Date().toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    setLog(prev => [...prev, { id: logId++, ts, type, label, content }]);
  }

  function clearLog() {
    setLog([]);
  }

  async function run(submit: boolean) {
    setLoading(true);
    const action = submit ? "Generate & Submit" : "Preview";
    addLog("info", `▶ ${action} — partner: ${partnerKey}, pattern: ${pattern}, date: ${date}`);

    try {
      const res = await fetch("/api/test/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ partnerKey, pattern, date, submit }),
      });

      const data = await res.json();

      if (!res.ok) {
        addLog("error", `✖ API error: ${data.error ?? res.statusText}`);
        return;
      }

      // Log generated transfer metadata
      addLog("info", `✔ Generated transfer: ${data.arrivedKey}`);
      addLog("info", `  Partner: ${data.partnerName}  |  Pattern: ${data.pattern}  |  Start: ${data.startTime?.slice(0, 19).replace("T", " ")} ET`);
      addLog("info", `  ${data.eventCount} events generated`);

      // Log each event (expandable)
      for (const evt of data.events) {
        const summary = `  [${evt.STAGE}] ${evt.Event}  TIME=${evt.TIME}  KEY=${evt.ARRIVEDFILE_KEY?.slice(-6)}`;
        addLog("event", summary, JSON.stringify(evt, null, 2));
      }

      // Log submission result if applicable
      if (submit && data.submissionResult) {
        const sr = data.submissionResult;
        if (sr.ok) {
          addLog("success", `✔ Submitted → HTTP ${sr.status}`, sr.body || "(empty body)");
        } else {
          addLog("error", `✖ Submission failed → HTTP ${sr.status}`, sr.body || "(empty body)");
        }
      } else if (submit) {
        addLog("error", "✖ No submission result returned");
      }

    } catch (err) {
      addLog("error", `✖ Fetch error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-4 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3 text-left hover:bg-gray-50"
        onClick={() => setOpen(o => !o)}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">Single transfer tester</span>
          <span className="text-xs text-gray-400">Generate one transfer, inspect events, optionally submit</span>
        </div>
        <span className="text-gray-400 text-sm">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100">
          {/* Controls */}
          <div className="px-5 py-4 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Partner</label>
              <select
                value={partnerKey}
                onChange={e => setPartnerKey(e.target.value)}
                disabled={loading}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white disabled:opacity-50 min-w-56"
              >
                {PARTNERS.map(p => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Pattern</label>
              <select
                value={pattern}
                onChange={e => setPattern(e.target.value)}
                disabled={loading}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 bg-white disabled:opacity-50 min-w-64"
              >
                {PATTERNS.map(p => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Date</label>
              <input
                type="date"
                value={date}
                onChange={e => setDate(e.target.value)}
                disabled={loading}
                className="text-xs border border-gray-300 rounded px-2 py-1.5 disabled:opacity-50"
              />
            </div>

            <div className="flex gap-2 items-end">
              <button
                onClick={() => run(false)}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-alpine-300 text-alpine-700 hover:bg-alpine-50 disabled:opacity-40"
              >
                Preview events
              </button>
              <button
                onClick={() => run(true)}
                disabled={loading}
                className="px-3 py-1.5 text-xs font-medium rounded-lg bg-alpine-700 text-white border border-alpine-900 hover:bg-alpine-800 disabled:opacity-40"
              >
                {loading ? "Running…" : "Generate & Submit"}
              </button>
              {log.length > 0 && (
                <button
                  onClick={clearLog}
                  disabled={loading}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-400 hover:text-slate-600 disabled:opacity-40"
                >
                  Clear log
                </button>
              )}
            </div>
          </div>

          {/* Log output */}
          {log.length > 0 && (
            <div className="border-t border-gray-100 bg-gray-950 px-4 py-3 max-h-[480px] overflow-y-auto space-y-0.5">
              {log.map(entry => (
                <LogLine key={entry.id} entry={entry} />
              ))}
            </div>
          )}

          {log.length === 0 && (
            <div className="border-t border-gray-100 bg-gray-950 px-4 py-6 text-center text-xs text-gray-600 font-mono">
              Click "Preview events" or "Generate &amp; Submit" to see output here
            </div>
          )}
        </div>
      )}
    </div>
  );
}
