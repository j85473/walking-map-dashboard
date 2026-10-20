import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { FeatureCollection, LineString } from "geojson";
import { isInsideDowntownSouthBoundary, splitDowntownStreetNetwork } from "../src/lib/downtownBoundary.ts";
import { processCityStriding } from "../src/app/utils/streetMatcher.ts";
import { distanceMiles } from "../src/app/utils/streetGraph.ts";
import { generateWalkPlan, WALK_HOME } from "../src/app/utils/routeGenerator.ts";

function street(coordinates: [number, number][]): FeatureCollection<LineString> {
  return { type: "FeatureCollection", features: [{
    type: "Feature", properties: { id: 1, name: "Boundary crossing", highway: "residential" },
    geometry: { type: "LineString", coordinates },
  }] };
}

function miles(network: FeatureCollection) {
  return network.features.reduce((sum, feature) => {
    assert.equal(feature.geometry?.type, "LineString");
    const coordinates = (feature.geometry as LineString).coordinates as [number, number][];
    return sum + coordinates.slice(1).reduce((total, point, index) => total + distanceMiles(coordinates[index], point), 0);
  }, 0);
}

const straightBoundary = [[-94, 45], [-93, 45]] as const;

test("southern cutoff excludes the photographed fragments while retaining the downtown side", () => {
  assert.equal(isInsideDowntownSouthBoundary([-93.2714945, 44.9653551]), false, "Clinton Avenue");
  assert.equal(isInsideDowntownSouthBoundary([-93.2704096, 44.9652264]), false, "East 18th west of I-35W");
  assert.equal(isInsideDowntownSouthBoundary([-93.2668785, 44.9652246]), false, "East 18th east of I-35W");
  assert.equal(isInsideDowntownSouthBoundary([-93.2753055, 44.9658495]), false, "Stevens Avenue");
  assert.equal(isInsideDowntownSouthBoundary([-93.2676654, 44.9662888]), true, "East 17th north of I-94");
  assert.equal(isInsideDowntownSouthBoundary([-93.28083, 44.966404]), true, "Oak Grove on the downtown side of I-94's curve");
});

test("crossing streets stop exactly at the cutoff even without a source vertex there", () => {
  const source = street([[-93.5, 44.9], [-93.5, 45.1]]);
  const before = structuredClone(source);
  const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(source, straightBoundary);
  assert.deepEqual(completionNetwork.features[0].geometry, { type: "LineString", coordinates: [[-93.5, 45], [-93.5, 45.1]] });
  assert.equal(routingNetwork.features.length, 2);
  assert.deepEqual(routingNetwork.features[0].geometry, { type: "LineString", coordinates: [[-93.5, 44.9], [-93.5, 45]] });
  assert.deepEqual(completionNetwork.features[0].properties, source.features[0].properties);
  assert.deepEqual(source, before);
  assert.ok(Math.abs(miles(source) - miles(routingNetwork)) < 1e-8);
});

test("multiple crossings do not connect separate inside pieces across outside streets", () => {
  const boundary = [[-94, 45], [-93.5, 45.2], [-93, 45]] as const;
  const source = street([[-94, 45.1], [-93, 45.1]]);
  const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(source, boundary);
  assert.equal(completionNetwork.features.length, 2);
  assert.equal(routingNetwork.features.length, 3);
  assert.deepEqual(completionNetwork.features.map(feature => (feature.geometry as LineString).coordinates), [
    [[-94, 45.1], [-93.75, 45.1]], [[-93.25, 45.1], [-93, 45.1]],
  ]);
});

test("inside, outside, and boundary-aligned streets retain the expected mileage", () => {
  for (const latitude of [44.9, 45, 45.1]) {
    const source = street([[-93.8, latitude], [-93.5, latitude], [-93.2, latitude]]);
    const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(source, straightBoundary);
    assert.deepEqual(routingNetwork, source);
    assert.deepEqual(completionNetwork.features, latitude < 45 ? [] : source.features);
  }
});

test("the bundled inventory loses only outside portions; routing retains its mileage", () => {
  const source = JSON.parse(readFileSync(new URL("../public/downtown-streets.geojson", import.meta.url), "utf8")) as FeatureCollection;
  const before = structuredClone(source);
  const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(source);
  assert.deepEqual(source, before);
  assert.ok(miles(completionNetwork) < miles(source));
  assert.ok(Math.abs(miles(source) - miles(routingNetwork)) < 1e-6);
  for (const feature of completionNetwork.features) {
    for (const point of (feature.geometry as LineString).coordinates) assert.ok(isInsideDowntownSouthBoundary(point));
  }
  for (const id of [1378457907, 41413504, 6032255, 6022143]) {
    assert.equal(completionNetwork.features.some(feature => feature.properties?.id === id), false, String(id));
  }
  const originalProgress = processCityStriding([], source);
  const downtownProgress = processCityStriding([], completionNetwork);
  assert.ok(downtownProgress.totalMiles < originalProgress.totalMiles);
  assert.equal(downtownProgress.remainingMiles, downtownProgress.totalMiles);
});

test("planner routing retains access from outside without credit for excluded streets", () => {
  const [longitude, latitude] = WALK_HOME.coordinates;
  const boundary = [[longitude - 0.01, latitude + 0.001], [longitude + 0.01, latitude + 0.001]] as const;
  const source = street([WALK_HOME.coordinates, [longitude, latitude + 0.002]]);
  const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(source, boundary);
  const plan = generateWalkPlan(completionNetwork, { streetNetwork: routingNetwork, maxWaypoints: 3 });
  assert.ok(plan);
  assert.ok(plan.novelMiles > 0);
  assert.ok(Math.abs(plan.novelMiles - miles(completionNetwork)) < 1e-8);
  for (const section of plan.targetSegments) {
    for (const point of section.coordinates) assert.ok(isInsideDowntownSouthBoundary(point, boundary));
  }
});
