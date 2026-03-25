import type { ScenarioStatus } from "@/lib/state/types";

const STYLES: Record<ScenarioStatus, string> = {
  not_run: "bg-gray-100 text-gray-600",
  submitted: "bg-amber-300 text-amber-900 border border-amber-600",
  drip_in_progress: "bg-yellow-100 text-yellow-700",
  frozen: "bg-green-100 text-green-700",
  finished: "bg-alpine-500 text-white border border-alpine-700",
};

const LABELS: Record<ScenarioStatus, string> = {
  not_run: "Not run",
  submitted: "Submitted",
  drip_in_progress: "Drip in progress",
  frozen: "Frozen",
  finished: "Finished",
};

export function StatusBadge({ status }: { status: ScenarioStatus }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
