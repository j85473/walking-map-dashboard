import test from "node:test";
import assert from "node:assert/strict";
import type { FeatureCollection, Feature, LineString } from "geojson";
import { generateWalkPlan, generateWalkUrl, googleMapsWaypointLimit, WALK_HOME } from "../src/app/utils/routeGenerator.ts";

type Coordinate = [number, number];
const point = (east: number, north: number): Coordinate => [WALK_HOME.coordinates[0] + east, WALK_HOME.coordinates[1] + north];
const road = (name: string, coordinates: Coordinate[]): Feature<LineString> => ({
  type: "Feature", properties: { name }, geometry: { type: "LineString", coordinates },
});
const collection = (...features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });
const stops = (url: string) => {
  const params = new URL(url).searchParams;
  return [params.get("origin")!, ...(params.get("waypoints")?.split("|") ?? []), params.get("destination")!];
};
const location = ([lon, lat]: Coordinate) => `${lat},${lon}`;

test("walks start and end at the confirmed home and target section endpoints", () => {
  const data = collection(
    road("First", [point(0, 0.001), point(0.002, 0.001)]),
    road("Second", [point(0.002, 0.002), point(0.004, 0.002)]),
  );
  const before = JSON.stringify(data);
  const plan = generateWalkPlan(data)!;
  assert.ok(plan);
  assert.ok(plan.url);
  const params = new URL(plan.url).searchParams;
  assert.equal(params.get("origin"), "2121 Garfield Ave S, Minneapolis, MN");
  assert.equal(params.get("destination"), params.get("origin"));
  assert.equal(params.get("travelmode"), "walking");
  assert.equal(params.get("api"), "1");
  assert.equal(plan.sections.length, 2);
  for (const section of plan.sections) {
    const ordered = stops(plan.url);
    const first = ordered.indexOf(location(section.coordinates[0]));
    const last = ordered.indexOf(location(section.coordinates.at(-1)!));
    assert.ok(first > 0 && last > first, "both ends occur in traversal order");
  }
  assert.equal(generateWalkUrl(data), plan.url);
  assert.equal(JSON.stringify(data), before, "planning must not change coverage evidence");
});

test("coverage beats the nearest midpoint when stops are limited", () => {
  const plan = generateWalkPlan(collection(
    road("Tiny nearby fragment", [point(0, 0.0001), point(0.0002, 0.0001)]),
    road("Longer unfinished road", [point(0.001, 0.001), point(0.009, 0.001)]),
  ), { maxWaypoints: 2 })!;
  assert.equal(plan.sections.length, 1);
  assert.equal(plan.sections[0].name, "Longer unfinished road");
  assert.ok(plan.novelMiles > 0.3);
});

test("connected sections share stops without forcing arbitrary spacing", () => {
  const plan = generateWalkPlan(collection(
    road("One", [point(0, 0.001), point(0.001, 0.001)]),
    road("Two", [point(0.001, 0.001), point(0.002, 0.001)]),
    road("Three", [point(0.002, 0.001), point(0.003, 0.001)]),
  ), { maxWaypoints: 4 })!;
  assert.equal(plan.sections.length, 3);
  assert.equal(plan.waypoints.length, 4);
});

test("the distance budget reserves the journey home before accepting a road", () => {
  const remote = road("Too far for a round trip", [point(0, 0.009), point(0.0002, 0.009)]);
  assert.equal(generateWalkPlan(collection(remote), { maxMiles: 1 }), null);
  const plan = generateWalkPlan(collection(remote,
    road("Near home", [point(0, 0.001), point(0.001, 0.001)]),
  ), { maxMiles: 1 })!;
  assert.deepEqual(plan.sections.map(section => section.name), ["Near home"]);
  assert.ok(plan.estimatedMiles <= 1);
  assert.ok(plan.estimatedMiles > plan.novelMiles);
});

test("curved roads retain bends and cannot be substituted with a midpoint visit", () => {
  const coordinates = [point(0, 0.001), point(0.002, 0.001), point(0.002, 0.003)];
  const plan = generateWalkPlan(collection(road("Corner", coordinates)))!;
  assert.ok(plan.url);
  assert.equal(plan.waypoints.length, 3);
  for (const coordinate of coordinates) assert.ok(stops(plan.url).includes(location(coordinate)));
  assert.equal(generateWalkPlan(collection(road("Corner", coordinates)), { maxWaypoints: 2 }), null);
});

test("duplicate and reversed geometry cannot inflate new mileage", () => {
  const coordinates = [point(0, 0.001), point(0.002, 0.001), point(0.004, 0.001)];
  const single = generateWalkPlan(collection(road("Original", coordinates)))!;
  const repeated = generateWalkPlan(collection(
    road("Original", coordinates), road("Duplicate", coordinates), road("Reversed", [...coordinates].reverse()),
  ))!;
  assert.equal(repeated.sections.length, 1);
  assert.equal(repeated.novelMiles, single.novelMiles);
});

test("repeated GPS points at a section boundary preserve the full target without adding mileage", () => {
  const start = point(0, 0.001);
  const end = point(0.002, 0.001);
  const plain = generateWalkPlan(collection(road("Section", [start, end])))!;
  const repeatedData = collection(road("Section", [start, start, end, end]));
  const before = JSON.stringify(repeatedData);
  const repeated = generateWalkPlan(repeatedData)!;
  assert.equal(repeated.url, plain.url);
  assert.equal(repeated.novelMiles, plain.novelMiles);
  assert.equal(repeated.estimatedMiles, plain.estimatedMiles);
  assert.equal(JSON.stringify(repeatedData), before);
});

test("the primary directions link contains the entire advertised walk and return home", () => {
  const plan = generateWalkPlan(collection(...Array.from({ length: 4 }, (_, index) =>
    road(`Road ${index}`, [point(index * 0.003, 0.001), point(index * 0.003 + 0.001, 0.001)]),
  )))!;
  assert.equal(plan.sections.length, 4);
  assert.ok(plan.waypoints.length <= 9);
  assert.ok(plan.url);
  assert.equal(new URL(plan.url).searchParams.get("travelmode"), "walking");
  assert.deepEqual(stops(plan.url), [WALK_HOME.address, ...plan.waypoints.map(location), WALK_HOME.address]);
  assert.deepEqual(plan.mobileUrls, [plan.url], "the action in already-open tabs must also open the whole loop");
});

test("the planner selects fewer targets when necessary to keep the whole walk in one link", () => {
  const data = collection(...Array.from({ length: 6 }, (_, index) =>
    road(`Road ${index}`, [point(index * 0.003, 0.001), point(index * 0.003 + 0.001, 0.001)]),
  ));
  const plan = generateWalkPlan(data)!;
  assert.ok(plan.sections.length < data.features.length);
  assert.ok(plan.waypoints.length <= 9);
  assert.deepEqual(stops(plan.url), [WALK_HOME.address, ...plan.waypoints.map(location), WALK_HOME.address]);
  assert.deepEqual(generateWalkPlan(data, { maxWaypoints: 32 }), plan, "oversized budgets cannot produce a partial main link");
  for (const section of plan.sections) {
    assert.ok(stops(plan.url).includes(location(section.coordinates[0])));
    assert.ok(stops(plan.url).includes(location(section.coordinates.at(-1)!)));
  }
});

test("mobile browser plans fit three intermediate stops and keep home as the final destination", () => {
  const data = collection(...Array.from({ length: 6 }, (_, index) =>
    road(`Road ${index}`, [point(index * 0.003, 0.001), point(index * 0.003 + 0.001, 0.001)]),
  ));
  const plan = generateWalkPlan(data, { maxWaypoints: 3 })!;
  assert.ok(plan.sections.length > 0);
  assert.ok(plan.waypoints.length <= 3);
  assert.deepEqual(stops(plan.url), [WALK_HOME.address, ...plan.waypoints.map(location), WALK_HOME.address]);
  assert.deepEqual(plan.mobileUrls, [plan.url]);
});

test("desktop and mobile browser budgets reflect Google's single-route limits", () => {
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15"), 9);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile Safari"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Linux; Android 15) Chrome Mobile"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)"), 3);
  assert.equal(googleMapsWaypointLimit("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari", 5), 3);
});

test("empty, degenerate, invalid, or non-street geometry cannot produce a walk", () => {
  assert.equal(generateWalkPlan(collection()), null);
  assert.equal(generateWalkUrl(collection()), null);
  const invalid = collection(
    road("Empty", []), road("Single", [point(0, 0)]), road("Repeated", [point(0, 0), point(0, 0)]),
    road("NaN", [[NaN, 44.97], point(0, 0)]), road("Out of range", [[200, 44.97], point(0, 0)]),
    { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: point(0, 0) } },
  );
  assert.equal(generateWalkPlan(invalid), null);
  const valid = collection(road("Valid", [point(0, 0.001), point(0.001, 0.001)]));
  assert.equal(generateWalkPlan(valid, { maxMiles: NaN }), null);
  assert.equal(generateWalkPlan(valid, { maxWaypoints: Infinity }), null);
});
