const fs = require('fs');
const path = require('path');

const geojsonPath = path.join(__dirname, '../public/downtown-streets.geojson');
const data = JSON.parse(fs.readFileSync(geojsonPath, 'utf8'));

// We want to find features in the North-West area
const nwFeatures = data.features.filter(f => {
  let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
  f.geometry.coordinates.forEach(pt => {
    if (pt[1] < minLat) minLat = pt[1];
    if (pt[1] > maxLat) maxLat = pt[1];
    if (pt[0] < minLon) minLon = pt[0];
    if (pt[0] > maxLon) maxLon = pt[0];
  });
  
  // Roughly NW of Hennepin: Lon < -93.272 and Lat > 44.975
  return minLon < -93.272 && maxLat > 44.975;
});

const names = new Set();
nwFeatures.forEach(f => names.add(f.properties.name || f.properties.highway));
console.log("Features in the NW area:", nwFeatures.length);
console.log("Names:", Array.from(names));
