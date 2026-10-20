import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/dashboardData";
import { generateWalkPlan } from "@/app/utils/routeGenerator";

export async function POST() {
  try {
    const snapshot = await getDashboardSnapshot();
    const plan = generateWalkPlan(snapshot.progress.unwalkedGeoJSON);
    return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to plan a walk", error);
    return NextResponse.json({ error: "Could not plan a walk. Please try again." }, { status: 500 });
  }
}
