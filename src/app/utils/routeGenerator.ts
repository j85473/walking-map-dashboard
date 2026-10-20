import type { FeatureCollection } from "geojson";
import { simplifyTrack } from "../../lib/simplifyTrack.ts";

type Coordinate = [number, number]; // longitude, latitude

export const WALK_HOME = {
  address: "2121 Garfield Ave S, Minneapolis, MN",
  // Resolved by Google Maps for the confirmed address. Directions still use
  // the address so the same home appears as both the origin and destination.
  coordinates: [-93.2864753, 44.9613767] as Coordinate,
};

export type WalkSection = {
  name: string;
  coordinates: Coordinate[];
  miles: number;
};

export type WalkPlan = {
  url: string;
  // Already-open dashboard tabs use the first entry. It must also contain the
  // whole loop, never a partial trip ending away from home.
  mobileUrls: [string];
  waypoints: Coordinate[];
  sections: WalkSection[];
  novelMiles: number;
  estimatedMiles: number;
};

type Candidate = WalkSection & {
  id: number;
  pins: Coordinate[];
  edges: Map<string, number>;
};
type Visit = { section: Candidate; reverse: boolean };
type SearchState = {
  visits: Visit[];
  pins: Coordinate[];
  edges: Set<string>;
  novelMiles: number;
  miles: number;
  score: number;
};

export function googleMapsWaypointLimit(userAgent: string, maxTouchPoints = 0): 3 | 9 {
  const mobileBrowser = /Android|iPhone|iPad|iPod/i.test(userAgent) ||
    (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
  return mobileBrowser ? 3 : 9;
}

function distance(a: Coordinate, b: Coordinate) {
  const radians = Math.PI / 180;
  const halfLat = (b[1] - a[1]) * radians / 2;
  const halfLon = (b[0] - a[0]) * radians / 2;
  const h = Math.sin(halfLat) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(halfLon) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

function pointKey(point: Coordinate) {
  return `${point[0].toFixed(7)},${point[1].toFixed(7)}`;
}

function edgeKey(a: Coordinate, b: Coordinate) {
  return [pointKey(a), pointKey(b)].sort().join("|");
}

function candidatesFrom(geoJSON: FeatureCollection): Candidate[] {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  for (const feature of geoJSON.features) {
    if (feature.geometry?.type !== "LineString") continue;
    const raw = feature.geometry.coordinates;
    if (raw.length < 2 || raw.some(point => point.length < 2 ||
      !Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90)) continue;
    const coordinates: Coordinate[] = [];
    for (const point of raw) {
      const coordinate: Coordinate = [point[0], point[1]];
      if (!coordinates.length || pointKey(coordinates.at(-1)!) !== pointKey(coordinate)) coordinates.push(coordinate);
    }
    if (coordinates.length < 2) continue;
    const edges = new Map<string, number>();
    let miles = 0;
    for (let index = 1; index < coordinates.length; index++) {
      const length = distance(coordinates[index - 1], coordinates[index]);
      edges.set(edgeKey(coordinates[index - 1], coordinates[index]), length);
      miles += length;
    }
    const identity = [...edges.keys()].sort().join(";");
    if (miles < 0.00001 || seen.has(identity)) continue;
    seen.add(identity);
    // Keep both ends and significant bends, so a stop cannot merely touch the
    // midpoint of a road. GPS/GeoJSON coordinates use the opposite axis order.
    const pins = simplifyTrack(coordinates.map(([lon, lat]) => [lat, lon]), 8)
      .map(([lat, lon]): Coordinate => [lon, lat]);
    candidates.push({ id: candidates.length, name: String(feature.properties?.name || "Unnamed street"), coordinates, pins, edges, miles });
  }
  return candidates;
}

function measure(visits: Visit[]) {
  let miles = 0;
  let previous = WALK_HOME.coordinates;
  const pins: Coordinate[] = [];
  for (const { section, reverse } of visits) {
    const sectionPins = reverse ? [...section.pins].reverse() : section.pins;
    // Outside the mapped sections we have no pedestrian routing engine. Allow
    // for the street grid, and label this estimate rather than routed mileage.
    miles += distance(previous, sectionPins[0]) * 1.3 + section.miles;
    for (const pin of sectionPins) {
      if (!pins.length || pointKey(pins.at(-1)!) !== pointKey(pin)) pins.push(pin);
    }
    previous = sectionPins.at(-1)!;
  }
  miles += distance(previous, WALK_HOME.coordinates) * 1.3;
  return { miles, pins };
}

function compare(a: SearchState, b: SearchState) {
  return b.score - a.score || b.novelMiles - a.novelMiles || a.miles - b.miles;
}

function directions(origin: string, destination: string, waypoints: string[]) {
  const params = new URLSearchParams({ api: "1", origin, destination, travelmode: "walking" });
  if (waypoints.length) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** A bounded coverage search, not a guarantee of the global optimal tour.
 * Every candidate is a complete unfinished section. Both orientations and
 * every insertion position are tried; the best 24 alternatives survive each
 * round. Repeated geometry earns no additional novelty. The return home is
 * included before admitting a section into the distance budget.
 */
export function generateWalkPlan(
  unwalkedGeoJSON: FeatureCollection,
  options: { maxMiles?: number; maxWaypoints?: number } = {},
): WalkPlan | null {
  const maxMiles = options.maxMiles ?? 7;
  const requestedWaypoints = options.maxWaypoints ?? 9;
  // A plan must fit in one Google Maps route, including the return home.
  // Mobile browsers use a smaller budget, supplied by the client.
  const maxWaypoints = Math.min(9, Math.floor(requestedWaypoints));
  if (!Number.isFinite(maxMiles) || maxMiles <= 0 || !Number.isFinite(requestedWaypoints) || maxWaypoints < 2 ||
      !unwalkedGeoJSON || !Array.isArray(unwalkedGeoJSON.features)) return null;
  const candidates = candidatesFrom(unwalkedGeoJSON);
  const empty: SearchState = { visits: [], pins: [], edges: new Set(), novelMiles: 0, miles: 0, score: 0 };
  let beam = [empty];
  let best = empty;
  const beamWidth = 24;

  for (let round = 0; round < maxWaypoints && beam.length; round++) {
    const next: SearchState[] = [];
    const seen = new Set<string>();
    for (const state of beam) {
      for (const section of candidates) {
        if (state.visits.some(visit => visit.section.id === section.id)) continue;
        let addedMiles = 0;
        for (const [key, miles] of section.edges) if (!state.edges.has(key)) addedMiles += miles;
        if (addedMiles < 0.00001) continue;
        const novelMiles = state.novelMiles + addedMiles;
        // Reward unique new mileage and finishing a section, not distance
        // spent on connectors or walking a selected road a second time.
        const score = novelMiles + (state.visits.length + 1) * 0.05;
        if (next.length === beamWidth && score < next.at(-1)!.score) continue;
        for (let position = 0; position <= state.visits.length; position++) {
          for (const reverse of [false, true]) {
            const visits = [...state.visits];
            visits.splice(position, 0, { section, reverse });
            const identity = visits.map(visit => `${visit.section.id}:${Number(visit.reverse)}`).join(",");
            if (seen.has(identity)) continue;
            seen.add(identity);
            const measured = measure(visits);
            if (measured.pins.length > maxWaypoints || measured.miles > maxMiles) continue;
            const edges = new Set(state.edges);
            for (const key of section.edges.keys()) edges.add(key);
            const candidate = { visits, ...measured, edges, novelMiles, score };
            next.push(candidate);
            next.sort(compare);
            if (next.length > beamWidth) next.pop();
          }
        }
      }
    }
    beam = next;
    if (beam.length && compare(beam[0], best) < 0) best = beam[0];
  }
  if (!best.visits.length) return null;

  const waypointStrings = best.pins.map(([lon, lat]) => `${lat},${lon}`);
  const url = directions(WALK_HOME.address, WALK_HOME.address, waypointStrings);
  return {
    url,
    mobileUrls: [url],
    waypoints: best.pins,
    sections: best.visits.map(({ section, reverse }) => ({
      name: section.name,
      miles: section.miles,
      coordinates: reverse ? [...section.coordinates].reverse() : section.coordinates,
    })),
    novelMiles: best.novelMiles,
    estimatedMiles: best.miles,
  };
}

export function generateWalkUrl(unwalkedGeoJSON: FeatureCollection): string | null {
  return generateWalkPlan(unwalkedGeoJSON)?.url ?? null;
}
