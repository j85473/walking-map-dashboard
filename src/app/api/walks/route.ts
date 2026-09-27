import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { invalidateDashboardSnapshot } from "@/lib/dashboardData";
import { validateWalk } from "@/lib/walkValidation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 8_000_000;

async function readBoundedJson(req: NextRequest): Promise<unknown> {
  if (!req.body) throw new Error("empty");
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error("too-large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Kept as a raw export endpoint. The dashboard itself requests a compact view.
export async function GET() {
  try {
    const rows = await prisma.walk.findMany({ orderBy: { date: "desc" } });
    return Response.json(rows.map(({ track, ...walk }) => ({
      ...walk,
      points: typeof track === "string" ? JSON.parse(track) : track,
    })), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error("Raw walking export failed:", error);
    return Response.json({ error: "Unable to export walks" }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  let input: unknown;
  try {
    input = await readBoundedJson(req);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error && error.message === "too-large" ? "Upload is too large" : "Invalid JSON upload" },
      { status: error instanceof Error && error.message === "too-large" ? 413 : 400 },
    );
  }
  if (!Array.isArray(input) || input.length === 0 || input.length > 20) {
    return Response.json({ error: "Upload 1 to 20 walks at a time" }, { status: 400 });
  }
  const walks = input.map(validateWalk);
  if (walks.some(walk => !walk)) {
    return Response.json({ error: "A walk has invalid details or GPS points" }, { status: 400 });
  }

  try {
    await prisma.$transaction(walks.map(walk => {
      const valid = walk!;
      const data = {
        name: valid.name,
        date: new Date(valid.date),
        distanceMiles: valid.distanceMiles,
        steps: valid.steps,
        track: valid.points,
      };
      return prisma.walk.upsert({
        where: { id: valid.id },
        update: data,
        create: { id: valid.id, ...data },
      });
    }));
    invalidateDashboardSnapshot();
    return Response.json({ saved: walks.length });
  } catch (error) {
    console.error("Walking upload failed:", error);
    return Response.json({ error: "Unable to save walks. Please retry." }, { status: 503 });
  }
}
