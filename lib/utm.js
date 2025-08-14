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


