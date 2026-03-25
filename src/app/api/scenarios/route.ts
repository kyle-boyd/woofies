import { NextResponse } from "next/server";
import { getAllStates, resetAllScenarios } from "@/lib/state/store";

export function GET() {
  return NextResponse.json(getAllStates());
}

export function DELETE() {
  resetAllScenarios();
  return NextResponse.json({ ok: true });
}
