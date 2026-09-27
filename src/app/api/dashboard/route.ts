import { getDashboardSnapshot } from "@/lib/dashboardData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getDashboardSnapshot(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    console.error("Dashboard snapshot failed:", error);
    return Response.json({ error: "Unable to load walking data" }, { status: 503 });
  }
}
