export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
if (typeof URL.canParse !== 'function') {
  URL.canParse = function(url: string) {
    try { new URL(url); return true; } catch { return false; }
  };
}
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const walks = await prisma.walk.findMany({
      orderBy: { date: 'desc' }
    });
    return NextResponse.json(walks);
  } catch (error) {
    console.error("GET walks error:", error);
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const walks = await req.json();
    
    if (!Array.isArray(walks)) {
      return NextResponse.json({ error: "Expected an array of walks" }, { status: 400 });
    }

    const savedWalks = await prisma.$transaction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      walks.map((walk: any) => 
        prisma.walk.upsert({
          where: { id: walk.id },
          update: {
            name: walk.name,
            date: new Date(walk.date),
            distanceMiles: walk.distanceMiles,
            steps: walk.steps,
            track: walk.track,
          },
          create: {
            id: walk.id,
            name: walk.name,
            date: new Date(walk.date),
            distanceMiles: walk.distanceMiles,
            steps: walk.steps,
            track: walk.track,
          }
        })
      )
    );

    return NextResponse.json(savedWalks);
  } catch (error) {
    console.error("POST walks error:", error);
    const err = error as Error;
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
