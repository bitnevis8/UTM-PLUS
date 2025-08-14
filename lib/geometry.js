import * as turf from "@turf/turf";

export function polygonFromLatLng(points) {
  // points: Array<{lat, lon, name, easting, northing}>
  const coords = points.map((p) => [p.lon, p.lat]);
  if (coords.length > 2) {
    const first = coords[0];
    const last = coords[coords.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) coords.push(first);
  }
  const poly = turf.polygon([coords], {});
  return poly;
}

export function polygonAreaSqm(points) {
  const poly = polygonFromLatLng(points);
  return turf.area(poly);
}

export function edgeLengthsMeters(points) {
  const lengths = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const line = turf.lineString([
      [a.lon, a.lat],
      [b.lon, b.lat],
    ]);
    const km = turf.length(line, { units: "kilometers" });
    lengths.push(km * 1000);
  }
  return lengths;
}

export function polygonCentroid(points) {
  if (!points || points.length < 3) return null;
  const poly = polygonFromLatLng(points);
  const cm = turf.centerOfMass(poly);
  if (!cm || !cm.geometry || !cm.geometry.coordinates) return null;
  const [lon, lat] = cm.geometry.coordinates;
  return { lat, lon };
}


