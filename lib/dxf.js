import Drawing from "dxf-writer";
import { formatNumber } from "@/lib/format";

/**
 * Create DXF content with layers: Polygon, Labels, Points
 * @param {{ points: Array<{lat:number, lon:number, name:string, easting:number, northing:number}> , lengths: number[], area: number }} data
 */
export function createDxf({ points, lengths, area }) {
  const d = new Drawing();
  d.setUnits("Meters");

  // Define layers with basic ACI colors (1:red, 3:green, 4:cyan, 5:blue, 6:magenta)
  d.addLayer("Polygon", 1, "CONTINUOUS");
  d.addLayer("Points", 5, "CONTINUOUS");
  d.addLayer("PointNames", 4, "CONTINUOUS");
  d.addLayer("EdgeLengths", 3, "CONTINUOUS");
  d.addLayer("AreaLabel", 6, "CONTINUOUS");
  d.addLayer("PointTable", 7, "CONTINUOUS");
  d.addLayer("PointTableGrid", 2, "CONTINUOUS");

  // Prefer UTM easting/northing if present for metric DXF
  d.setActiveLayer("Polygon");
  // Use UTM coordinates directly if available; otherwise fallback to lon/lat
  const verts = points.map((p) => [Number(p.easting ?? p.lon), Number(p.northing ?? p.lat)]);
  const xs = verts.map((v) => v[0]);
  const ys = verts.map((v) => v[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = Math.max(1, maxX - minX);
  const dy = Math.max(1, maxY - minY);
  const diag = Math.sqrt(dx * dx + dy * dy);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  // Use conservative, readable sizes similar to common CAD defaults
  const pointRadius = 1.5;
  const textHPoint = 2.5;
  const textHEdge = 2.5;
  const textHArea = 3.5;
  // Draw polygon using lightweight polyline if available
  if (typeof d.drawPolyline === "function" && verts.length >= 2) {
    d.setActiveLayer("Polygon");
    d.drawPolyline(verts, true);
  } else if (verts.length >= 2) {
    d.setActiveLayer("Polygon");
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      d.drawLine(a[0], a[1], 0, b[0], b[1], 0);
    }
  }

  d.setActiveLayer("Points");
  points.forEach((p) => {
    const x = Number(p.easting ?? p.lon);
    const y = Number(p.northing ?? p.lat);
    if (typeof d.drawCircle === "function") {
      d.drawCircle(x, y, pointRadius);
    } else {
      d.drawPoint(x, y, 0);
    }
  });

  d.setActiveLayer("PointNames");
  points.forEach((p) => {
    const x = Number(p.easting ?? p.lon);
    const y = Number(p.northing ?? p.lat);
    const ox = pointRadius * 1.2;
    const oy = pointRadius * 1.2;
    d.drawText(x + ox, y + oy, textHPoint, 0, p.name ?? "", "left", "baseline");
  });
  // Edge length labels at midpoints (no leader lines)
  d.setActiveLayer("EdgeLengths");
  points.forEach((p, i) => {
    const a = p;
    const b = points[(i + 1) % points.length];
    const ax = Number(a.easting ?? a.lon);
    const ay = Number(a.northing ?? a.lat);
    const bx = Number(b.easting ?? b.lon);
    const by = Number(b.northing ?? b.lat);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // Small perpendicular offset for readability (5m)
    const dxv = bx - ax;
    const dyv = by - ay;
    const len = Math.hypot(dxv, dyv) || 1;
    const nx = -dyv / len;
    const ny = dxv / len;
    const lx = mx + nx * 5;
    const ly = my + ny * 5;
    d.drawText(lx, ly, textHEdge, 0, `${(lengths[i] ?? 0).toFixed(2)}m`, "center", "middle");
  });

  if (points.length >= 3) {
    d.setActiveLayer("AreaLabel");
    const cx = points.reduce((s, p) => s + (p.easting ?? p.lon), 0) / points.length;
    const cy = points.reduce((s, p) => s + (p.northing ?? p.lat), 0) / points.length;
    d.drawText(cx, cy, textHArea, 0, `${area.toFixed(2)}m^2`, "center", "middle");
  }

  // Draw a 3-column table with a single header spanning all columns: "UTM Coordinate"
  try {
    const xs2 = points.map((p) => Number(p.easting ?? p.lon));
    const ys2 = points.map((p) => Number(p.northing ?? p.lat));
    const maxX2 = Math.max(...xs2);
    const maxY2 = Math.max(...ys2);
    const marginX = 20;
    const tableLeft = maxX2 + marginX;
    const tableTop = maxY2;
    const colNameW = 30;
    const colEW = 40;
    const colNW = 40;
    const rowH = 6;
    const totalW = colNameW + colEW + colNW;
    const rowsBody = points.length; // only body rows
    const totalH = rowH /* header */ + rowsBody * rowH;
    const tableRight = tableLeft + totalW;
    const tableBottom = tableTop - totalH;

    // Outer border
    d.setActiveLayer("PointTableGrid");
    d.drawRect(tableLeft, tableBottom, tableRight, tableTop);
    // Header separator
    const headerBottomY = tableTop - rowH;
    d.drawLine(tableLeft, headerBottomY, tableRight, headerBottomY);
    // Body horizontal lines
    for (let i = 1; i <= rowsBody; i++) {
      const y = headerBottomY - i * rowH;
      d.drawLine(tableLeft, y, tableRight, y);
    }
    // Body vertical lines (don’t cross header)
    const colXs = [tableLeft + colNameW, tableLeft + colNameW + colEW];
    for (const x of colXs) d.drawLine(x, headerBottomY, x, tableBottom);

    // Header title centered
    d.setActiveLayer("PointTable");
    const headerY = tableTop - rowH / 2;
    d.drawText(tableLeft + totalW / 2, headerY, 2.5, 0, "UTM Coordinate", "center", "middle");

    // Body rows content
    const padX = 1.5;
    for (let i = 0; i < rowsBody; i++) {
      const p = points[i];
      const centerY = headerBottomY - i * rowH - rowH / 2;
      const e = Number(p.easting ?? p.lon);
      const n = Number(p.northing ?? p.lat);
      d.drawText(tableLeft + padX, centerY, 2.5, 0, String(p.name ?? `P${i + 1}`), "left", "middle");
      d.drawText(tableLeft + colNameW + padX, centerY, 2.5, 0, formatNumber(e, 3), "left", "middle");
      d.drawText(tableLeft + colNameW + colEW + padX, centerY, 2.5, 0, formatNumber(n, 3), "left", "middle");
    }
  } catch (_err) {
    // best-effort: ignore table drawing failure
  }

  return d.toDxfString();
}


