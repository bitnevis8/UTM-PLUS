import proj4 from "proj4";

/**
 * Convert UTM (Easting, Northing, Zone, Hemisphere) to WGS84 lat/lon
 * @param {{ easting: number, northing: number, zone: number, hemisphere: 'north'|'south' }} params
 * @returns {{ lat: number, lon: number }}
 */
export function convertUtmToLatLon({ easting, northing, zone, hemisphere }) {
  const southFlag = hemisphere === "south" ? "+south" : "";
  const fromProj = `+proj=utm +zone=${zone} ${southFlag} +datum=WGS84 +units=m +no_defs`;
  const toProj = `+proj=longlat +datum=WGS84 +no_defs`;
  const [lon, lat] = proj4(fromProj, toProj, [easting, northing]);
  return { lat, lon };
}

/**
 * Bulk convert many UTM points to WGS84
 * @param {Array<{easting:number, northing:number, name:string}>} points
 * @param {{ zone:number, hemisphere:'north'|'south' }} opts
 */
export function convertManyUtmToLatLon(points, opts) {
  return points.map((p) => {
    const { lat, lon } = convertUtmToLatLon({
      easting: Number(p.easting),
      northing: Number(p.northing),
      zone: Number(opts.zone),
      hemisphere: opts.hemisphere,
    });
    return { ...p, lat, lon };
  });
}

/**
 * Derive UTM zone from longitude.
 * @param {number} lon
 */
export function zoneFromLongitude(lon) {
  let z = Math.floor((Number(lon) + 180) / 6) + 1;
  if (z < 1) z = 1;
  if (z > 60) z = 60;
  return z;
}

/**
 * Convert WGS84 lat/lon to UTM Easting/Northing
 * @param {{ lat:number, lon:number, zone?:number|'auto', hemisphere?:'north'|'south' }} params
 * @returns {{ easting:number, northing:number, zone:number, hemisphere:'north'|'south' }}
 */
export function convertLatLonToUtm({ lat, lon, zone, hemisphere }) {
  const computedHemisphere = hemisphere || (Number(lat) >= 0 ? "north" : "south");
  const z = zone && zone !== "auto" ? Number(zone) : zoneFromLongitude(lon);
  const southFlag = computedHemisphere === "south" ? "+south" : "";
  const fromProj = `+proj=longlat +datum=WGS84 +no_defs`;
  const toProj = `+proj=utm +zone=${z} ${southFlag} +datum=WGS84 +units=m +no_defs`;
  const [easting, northing] = proj4(fromProj, toProj, [Number(lon), Number(lat)]);
  return { easting, northing, zone: z, hemisphere: computedHemisphere };
}

/**
 * Bulk convert many WGS84 points to UTM
 * @param {Array<{lat:number, lon:number, name?:string}>} points
 * @param {{ zone?:number|'auto', hemisphere?:'north'|'south' }} [opts]
 */
export function convertManyLatLonToUtm(points, opts = {}) {
  return points.map((p) => {
    const { easting, northing, zone, hemisphere } = convertLatLonToUtm({
      lat: Number(p.lat),
      lon: Number(p.lon),
      zone: opts.zone,
      hemisphere: opts.hemisphere,
    });
    return { ...p, easting, northing, zone, hemisphere };
  });
}


