"use client";

import useSWR from "swr";
import type { ScenarioState } from "@/lib/state/types";
import { SCENARIOS } from "@/lib/generator/scenarios";

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function ScenariosPage() {
  const { data: states, error } = useSWR<ScenarioState[]>("/api/scenarios", fetcher, {
    refreshInterval: 5000,
  });

  const activeStates = states?.filter(s => s.status !== "not_run") ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <h1 className="text-lg font-bold text-gray-900">Syncrofy FTV — Dogfooding Scenarios</h1>
        <p className="text-xs text-gray-500 mt-0.5">Work through the scenarios below using the Syncrofy interface</p>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8">
        {error ? (
          <div className="text-sm text-red-500 text-center py-12">
            Unable to load scenarios — the server may be restarting. Try refreshing the page.
          </div>
        ) : !states ? (
          <div className="text-sm text-gray-400 text-center py-12">Loading…</div>
        ) : activeStates.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No scenarios have been triggered yet.</p>
            <p className="text-gray-400 text-xs mt-1">The facilitator will activate scenarios before your session begins.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {activeStates.map(state => {
              const meta = SCENARIOS.find(s => s.id === state.id);
              if (!meta) return null;
              return (
                <div key={state.id} className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-start gap-3 mb-3">
                    <span className="text-xs font-mono text-gray-400 mt-0.5">#{meta.id}</span>
                    <div>
                      <h2 className="text-base font-bold text-gray-900">{meta.name}</h2>
                      <div className="mt-0.5">
                        <span className="text-sm font-medium text-gray-700">{meta.persona}</span>
                        <span className="text-sm text-gray-400"> — {meta.personaRole}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-100">
                    <p className="text-sm font-medium text-gray-700 mb-1">Situation</p>
                    <p className="text-sm text-gray-600">{meta.situation}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Your tasks</p>
                    <ol className="list-none space-y-2">
                      {meta.tasks.map((task, i) => (
                        <li key={i} className="flex gap-2.5 text-sm text-gray-700">
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                            {i + 1}
                          </span>
                          <span>{task}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
