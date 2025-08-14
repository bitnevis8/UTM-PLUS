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

 export default function MapClient({ points }) {
  const latlngs = useMemo(() => points?.map((p) => [p.lat, p.lon]) ?? [], [points]);
  const area = useMemo(() => (points && points.length >= 3 ? polygonAreaSqm(points) : 0), [points]);
  const lengths = useMemo(() => (points && points.length >= 2 ? edgeLengthsMeters(points) : []), [points]);

  // Midpoints of edges for labeling
  const midpoints = useMemo(() => {
    if (!points || points.length < 2) return [];
    return points.map((a, i) => {
      const b = points[(i + 1) % points.length];
      return { lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 };
    });
  }, [points]);

  // Centroid for area label
  const centroid = useMemo(() => polygonCentroid(points), [points]);

  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!points || points.length === 0) return;
    // Invalidate size to ensure Leaflet computes bounds correctly after layout changes
    map.invalidateSize(true);
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lon], 19, { animate: true });
    } else {
      const b = L.latLngBounds(points.map((p) => [p.lat, p.lon]));
      map.fitBounds(b, { padding: [60, 60], maxZoom: 20, animate: true });
    }
  }, [points, mapReady]);

  return (
    <MapContainer
      style={{ height: 500, width: "100%" }}
      center={[0, 0]}
      zoom={2}
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

      {points?.map((p, idx) => (
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


