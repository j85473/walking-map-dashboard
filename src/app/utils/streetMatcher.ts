import type { Walk } from "../../lib/walkTypes";
import type { FeatureCollection } from "geojson";
import { buildStreetCoverage } from "../../lib/streetHeatmap.ts";

export type StreetFeature = {
  type: 'Feature';
  properties: {
    id: number;
    name: string;
    highway: string;
    foot?: string;
    access?: string;
    "oneway:foot"?: string;
  };
  geometry: {
    type: 'LineString';
    coordinates: [number, number][]; // [lon, lat]
  };
};

export type StridingResult = {
  totalMiles: number;
  walkedMiles: number;
  remainingMiles: number;
  unwalkedGeoJSON: {
    type: "FeatureCollection",
    features: StreetFeature[]
  };
};

/** Compatibility entry point; completion uses the same coverage as the map. */
export function processCityStriding(walks: Walk[], streetsGeoJSON: FeatureCollection): StridingResult {
  return buildStreetCoverage(walks, streetsGeoJSON.features as StreetFeature[]).progress;
}
