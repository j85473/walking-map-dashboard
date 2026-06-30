const fs = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '../public/downtown-streets.geojson');
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

console.log("Total features:", data.features.length);

const outOfBounds = data.features.filter(f => {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  f.geometry.coordinates.forEach(pt => {
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[1] > maxLat) maxLat = pt[1];
    if (pt[0] < minLon) minLon = pt[0];
    if (pt[0] > maxLon) maxLon = pt[0];
  });
  
  // Define strict boundaries based on the screenshot issues
  const isTooFarSouth = minLat < 44.9665;
  const isTooFarWest = minLon < -93.284 && minLat < 44.975; // West of I-94 near Loring Park
  const isTooFarNorthWest = minLat > 44.985 && minLon < -93.280; // North Loop over I-94
  const isNorthOfRiver = maxLat > 44.985 && maxLon > -93.255; // Across the river
  const isTooFarEast = maxLon > -93.248; // East of I-35W
  
  return isTooFarSouth || isTooFarWest || isTooFarNorthWest || isNorthOfRiver || isTooFarEast;
});

console.log("Features out of bounds:", outOfBounds.length);
// print some names
const names = new Set();
outOfBounds.forEach(f => names.add(f.properties.name || f.properties.highway));
console.log("Names to drop:", Array.from(names));
