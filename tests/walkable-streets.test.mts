import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { runInNewContext } from "node:vm";
import type { Feature, FeatureCollection, LineString } from "geojson";
import { isWalkableStreet } from "../src/lib/walkableStreets.ts";
import { splitDowntownStreetNetwork } from "../src/lib/downtownBoundary.ts";
import { processCityStriding } from "../src/app/utils/streetMatcher.ts";
import { buildStreetGraph } from "../src/app/utils/streetGraph.ts";
import { generateWalkPlan, WALK_HOME } from "../src/app/utils/routeGenerator.ts";

const rampIds = new Set([77705844, 131707294, 637977008, 896398028, 999006637, 1040803393]);
const road = (tags: Record<string, string> = {}): Feature<LineString> => ({
  type: "Feature", properties: { id: 1, name: "Washington Avenue South", highway: "secondary", ...tags },
  geometry: { type: "LineString", coordinates: [WALK_HOME.coordinates, [WALK_HOME.coordinates[0] + 0.001, WALK_HOME.coordinates[1]]] },
});
const network = (feature: Feature): FeatureCollection => ({ type: "FeatureCollection", features: [feature] });

test("pedestrian restrictions apply to city road classes as well as highway ramps", () => {
  for (const tags of [{ foot: "no" }, { foot: "private" }, { foot: "use_sidepath" }, { access: "private" },
    { access: "no" }, { highway: "motorway_link" }, { highway: "trunk_link" }]) {
    assert.equal(isWalkableStreet(road(tags)), false, JSON.stringify(tags));
  }
  for (const tags of [{}, { foot: "yes" }, { access: "private", foot: "designated" },
    { access: "no", foot: "permissive" }, { highway: "footway" }]) {
    assert.equal(isWalkableStreet(road(tags)), true, JSON.stringify(tags));
  }
});

test("a forbidden ramp cannot count, be a target, or serve as route access", () => {
  for (const tags of [{ foot: "no" }, { foot: "use_sidepath" }, { access: "private" }, { highway: "motorway_link" }]) {
    const streets = network(road(tags));
    const progress = processCityStriding([], streets);
    assert.equal(progress.totalMiles, 0);
    assert.equal(progress.remainingMiles, 0);
    assert.deepEqual(progress.unwalkedGeoJSON.features, []);
    const split = splitDowntownStreetNetwork(streets);
    assert.equal(split.completionNetwork.features.length, 0);
    assert.equal(split.routingNetwork.features.length, 0);
    assert.equal(buildStreetGraph(streets).edges.length, 0);
    // Even a stale caller-supplied target must not earn credit on another route.
    assert.equal(generateWalkPlan(streets, { streetNetwork: network(road()) }), null);
  }
});

test("the six photographed ramp pieces retain foot=no and cannot enter either network", () => {
  const streets = JSON.parse(readFileSync(new URL("../public/downtown-streets.geojson", import.meta.url), "utf8")) as FeatureCollection;
  const ramps = streets.features.filter(feature => rampIds.has(feature.properties?.id));
  assert.equal(ramps.length, 6);
  assert.ok(ramps.every(feature => feature.properties?.foot === "no"));
  const { completionNetwork, routingNetwork } = splitDowntownStreetNetwork(streets);
  for (const collection of [completionNetwork, routingNetwork]) {
    assert.ok(collection.features.every(feature => !rampIds.has(feature.properties?.id)));
  }
  const regularWashington = streets.features.find(feature => feature.properties?.id === 1036270878)!;
  const nearbyFifthStreet = streets.features.find(feature => feature.properties?.id === 663540077)!;
  assert.ok(isWalkableStreet(regularWashington));
  assert.ok(isWalkableStreet(nearbyFifthStreet));
  assert.ok(completionNetwork.features.some(feature => feature.properties?.id === 663540077));
});

test("street acquisition preserves pedestrian access and directional metadata", async () => {
  const script = readFileSync(new URL("../scripts/fetch_downtown_streets.js", import.meta.url), "utf8");
  let output: FeatureCollection | undefined;
  const tags = { highway: "secondary", name: "Washington Avenue South", foot: "no", access: "private", "oneway:foot": "-1" };
  await runInNewContext(script, {
    require: (name: string) => name === "path" ? path : {
      mkdirSync: () => {},
      writeFileSync: (_path: string, json: string) => { output = JSON.parse(json); },
    },
    __dirname: "/test/scripts", console: { log: () => {}, error: (error: unknown) => { throw error; } },
    fetch: async () => ({ ok: true, json: async () => ({ elements: [{ id: 77705844, type: "way", tags,
      geometry: [{ lon: -93.266, lat: 44.975 }, { lon: -93.265, lat: 44.975 }],
    }] }) }),
  });
  assert.ok(output);
  assert.equal(output.features.length, 1);
  assert.equal(output.features[0].properties?.foot, "no");
  assert.equal(output.features[0].properties?.access, "private");
  assert.equal(output.features[0].properties?.["oneway:foot"], "-1");
  assert.equal(isWalkableStreet(output.features[0]), false);
});
