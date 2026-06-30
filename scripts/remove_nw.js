const fs = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '../public/downtown-streets.geojson');
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

const initialCount = data.features.length;

function isNWOfHennepin(lon, lat) {
  // Line A: [-93.2623, 44.9854] (Hennepin Ave bridge at river)
  // Line B: [-93.2847, 44.9685] (Hennepin Ave at I-94)
  // m = 0.75446
  // We add a tiny buffer (0.0005) to keep Hennepin itself intact.
  const lineLat = 44.9854 + 0.75446 * (lon + 93.2623);
  return lat > lineLat + 0.0005;
}

const newFeatures = [];

for (const feature of data.features) {
  if (feature.geometry && feature.geometry.type === 'LineString') {
    const rawCoords = feature.geometry.coordinates;
    const clippedSegments = [];
    let currentSegment = [];
    
    for (let i = 0; i < rawCoords.length; i++) {
      const lon = rawCoords[i][0];
      const lat = rawCoords[i][1];
      
      if (!isNWOfHennepin(lon, lat)) {
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
      if (seg.length > 1) { 
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
console.log(`Clipped the North Loop! Went from ${initialCount} to ${newFeatures.length} segments.`);
