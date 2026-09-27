import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const walkCount = await prisma.walk.count();
    return Response.json({ status: "ok", walkCount });
  } catch (error) {
    console.error("Walking Dashboard health check failed:", error);
    return Response.json({ status: "unhealthy" }, { status: 503 });
  }
}
