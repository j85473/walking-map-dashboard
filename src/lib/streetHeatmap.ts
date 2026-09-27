import type { Walk } from "./walkTypes";
import type { StreetFeature } from "../app/utils/streetMatcher";
import { simplifyTrack } from "./simplifyTrack.ts";

type Point = [number, number]; // latitude, longitude
export type StreetHeatSegment = { start: Point; end: Point; visits: number };
export type StreetHeatmap = {
  segments: StreetHeatSegment[];
  unmatchedRoutes: Point[][];
};

type IndexedSegment = {
  start: Point;
  end: Point;
  x1: number;
  y1: number;
  dx: number;
  dy: number;
  lengthSquared: number;
  bins: number;
  offset: number;
};

const LATITUDE_SCALE = 111_132;
const LONGITUDE_SCALE = 111_320 * Math.cos(44.98 * Math.PI / 180);
const CELL_METERS = 45;
const MATCH_METERS = 28;
const BIN_METERS = 12;
const MAX_GPS_GAP_METERS = 120;

function toXY(point: Point): [number, number] {
  return [point[1] * LONGITUDE_SCALE, point[0] * LATITUDE_SCALE];
}

function cellKey(x: number, y: number) {
  return `${Math.floor(x / CELL_METERS)},${Math.floor(y / CELL_METERS)}`;
}

function band(visits: number) {
  if (visits <= 2) return 0;
  if (visits <= 4) return 1;
  if (visits <= 7) return 2;
  if (visits <= 11) return 3;
  return 4;
}

function interpolate(segment: IndexedSegment, fraction: number): Point {
  return [
    segment.start[0] + (segment.end[0] - segment.start[0]) * fraction,
    segment.start[1] + (segment.end[1] - segment.start[1]) * fraction,
  ];
}

/** Match each GPS sample to the nearest mapped street, without changing stored GPS. */
export function buildStreetHeatmap(walks: Walk[], features: StreetFeature[]): StreetHeatmap {
  const segments: IndexedSegment[] = [];
  const index = new Map<string, number[]>();
  let totalBins = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const feature of features) {
    if (feature.geometry?.type !== "LineString") continue;
    const coordinates = feature.geometry.coordinates;
    for (let i = 0; i < coordinates.length - 1; i++) {
      const start: Point = [coordinates[i][1], coordinates[i][0]];
      const end: Point = [coordinates[i + 1][1], coordinates[i + 1][0]];
      const [x1, y1] = toXY(start);
      const [x2, y2] = toXY(end);
      const dx = x2 - x1, dy = y2 - y1;
      const lengthSquared = dx * dx + dy * dy;
      if (lengthSquared < 0.01) continue;
      const bins = Math.max(1, Math.ceil(Math.sqrt(lengthSquared) / BIN_METERS));
      const segmentIndex = segments.length;
      segments.push({ start, end, x1, y1, dx, dy, lengthSquared, bins, offset: totalBins });
      totalBins += bins;
      minX = Math.min(minX, x1, x2);
      minY = Math.min(minY, y1, y2);
      maxX = Math.max(maxX, x1, x2);
      maxY = Math.max(maxY, y1, y2);
      const left = Math.floor((Math.min(x1, x2) - MATCH_METERS) / CELL_METERS);
      const right = Math.floor((Math.max(x1, x2) + MATCH_METERS) / CELL_METERS);
      const bottom = Math.floor((Math.min(y1, y2) - MATCH_METERS) / CELL_METERS);
      const top = Math.floor((Math.max(y1, y2) + MATCH_METERS) / CELL_METERS);
      for (let gx = left; gx <= right; gx++) {
        for (let gy = bottom; gy <= top; gy++) {
          const key = `${gx},${gy}`;
          const candidates = index.get(key);
          if (candidates) candidates.push(segmentIndex);
          else index.set(key, [segmentIndex]);
        }
      }
    }
  }

  const visits = new Uint16Array(totalBins);
  const unmatchedRoutes: Point[][] = [];
  const maxMatchSquared = MATCH_METERS * MATCH_METERS;
  const maxGapSquared = MAX_GPS_GAP_METERS * MAX_GPS_GAP_METERS;

  for (const walk of walks) {
    const walkedBins = new Set<number>();
    let fallback: Point[] = [];
    let previousSegmentIndex = -1;
    let previousBin = -1;
    let previousX = 0;
    let previousY = 0;
    const flushFallback = () => {
      if (fallback.length >= 2) unmatchedRoutes.push(simplifyTrack(fallback));
      fallback = [];
    };

    for (const point of walk.points) {
      const [x, y] = toXY(point);
      let nearestIndex = -1;
      let nearestFraction = 0;
      let bestDistanceSquared = maxMatchSquared;
      if (x >= minX - MATCH_METERS && x <= maxX + MATCH_METERS &&
          y >= minY - MATCH_METERS && y <= maxY + MATCH_METERS) {
        for (const candidateIndex of index.get(cellKey(x, y)) ?? []) {
          const segment = segments[candidateIndex];
          const fraction = Math.max(0, Math.min(1,
            ((x - segment.x1) * segment.dx + (y - segment.y1) * segment.dy) / segment.lengthSquared));
          const residualX = x - (segment.x1 + fraction * segment.dx);
          const residualY = y - (segment.y1 + fraction * segment.dy);
          const distanceSquared = residualX * residualX + residualY * residualY;
          if (distanceSquared < bestDistanceSquared) {
            bestDistanceSquared = distanceSquared;
            nearestIndex = candidateIndex;
            nearestFraction = fraction;
          }
        }
      }

      if (nearestIndex >= 0) {
        flushFallback();
        const segment = segments[nearestIndex];
        const bin = Math.min(segment.bins - 1, Math.floor(nearestFraction * segment.bins));
        walkedBins.add(segment.offset + bin);
        if (previousSegmentIndex === nearestIndex &&
            (x - previousX) ** 2 + (y - previousY) ** 2 < maxGapSquared) {
          for (let current = Math.min(bin, previousBin); current <= Math.max(bin, previousBin); current++) {
            walkedBins.add(segment.offset + current);
          }
        }
        previousSegmentIndex = nearestIndex;
        previousBin = bin;
        previousX = x;
        previousY = y;
      } else {
        previousSegmentIndex = -1;
        if (fallback.length) {
          const [lastX, lastY] = toXY(fallback[fallback.length - 1]);
          if ((x - lastX) ** 2 + (y - lastY) ** 2 > maxGapSquared) flushFallback();
        }
        fallback.push(point);
      }
    }
    flushFallback();
    for (const bin of walkedBins) visits[bin]++;
  }

  const heatSegments: StreetHeatSegment[] = [];
  for (const segment of segments) {
    let startBin = 0;
    while (startBin < segment.bins) {
      const count = visits[segment.offset + startBin];
      if (!count) { startBin++; continue; }
      const colorBand = band(count);
      let endBin = startBin + 1;
      let maxVisits = count;
      while (endBin < segment.bins && visits[segment.offset + endBin] > 0 &&
             band(visits[segment.offset + endBin]) === colorBand) {
        maxVisits = Math.max(maxVisits, visits[segment.offset + endBin]);
        endBin++;
      }
      heatSegments.push({
        start: interpolate(segment, startBin / segment.bins),
        end: interpolate(segment, endBin / segment.bins),
        visits: maxVisits,
      });
      startBin = endBin;
    }
  }
  return { segments: heatSegments, unmatchedRoutes };
}
