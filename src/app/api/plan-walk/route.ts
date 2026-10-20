import { NextResponse } from "next/server";
import { getDashboardSnapshot } from "@/lib/dashboardData";
import { generateWalkPlan, googleMapsWaypointLimit } from "@/app/utils/routeGenerator";

export async function POST(request: Request) {
  let maxWaypoints = googleMapsWaypointLimit(request.headers.get("user-agent") ?? "");
  if (request.headers.get("content-type")?.includes("application/json")) {
    let body;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid planning options." }, { status: 400 }); }
    if (!body || (body.maxWaypoints !== 3 && body.maxWaypoints !== 9)) {
      return NextResponse.json({ error: "Choose a supported route stop limit." }, { status: 400 });
    }
    maxWaypoints = body.maxWaypoints;
  }
  try {
    const snapshot = await getDashboardSnapshot();
    const plan = generateWalkPlan(snapshot.progress.unwalkedGeoJSON, { maxWaypoints });
    return NextResponse.json({ plan }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Unable to plan a walk", error);
    return NextResponse.json({ error: "Could not plan a walk. Please try again." }, { status: 500 });
  }
}
