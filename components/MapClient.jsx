"use client";

import dynamic from "next/dynamic";
 import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
 import { formatNumberFa } from "@/lib/format";
 import { polygonFromLatLng, polygonAreaSqm, edgeLengthsMeters, polygonCentroid } from "@/lib/geometry";

const MapContainer = dynamic(() => import("react-leaflet").then((m) => m.MapContainer), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then((m) => m.TileLayer), { ssr: false });
const Polyline = dynamic(() => import("react-leaflet").then((m) => m.Polyline), { ssr: false });
const CircleMarker = dynamic(() => import("react-leaflet").then((m) => m.CircleMarker), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then((m) => m.Marker), { ssr: false });
 // keep imports minimal to avoid SSR issues

 export default function MapClient({ points, focusFirstTrigger = 0 }) {
  const validPoints = useMemo(() => (points || []).filter((p) => Number.isFinite(p?.lat) && Number.isFinite(p?.lon)), [points]);
  const latlngs = useMemo(() => validPoints.map((p) => [p.lat, p.lon]), [validPoints]);
  const area = useMemo(() => (validPoints.length >= 3 ? polygonAreaSqm(validPoints) : 0), [validPoints]);
  const lengths = useMemo(() => (validPoints.length >= 2 ? edgeLengthsMeters(validPoints) : []), [validPoints]);

  // Midpoints of edges for labeling
  const midpoints = useMemo(() => {
    if (!validPoints || validPoints.length < 2) return [];
    return validPoints.map((a, i) => {
      const b = validPoints[(i + 1) % validPoints.length];
      return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    });
  }, [validPoints]);

  // Centroid for area label
  const centroid = useMemo(() => (validPoints.length >= 3 ? polygonCentroid(validPoints) : null), [validPoints]);

  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Compute desired initial center/zoom each time user clicks Show (focusFirstTrigger)
  const { desiredCenter, desiredZoom } = useMemo(() => {
    const valid = validPoints;
    if (valid.length === 0) return { desiredCenter: [0, 0], desiredZoom: 2 };
    if (valid.length === 1) return { desiredCenter: [valid[0].lat, valid[0].lon], desiredZoom: 19 };
    let c = polygonCentroid(valid);
    if (!c) {
      const b = L.latLngBounds(valid.map((p) => [p.lat, p.lon]));
      const center = b.getCenter();
      c = { lat: center.lat, lon: center.lng };
    }
    return { desiredCenter: [c.lat, c.lon], desiredZoom: 15 };
  }, [validPoints, focusFirstTrigger]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    map.invalidateSize(true);
  }, [mapReady, points, focusFirstTrigger]);

  return (
    <MapContainer
      key={focusFirstTrigger || 0}
      style={{ height: 500, width: "100%" }}
      center={desiredCenter}
      zoom={desiredZoom}
      maxZoom={22}
      scrollWheelZoom
      whenCreated={(map) => {
        mapRef.current = map;
        setMapReady(true);
      }}
    >
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />

      {latlngs.length >= 2 && (
        <Polyline positions={[...latlngs, latlngs[0]]} pathOptions={{ color: "#d32f2f", weight: 4 }} />
      )}

      {validPoints?.map((p, idx) => (
        <div key={`wrap-${idx}`}>
          <CircleMarker center={[p.lat, p.lon]} radius={4} pathOptions={{ color: "#1a237e", weight: 2, fill: true }} />
          <Marker position={[p.lat, p.lon]} icon={L.divIcon({ className: "", html: `<div style=\"background:#fff;padding:2px 6px;border:1px solid #999;border-radius:4px;font-size:12px\">${p.name}</div>` })} />
        </div>
      ))}

      {midpoints?.map((m, idx) => (
        <Marker key={`edge-${idx}`} position={[m.lat, m.lon]} icon={L.divIcon({ className: "", html: `<div style=\"background:#fff;padding:2px 6px;border:1px solid #999;border-radius:4px;font-size:12px\">${formatNumberFa(lengths[idx] ?? 0)}m</div>` })} />
      ))}

      {centroid && (
        <Marker position={[centroid.lat, centroid.lon]} icon={L.divIcon({ className: "", html: `<div style=\"background:#fff;padding:4px 8px;border:2px solid #000;border-radius:6px;font-size:14px;font-weight:700\">${formatNumberFa(area)}m²</div>` })} />
      )}
    </MapContainer>
  );
}


