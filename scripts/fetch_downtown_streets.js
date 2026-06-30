const fs = require('fs');
const path = require('path');

// Exact Boundary Polygon: Hennepin Ave (W), I-94 (S), I-35W (E), River (N)
const POLYGON = "44.9798 -93.2458 44.9854 -93.2623 44.9685 -93.2847 44.9642 -93.2785 44.9646 -93.2655 44.9719 -93.2520 44.9798 -93.2458";

// Parse POLYGON string into array of [lon, lat] points for clipping
const polyCoords = POLYGON.split(" ").reduce((acc, val, i, arr) => {
  if (i % 2 === 0) acc.push([parseFloat(arr[i+1]), parseFloat(val)]); // [lon, lat]
  return acc;
}, []);

// Bounding box for the Overpass API query to avoid polygon timeouts
const BBOX = "44.964,-93.285,44.986,-93.245";

// Ray-casting algorithm to check if point is in polygon
function pointInPolygon(point, vs) {
    const x = point[0], y = point[1];
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i][0], yi = vs[i][1];
        const xj = vs[j][0], yj = vs[j][1];
        const intersect = ((yi > y) != (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

const OVERPASS_QUERY = `
  [out:json][timeout:25];
  way["highway"]
     ["highway"!~"motorway|motorway_link|trunk|trunk_link|footway|pedestrian|path|steps|cycleway|service|track|elevator|escalator|construction|proposed"]
     (${BBOX});
  out geom;
`;

async function fetchStreets() {
  console.log("Fetching streets from Overpass API...");
  
  try {
    const response = await fetch("https://lz4.overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(OVERPASS_QUERY)}`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'User-Agent': 'WalkingMap/1.0'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    const features = [];
    
    for (const element of data.elements) {
      if (element.type === 'way' && element.geometry) {
        const rawCoords = element.geometry.map(pt => [pt.lon, pt.lat]); // [lon, lat]
        
        // Strict boundary clipping: slice lines perfectly at the boundary
        const clippedSegments = [];
        let currentSegment = [];
        
        for (let i = 0; i < rawCoords.length; i++) {
          if (pointInPolygon(rawCoords[i], polyCoords)) {
            currentSegment.push(rawCoords[i]);
          } else {
            if (currentSegment.length > 0) {
              clippedSegments.push(currentSegment);
              currentSegment = [];
            }
          }
        }
        if (currentSegment.length > 0) {
          clippedSegments.push(currentSegment);
        }

        const tags = element.tags || {};
        
        for (const seg of clippedSegments) {
          if (seg.length > 1) { // A valid LineString needs at least 2 points
            features.push({
              type: "Feature",
              properties: {
                id: element.id,
                name: tags.name || "Unnamed Road",
                highway: tags.highway
              },
              geometry: {
                type: "LineString",
                coordinates: seg
              }
            });
          }
        }
      }
    }

    const geojson = {
      type: "FeatureCollection",
      features: features
    };

    const outPath = path.join(__dirname, '../public/downtown-streets.geojson');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(geojson));
    
    console.log(`Success! Saved ${features.length} precisely clipped street segments to ${outPath}`);
    
  } catch (error) {
    console.error("Failed to fetch from Overpass:", error);
  }
}

fetchStreets();
