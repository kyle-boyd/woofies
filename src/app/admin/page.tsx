"use client";

import useSWR from "swr";
import { SCENARIOS } from "@/lib/generator/scenarios";
import type { ScenarioState } from "@/lib/state/types";
import { ScenarioCard } from "@/components/admin/ScenarioCard";
import { BulkControls } from "@/components/admin/BulkControls";
import { TestPanel } from "@/components/admin/TestPanel";
import { useEffect } from "react";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then(r => r.json());

function rehydrateFromLocalStorage(states: ScenarioState[]) {
  if (typeof window === "undefined") return;
  for (const state of states) {
    const key = `woofies_scenario_${state.id}`;
    const cached = localStorage.getItem(key);
    if (!cached) continue;
    try {
      const parsed = JSON.parse(cached) as Partial<ScenarioState>;
      // Only rehydrate if cached has richer state than server (e.g. server cold-started)
      if (parsed.status && parsed.status !== "not_run" && state.status === "not_run") {
        fetch(`/api/scenarios/${state.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...parsed, rehydrate: true }),
        }).catch(() => {});
      }
    } catch {}
  }
}

export default function AdminPage() {
  const { data: states, mutate } = useSWR<ScenarioState[]>("/api/scenarios", fetcher, {
    refreshInterval: 3000,
  });

  // Rehydrate server state from localStorage on first load
  useEffect(() => {
    if (states) rehydrateFromLocalStorage(states);
  }, [!!states]); // only run once on first data load

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900">Woofies — Facilitator</h1>
          <p className="text-xs text-gray-500 mt-0.5">Syncrofy FTV dogfooding session control panel</p>
        </div>
        <Link
          href="/scenarios"
          className="text-xs font-medium text-alpine-700 hover:text-alpine-800 border border-alpine-300 rounded-lg px-3 py-1.5"
        >
          Participant view →
        </Link>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6">
        <TestPanel />

        <BulkControls onRefresh={() => mutate()} />

        <h2 className="text-sm font-semibold text-gray-700 mb-3">Scenarios</h2>

        {!states ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : (
          SCENARIOS.map(meta => {
            const state = states.find(s => s.id === meta.id);
            if (!state) return null;
            return (
              <ScenarioCard
                key={meta.id}
                meta={meta}
                state={state}
                onRefresh={() => mutate()}
              />
            );
          })
        )}
      </main>
    </div>
  );
}
