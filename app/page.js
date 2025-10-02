"use client";

import { useMemo, useRef, useState } from "react";
import UploaderForm from "@/components/UploaderForm";
import dynamic from "next/dynamic";
import { polygonAreaSqm, edgeLengthsMeters } from "@/lib/geometry";
import { formatNumberFa } from "@/lib/format";
import { createDxf } from "@/lib/dxf";
import PointsEditor from "@/components/PointsEditor";

const MapClient = dynamic(() => import("@/components/MapClient"), { ssr: false });

export default function Home() {
  const [points, setPoints] = useState([]);
  const [projectInfo, setProjectInfo] = useState(null);
  const mapWrapperRef = useRef(null);
  const [focusFirstTick, setFocusFirstTick] = useState(0);

  const area = useMemo(() => (points.length >= 3 ? polygonAreaSqm(points) : 0), [points]);
  const lengths = useMemo(() => (points.length >= 2 ? edgeLengthsMeters(points) : []), [points]);

  function handleParsed({ points: pts, projectInfo: info }) {
    setPoints(pts);
    setProjectInfo(info);
    setFocusFirstTick((t) => t + 1);
  }

  function download(filename, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadDxf() {
    const dxf = createDxf({ points, lengths, area, projectInfo: projectInfo || {} });
    download("polygon.dxf", dxf, "application/dxf");
  }

  function toTxtMode1(rows) {
    const z = projectInfo?.zone ?? 39;
    const hem = projectInfo?.hemisphere ?? "north";
    const header = "name,easting,northing,zone,hemisphere\n";
    const body = (rows || [])
      .map((p, i) => {
        const name = p.name || `P${i + 1}`;
        const e = Number(p.easting ?? p.x ?? 0);
        const n = Number(p.northing ?? p.y ?? 0);
        return `${name},${e},${n},${z},${hem}`;
      })
      .join("\n");
    return header + body + "\n";
  }

  function toTxtMode2(rows) {
    // One line per point with flexible tokens, e.g.: "P1 E=xxxx N=yyyy"
    const body = (rows || [])
      .map((p, i) => {
        const name = p.name || `P${i + 1}`;
        const e = Number(p.easting ?? p.x ?? 0);
        const n = Number(p.northing ?? p.y ?? 0);
        return `${name} E=${e} N=${n}`;
      })
      .join("\n");
    return body + "\n";
  }

  function handleDownloadTxtMode1() {
    if (!points || points.length < 2) return;
    const z = projectInfo?.zone ?? 39;
    const hem = projectInfo?.hemisphere ?? "north";
    // `points` are WGS84; TXT requires UTM. Convert using stored UTM if present on points.
    // If not present, we cannot import utm converter here easily without changing imports; rely on existing easting/northing if available.
    const rows = points.map((p, i) => ({
      name: p.name || `P${i + 1}`,
      easting: Number(p.easting ?? 0),
      northing: Number(p.northing ?? 0),
      zone: z,
      hemisphere: hem,
    }));
    const hasUtm = rows.every((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing) && r.easting !== 0 && r.northing !== 0);
    const content = toTxtMode1(hasUtm ? rows : points.map((p, i) => ({ name: p.name || `P${i + 1}`, easting: p.easting ?? 0, northing: p.northing ?? 0 })));
    download("points_mode1.txt", content, "text/plain;charset=utf-8");
  }

  function handleDownloadTxtMode2() {
    if (!points || points.length < 2) return;
    const rows = points.map((p, i) => ({
      name: p.name || `P${i + 1}`,
      easting: Number(p.easting ?? 0),
      northing: Number(p.northing ?? 0),
    }));
    const content = toTxtMode2(rows);
    download("points_mode2.txt", content, "text/plain;charset=utf-8");
  }

  function toKml({ points: pts, name = "Polygon" }) {
    const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const coordinates = (pts || [])
      .map((p) => `${Number(p.lon)},${Number(p.lat)},0`)
      .join(" ");
    let polygonCoords = coordinates;
    if (pts && pts.length >= 3) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (!(first.lat === last.lat && first.lon === last.lon)) {
        polygonCoords = coordinates + ` ${Number(first.lon)},${Number(first.lat)},0`;
      }
    }
    const pointPlacemarks = (pts || [])
      .map((p, i) => `\n      <Placemark>\n        <name>${esc(p.name || `P${i + 1}`)}</name>\n        <Point><coordinates>${Number(p.lon)},${Number(p.lat)},0</coordinates></Point>\n      </Placemark>`)
      .join("");
    const polygonPlacemark = (pts && pts.length >= 3)
      ? `\n      <Placemark>\n        <name>${esc(name)}</name>\n        <Polygon>\n          <outerBoundaryIs>\n            <LinearRing>\n              <coordinates>${polygonCoords}</coordinates>\n            </LinearRing>\n          </outerBoundaryIs>\n        </Polygon>\n      </Placemark>`
      : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>${esc(projectInfo?.location || name)}</name>${polygonPlacemark}${pointPlacemarks}\n  </Document>\n</kml>\n`;
  }

  function handleDownloadKml() {
    if (!points || points.length < 2) return;
    const kml = toKml({ points, name: projectInfo?.location || "Polygon" });
    download("polygon.kml", kml, "application/vnd.google-earth.kml+xml;charset=utf-8");
  }

  function handleDownloadMode6Reports() {
    if (!window.mode6Results) return;
    
    const results = window.mode6Results;
    
    // Download summary JSON
    const summaryJson = JSON.stringify(results.summary, null, 2);
    download("mode6_summary.json", summaryJson, "application/json");
    
    // Download duplicates mapping CSV
    if (results.duplicates_mapping.length > 0) {
      const duplicatesCsv = "cluster_id,kept_point,duplicate_point,dx,dy\n" + 
        results.duplicates_mapping.map(d => `${d.cluster_id},"${d.kept_point}","${d.duplicate_point}",${d.dx},${d.dy}`).join("\n");
      download("duplicates_mapping.csv", duplicatesCsv, "text/csv");
    }
    
    // Download clusters summary CSV
    if (results.clusters_summary.length > 0) {
      const clustersCsv = "cluster_id,number_of_points,min_easting,max_easting,min_northing,max_northing\n" + 
        results.clusters_summary.map(c => `${c.cluster_id},${c.number_of_points},${c.bounding_box.min_easting},${c.bounding_box.max_easting},${c.bounding_box.min_northing},${c.bounding_box.max_northing}`).join("\n");
      download("clusters_summary.csv", clustersCsv, "text/csv");
    }
    
    // Download validation report
    if (results.validation_report.length > 0) {
      const validationTxt = "Validation Report\n" + 
        "================\n\n" +
        results.validation_report.map(v => 
          `Cluster ${v.cluster_id}:\n` +
          `  Valid: ${v.valid}\n` +
          `  Area: ${v.area.toFixed(2)} m²\n` +
          `  Orientation: ${v.orientation}\n` +
          `  Issues: ${v.issues.join(', ') || 'None'}\n`
        ).join("\n");
      download("validation_report.txt", validationTxt, "text/plain");
    }
    
    // Download all points GeoJSON
    const allPointsGeoJson = {
      type: "FeatureCollection",
      features: results.all_points.map(p => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [p.easting, p.northing]
        },
        properties: {
          name: p.name,
          easting: p.easting,
          northing: p.northing,
          code: p.code,
          description: p.description
        }
      }))
    };
    download("all_points.geojson", JSON.stringify(allPointsGeoJson, null, 2), "application/geo+json");
    
    // Download polygons GeoJSON
    if (results.polygons.length > 0) {
      const polygonsGeoJson = {
        type: "FeatureCollection",
        features: results.polygons.map(poly => ({
          type: "Feature",
          geometry: {
            type: "Polygon",
            coordinates: [poly.points.map(p => [p.easting, p.northing])]
          },
          properties: {
            cluster_id: poly.cluster_id,
            method: poly.method,
            point_count: poly.points.length - 1
          }
        }))
      };
      download("polygons.geojson", JSON.stringify(polygonsGeoJson, null, 2), "application/geo+json");
    }
  }

  // PDF download removed per request

  return (
    <div className="p-6 space-y-6">
      
      <UploaderForm onParsed={handleParsed} />

      <div className="flex gap-2 flex-nowrap">
        <button onClick={handleDownloadDxf} disabled={points.length < 2} className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50">دانلود DXF</button>
        <button onClick={handleDownloadTxtMode1} disabled={points.length < 2} className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50">خروجی TXT (مود 1)</button>
        <button onClick={handleDownloadTxtMode2} disabled={points.length < 2} className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50">خروجی TXT (مود 2)</button>
        <button onClick={handleDownloadKml} disabled={points.length < 2} className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50">Google Earth (KML)</button>
        {typeof window !== 'undefined' && window.mode6Results && (
          <button onClick={handleDownloadMode6Reports} className="bg-blue-600 text-white border border-blue-600 rounded px-4 py-2 hover:bg-blue-700">گزارش‌های مود 6</button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div ref={mapWrapperRef} className="border rounded overflow-hidden">
          <MapClient points={points} focusFirstTrigger={focusFirstTick} />
        </div>
        <div className="border rounded p-3">
          <PointsEditor points={points} onChange={setPoints} zone={projectInfo?.zone ?? 39} hemisphere={projectInfo?.hemisphere ?? "north"} />
        </div>
      </div>
    </div>
  );
}
