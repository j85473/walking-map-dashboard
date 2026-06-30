const fs = require('fs');
const path = require('path');

const POLYGON = "44.9798 -93.2458 44.9849 -93.2604 44.9904 -93.2750 44.9839 -93.2820 44.9744 -93.2899 44.9656 -93.2875 44.9642 -93.2785 44.9646 -93.2655 44.9719 -93.2520 44.9798 -93.2458";

// Parse POLYGON string into array of [lon, lat] points for clipping
const polyCoords = POLYGON.split(" ").reduce((acc, val, i, arr) => {
  if (i % 2 === 0) acc.push([parseFloat(arr[i+1]), parseFloat(val)]); // [lon, lat]
  return acc;
}, []);

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

const geojsonPath = path.join(__dirname, '../public/downtown-streets.geojson');
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

const newFeatures = [];

for (const feature of data.features) {
  if (feature.geometry && feature.geometry.type === 'LineString') {
    const rawCoords = feature.geometry.coordinates;
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
    
    for (const seg of clippedSegments) {
      if (seg.length > 1) { // A valid LineString needs at least 2 points
        newFeatures.push({
          type: "Feature",
          properties: feature.properties,
          geometry: {
            type: "LineString",
            coordinates: seg
          }
        });
      }
    }
  }
}

const outData = {
  type: "FeatureCollection",
  features: newFeatures
};

fs.writeFileSync(geojsonPath, JSON.stringify(outData));
console.log(`Successfully clipped streets locally to boundary! Result: ${newFeatures.length} segments.`);
