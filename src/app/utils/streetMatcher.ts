import { Walk } from '../page';

export type StreetFeature = {
  type: 'Feature';
  properties: {
    id: number;
    name: string;
    highway: string;
  };
  geometry: {
    type: string;
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

// Distance between two lat/lon points in miles
function haversineMiles(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function processCityStriding(walks: Walk[], streetsGeoJSON: any): StridingResult {
  // 1. Build Spatial Grid of all walked points
  // We use a simple Set with key "latIndex,lonIndex" for extreme performance
  const grid = new Set<string>();
  
  // 0.00015 degrees is roughly 15 meters lat / 11 meters lon
  // Checking a 3x3 block around this cell gives a ~35m radius, perfect for GPS drift
  const CELL_SIZE = 0.00015;
  
  for (const walk of walks) {
    if (!walk.points) continue;
    for (const pt of walk.points) {
      // pt is [lat, lon]
      const latIdx = Math.floor(pt[0] / CELL_SIZE);
      const lonIdx = Math.floor(pt[1] / CELL_SIZE);
      grid.add(`${latIdx},${lonIdx}`);
    }
  }

  // 2. Process Streets
  let totalMiles = 0;
  let walkedMiles = 0;
  const unwalkedFeatures: StreetFeature[] = [];

  const features = streetsGeoJSON.features as StreetFeature[];
  
  for (const feature of features) {
    const coords = feature.geometry.coordinates; // [lon, lat]
    if (!coords || coords.length < 2) continue;

    const unwalkedSegments: [number, number][][] = [];
    let currentUnwalkedSegment: [number, number][] = [];

    for (let i = 0; i < coords.length - 1; i++) {
      const lon1 = coords[i][0];
      const lat1 = coords[i][1];
      const lon2 = coords[i+1][0];
      const lat2 = coords[i+1][1];
      
      const segmentMiles = haversineMiles(lat1, lon1, lat2, lon2);
      totalMiles += segmentMiles;

      // Sample points along the segment every ~5 meters (0.003 miles)
      const numSamples = Math.max(2, Math.floor(segmentMiles / 0.003));
      let segmentWalked = false;

      for (let s = 0; s <= numSamples; s++) {
        const t = s / numSamples;
        const sampleLat = lat1 + t * (lat2 - lat1);
        const sampleLon = lon1 + t * (lon2 - lon1);

        const latIdx = Math.floor(sampleLat / CELL_SIZE);
        const lonIdx = Math.floor(sampleLon / CELL_SIZE);

        let hit = false;
        // Check 3x3 grid (center + 8 neighbors)
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            if (grid.has(`${latIdx + dx},${lonIdx + dy}`)) {
              hit = true;
              break;
            }
          }
          if (hit) break;
        }

        if (hit) {
          segmentWalked = true;
          break; // The whole small segment is considered walked if any sample hits
        }
      }

      if (segmentWalked) {
        walkedMiles += segmentMiles;
        // Break current unwalked line
        if (currentUnwalkedSegment.length > 0) {
          // ensure the line ends at the current start point so it connects smoothly
          currentUnwalkedSegment.push([lon1, lat1]);
          unwalkedSegments.push([...currentUnwalkedSegment]);
          currentUnwalkedSegment = [];
        }
      } else {
        // Add to unwalked
        if (currentUnwalkedSegment.length === 0) {
          currentUnwalkedSegment.push([lon1, lat1]);
        }
        currentUnwalkedSegment.push([lon2, lat2]);
      }
    }

    if (currentUnwalkedSegment.length > 0) {
      unwalkedSegments.push(currentUnwalkedSegment);
    }

    // Add unwalked segments to the GeoJSON output
    for (const seg of unwalkedSegments) {
      if (seg.length > 1) {
        unwalkedFeatures.push({
          type: "Feature",
          properties: { ...feature.properties },
          geometry: {
            type: "LineString",
            coordinates: seg
          }
        });
      }
    }
  }

  return {
    totalMiles: parseFloat(totalMiles.toFixed(2)),
    walkedMiles: parseFloat(walkedMiles.toFixed(2)),
    remainingMiles: parseFloat((totalMiles - walkedMiles).toFixed(2)),
    unwalkedGeoJSON: {
      type: "FeatureCollection",
      features: unwalkedFeatures
    }
  };
}
