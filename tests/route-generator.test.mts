import test from "node:test";
import assert from "node:assert/strict";
import type { FeatureCollection, Feature, LineString } from "geojson";
import { generateWalkPlan, generateWalkUrl, googleMapsWaypointLimit, WALK_HOME } from "../src/app/utils/routeGenerator.ts";

type Coordinate = [number, number];
const point = (east: number, north: number): Coordinate => [WALK_HOME.coordinates[0] + east, WALK_HOME.coordinates[1] + north];
const road = (name: string, coordinates: Coordinate[], tags: Record<string, string> = {}): Feature<LineString> => ({
  type: "Feature", properties: { name, highway: "residential", ...tags }, geometry: { type: "LineString", coordinates },
});
const collection = (...features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const location = ([lon, lat]: Coordinate) => `${lat},${lon}`;
const linkStops = (url: string) => {
  const params = new URL(url).searchParams;
  return [params.get("origin")!, ...(params.get("waypoints")?.split("|") ?? []), params.get("destination")!];
};
const chain = () => {
  const points = Array.from({ length: 5 }, (_, i) => point(i * 0.001, 0));
  const unwalked = collection(...points.slice(1, -1).map((a, index) => road(`Section ${index + 1}`, [a, points[index + 2]])));
  return { points, unwalked, network: collection(road("Corridor", points)) };
};

test("one anchor can close multiple unfinished fragments along a connected street", () => {
  const { unwalked, network } = chain();
  const plan = generateWalkPlan(unwalked, { streetNetwork: network, maxWaypoints: 1 })!;
  assert.ok(plan);
  assert.equal(plan.waypoints.length, 1);
  assert.equal(plan.sections.length, 3);
  assert.ok(plan.novelMiles > 0.14);
  assert.ok(plan.networkPath.length > plan.waypoints.length);
});

test("unfinished roads between anchors count even when home lies outside the mapped grid", () => {
  const { unwalked, points } = chain();
  const network = collection(road("Mapped corridor", points.slice(1)));
  const plan = generateWalkPlan(unwalked, { streetNetwork: network, maxWaypoints: 2 })!;
  assert.equal(plan.sections.length, 3);
  assert.equal(plan.waypoints.length, 2);
  assert.ok(plan.novelMiles > 0.14);
  assert.ok(plan.estimatedMiles > plan.novelMiles);
});

test("the main link contains all route anchors and returns to the confirmed home", () => {
  const { unwalked, network } = chain();
  const plan = generateWalkPlan(unwalked, { streetNetwork: network })!;
  const params = new URL(plan.url).searchParams;
  assert.equal(params.get("origin"), "2121 Garfield Ave S, Minneapolis, MN");
  assert.equal(params.get("destination"), params.get("origin"));
  assert.equal(params.get("travelmode"), "walking");
  assert.equal(params.get("api"), "1");
  assert.deepEqual(linkStops(plan.url), [WALK_HOME.address, ...plan.waypoints.map(location), WALK_HOME.address]);
  assert.deepEqual(plan.mobileUrls, [plan.url], "already-open tabs must also receive one complete loop");
  assert.ok(plan.waypoints.length <= 9);
});

test("efficiency beats a larger isolated fragment that needs a long repeated commute", () => {
  const near = road("Nearby progress", [point(0.001, 0), point(0.003, 0)]);
  const far = road("Far fragment", [point(-0.015, 0), point(-0.018, 0)]);
  const network = collection(road("Near access", [point(0, 0), point(0.001, 0)]), near,
    road("Long access", [point(0, 0), point(-0.015, 0)]), far);
  const plan = generateWalkPlan(collection(near, far), { streetNetwork: network })!;
  assert.deepEqual(plan.sections.map(section => section.name), ["Nearby progress"]);
  assert.ok(plan.estimatedMiles < 0.5);
  assert.ok(plan.coverageFraction > 0.3);
});

test("a new-street circuit wins over retracing the same roads", () => {
  const points = [point(0, 0), point(0.002, 0), point(0.002, 0.002), point(0, 0.002)];
  const sides = points.map((a, index) => road(`Side ${index}`, [a, points[(index + 1) % points.length]]));
  const unwalked = collection(...sides);
  const plan = generateWalkPlan(unwalked, { streetNetwork: unwalked, maxWaypoints: 3 })!;
  assert.equal(plan.sections.length, 4);
  assert.ok(Math.abs(plan.coverageFraction - 1) < 1e-10);
  assert.ok(Math.abs(plan.novelMiles - plan.estimatedMiles) < 1e-10);
});

test("out-and-back travel earns new mileage once while both directions count toward distance", () => {
  const edge = road("New street", [point(0, 0), point(0.002, 0)]);
  const plan = generateWalkPlan(collection(edge), { streetNetwork: collection(edge) })!;
  assert.equal(plan.sections.length, 1);
  assert.ok(Math.abs(plan.coverageFraction - 0.5) < 1e-10);
  assert.ok(Math.abs(plan.estimatedMiles - plan.novelMiles * 2) < 1e-10);
});

test("the total distance budget includes the full journey home", () => {
  const near = point(0.001, 0), end = point(0.002, 0);
  const unwalked = collection(road("Far end", [near, end]));
  const streetNetwork = collection(road("Whole street", [point(0, 0), near, end]));
  assert.equal(generateWalkPlan(unwalked, { streetNetwork, maxMiles: 0.15 }), null);
  const plan = generateWalkPlan(unwalked, { streetNetwork, maxMiles: 0.21 })!;
  assert.ok(plan && plan.estimatedMiles <= 0.21);
});

test("routes cannot jump from home's network component to a disconnected street", () => {
  const streetNetwork = collection(road("Home street", [point(0, 0), point(0.001, 0)]),
    road("Island", [point(0.01, 0.01), point(0.011, 0.01)]));
  const unwalked = collection(road("Island", [point(0.01, 0.01), point(0.011, 0.01)]));
  assert.equal(generateWalkPlan(unwalked, { streetNetwork }), null);
});

test("duplicate or reversed source geometry cannot inflate novelty or completion count", () => {
  const coordinates = [point(0, 0), point(0.002, 0)];
  const original = road("Original", coordinates), reverse = road("Reversed", [...coordinates].reverse());
  const single = generateWalkPlan(collection(original), { streetNetwork: collection(original) })!;
  const repeated = generateWalkPlan(collection(original, original, reverse), { streetNetwork: collection(original, reverse) })!;
  assert.equal(repeated.sections.length, 1);
  assert.equal(repeated.novelMiles, single.novelMiles);
  assert.equal(repeated.estimatedMiles, single.estimatedMiles);
});

test("repeated boundary points preserve geometry, distance, and source evidence", () => {
  const coordinates = [point(0, 0), point(0, 0), point(0.002, 0), point(0.002, 0)];
  const unwalked = collection(road("Repeated sample", coordinates));
  const before = JSON.stringify(unwalked);
  const plan = generateWalkPlan(unwalked, { streetNetwork: unwalked })!;
  assert.equal(plan.sections.length, 1);
  assert.ok(Math.abs(plan.coverageFraction - 0.5) < 1e-10);
  assert.equal(JSON.stringify(unwalked), before);
});

test("curved street mileage follows the mapped geometry rather than a straight-line shortcut", () => {
  const a = point(0.001, 0), bend = point(0.001, 0.003), end = point(0.003, 0.003);
  const unwalked = collection(road("Corner", [a, bend, end]));
  const network = collection(road("Whole road", [point(0, 0), a, bend, end]));
  const plan = generateWalkPlan(unwalked, { streetNetwork: network })!;
  assert.equal(plan.sections.length, 1);
  assert.ok(plan.networkPath.some(p => p[0] === bend[0] && p[1] === bend[1]));
  assert.ok(plan.estimatedMiles > 0.65);
});

test("motorways and explicitly private or forbidden foot connections cannot earn progress", () => {
  for (const tags of [{ highway: "motorway" }, { foot: "no" }, { access: "private" }]) {
    const forbidden = road("Forbidden", [point(0, 0), point(0.002, 0)], tags);
    assert.equal(generateWalkPlan(collection(forbidden), { streetNetwork: collection(forbidden) }), null);
  }
});

test("pedestrian one-way restrictions require a legal route back home", () => {
  const home = point(0, 0), east = point(0.002, 0), north = point(0.002, 0.002);
  const outward = road("One-way footpath", [home, east], { "oneway:foot": "yes" });
  assert.equal(generateWalkPlan(collection(outward), { streetNetwork: collection(outward) }), null);
  const circuit = collection(outward,
    road("Second side", [east, north], { "oneway:foot": "yes" }),
    road("Return side", [north, home], { "oneway:foot": "yes" }));
  const plan = generateWalkPlan(circuit, { streetNetwork: circuit })!;
  assert.equal(plan.sections.length, 3);
  assert.ok(Math.abs(plan.coverageFraction - 1) < 1e-10);
});

test("desktop and mobile limits apply to the whole route without a partial handoff", () => {
  const { unwalked, network } = chain();
  for (const maxWaypoints of [3, 9, 32]) {
    const plan = generateWalkPlan(unwalked, { streetNetwork: network, maxWaypoints })!;
    assert.ok(plan.waypoints.length <= Math.min(9, maxWaypoints));
    assert.deepEqual(linkStops(plan.url), [WALK_HOME.address, ...plan.waypoints.map(location), WALK_HOME.address]);
  }
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari"), 9);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (iPhone; CPU iPhone OS) Mobile Safari"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Linux; Android) Chrome Mobile"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (iPad; CPU OS) Safari"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Macintosh; Intel Mac OS X) Safari", 5), 3);
});

test("planning leaves both the remaining roads and the complete network unchanged", () => {
  const { unwalked, network } = chain();
  const before = JSON.stringify({ unwalked, network });
  generateWalkPlan(unwalked, { streetNetwork: network });
  assert.equal(JSON.stringify({ unwalked, network }), before);
});

test("empty, invalid, or non-street geometry cannot produce a plan", () => {
  const invalid = collection(road("Empty", []), road("Single", [point(0, 0)]),
    road("NaN", [[NaN, 44.97], point(0, 0)]), road("Out of range", [[200, 44.97], point(0, 0)]),
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point(0, 0) } });
  assert.equal(generateWalkPlan(invalid), null);
  assert.equal(generateWalkUrl(collection()), null);
  const { unwalked, network } = chain();
  assert.equal(generateWalkPlan(unwalked, { streetNetwork: network, maxMiles: NaN }), null);
  assert.equal(generateWalkPlan(unwalked, { streetNetwork: network, maxWaypoints: Infinity }), null);
  assert.equal(generateWalkPlan(unwalked, { streetNetwork: network, maxWaypoints: 0 }), null);
});
