import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { simplifyTrack } from "@/lib/simplifyTrack";
import type { Walk, WalkSummary } from "@/lib/walkTypes";
import { processCityStriding, type StridingResult } from "@/app/utils/streetMatcher";

export type DashboardSnapshot = {
  summary: WalkSummary;
  walks: Walk[];
  progress: StridingResult;
};

type SnapshotCache = {
  value?: DashboardSnapshot;
  validUntil: number;
  pending?: Promise<DashboardSnapshot>;
  pendingGeneration?: number;
  generation: number;
};

const shared = globalThis as typeof globalThis & { walkingSnapshotCache?: SnapshotCache };
const cache = shared.walkingSnapshotCache ??= { validUntil: 0, generation: 0 };

function parseStoredPoints(value: unknown): [number, number][] {
  let raw = value;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];

  const points: [number, number][] = [];
  for (const point of raw) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const [latitude, longitude] = point;
    if (typeof latitude === "number" && typeof longitude === "number" &&
        Number.isFinite(latitude) && Number.isFinite(longitude) &&
        Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
      points.push([latitude, longitude]);
    }
  }
  return points;
}

export async function getWalkSummary(): Promise<WalkSummary> {
  const result = await prisma.walk.aggregate({
    _count: { _all: true },
    _sum: { distanceMiles: true, steps: true },
    _max: { date: true },
  });
  return {
    count: result._count._all,
    distanceMiles: result._sum.distanceMiles ?? 0,
    steps: result._sum.steps ?? 0,
    latestDate: result._max.date?.toISOString() ?? null,
  };
}

async function buildSnapshot(): Promise<DashboardSnapshot> {
  const rows = await prisma.walk.findMany({
    select: { id: true, name: true, date: true, distanceMiles: true, steps: true, track: true },
    orderBy: { date: "desc" },
  });
  const rawWalks: Walk[] = rows.map(row => ({
    id: row.id,
    name: row.name,
    date: row.date.toISOString(),
    distanceMiles: row.distanceMiles,
    steps: row.steps,
    points: parseStoredPoints(row.track),
  }));
  const streets = JSON.parse(await readFile(path.join(process.cwd(), "public/downtown-streets.geojson"), "utf8"));
  const progress = processCityStriding(rawWalks, streets);
  return {
    summary: {
      count: rawWalks.length,
      distanceMiles: rawWalks.reduce((sum, walk) => sum + walk.distanceMiles, 0),
      steps: rawWalks.reduce((sum, walk) => sum + walk.steps, 0),
      latestDate: rawWalks[0]?.date ?? null,
    },
    walks: rawWalks.map(walk => ({ ...walk, points: simplifyTrack(walk.points) })),
    progress,
  };
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (cache.value && Date.now() < cache.validUntil) return cache.value;
  if (cache.pending && cache.pendingGeneration === cache.generation) return cache.pending;

  const generation = cache.generation;
  const pending = buildSnapshot();
  cache.pending = pending;
  cache.pendingGeneration = generation;
  try {
    const value = await pending;
    if (cache.generation === generation) {
      cache.value = value;
      cache.validUntil = Date.now() + 5 * 60_000;
    }
    return value;
  } finally {
    if (cache.pending === pending) cache.pending = undefined;
  }
}

export function invalidateDashboardSnapshot() {
  cache.generation++;
  cache.value = undefined;
  cache.validUntil = 0;
  cache.pending = undefined;
}
