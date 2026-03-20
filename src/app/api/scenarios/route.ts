import { NextResponse } from "next/server";
import { getAllStates } from "@/lib/state/store";

export function GET() {
  return NextResponse.json(getAllStates());
}
