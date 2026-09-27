import type { Walk } from "./walkTypes";

export function validateWalk(value: unknown): Walk | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const walk = value as Record<string, unknown>;
  if (typeof walk.id !== "string" || !walk.id.trim() || walk.id.length > 512 ||
      typeof walk.name !== "string" || !walk.name.trim() || walk.name.length > 512 ||
      typeof walk.date !== "string" || !Number.isFinite(Date.parse(walk.date)) ||
      typeof walk.distanceMiles !== "number" || !Number.isFinite(walk.distanceMiles) ||
      walk.distanceMiles < 0 || walk.distanceMiles > 1000 ||
      typeof walk.steps !== "number" || !Number.isSafeInteger(walk.steps) ||
      walk.steps < 0 || walk.steps > 100_000_000 ||
      !Array.isArray(walk.points) || walk.points.length < 2 || walk.points.length > 100_000) {
    return null;
  }

  const points: [number, number][] = [];
  for (const point of walk.points) {
    if (!Array.isArray(point) || point.length !== 2 ||
        typeof point[0] !== "number" || typeof point[1] !== "number" ||
        !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
        Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) return null;
    points.push([point[0], point[1]]);
  }

  return {
    id: walk.id,
    name: walk.name,
    date: new Date(walk.date).toISOString(),
    distanceMiles: walk.distanceMiles,
    steps: walk.steps,
    points,
  };
}
