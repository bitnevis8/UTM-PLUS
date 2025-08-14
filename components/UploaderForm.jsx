"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { convertManyUtmToLatLon } from "@/lib/utm";

export default function UploaderForm({ onParsed }) {
  const [zone, setZone] = useState(39);
  const [hemisphere, setHemisphere] = useState("north");
  const [projectInfo, setProjectInfo] = useState({
    location: "",
    employer: "",
    contractor: "",
    date: "",
    scale: "1:1000",
  });
  const [rawRows, setRawRows] = useState([]);
  const fileRef = useRef(null);

  function parseText(text) {
    // Try CSV via Papa; fallback to whitespace splitting lines
    const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
    let rows = [];
    if (parsed && parsed.data && parsed.data.length > 0 && parsed.meta.fields) {
      rows = parsed.data.map((r, idx) => ({
        name: r.name || r.Name || r.point || r.Point || `P${idx + 1}`,
        easting: Number(r.easting || r.Easting || r.x || r.X),
        northing: Number(r.northing || r.Northing || r.y || r.Y),
      })).filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
    } else {
      rows = text
        .split(/\r?\n/)
        .map((line, idx) => line.trim())
        .filter(Boolean)
        .map((line, idx) => {
          const parts = line.split(/[;,\s]+/);
          const e = Number(parts[0]);
          const n = Number(parts[1]);
          const name = parts[2] || `P${idx + 1}`;
          return { name, easting: e, northing: n };
        })
        .filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
    }
    setRawRows(rows);
    return rows;
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    parseText(text);
  }

  function handleShowOnMap() {
    if (rawRows.length < 2) return;
    const wgs = convertManyUtmToLatLon(rawRows, { zone: Number(zone), hemisphere });
    onParsed?.({ points: wgs, projectInfo: { ...projectInfo, zone, hemisphere } });
  }

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span>فایل نقاط UTM (CSV/TXT)</span>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={onFileChange} className="border p-2 rounded" />
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-1">
            <span>زون UTM</span>
            <input type="number" value={zone} onChange={(e) => setZone(e.target.value)} className="border p-2 rounded" />
          </label>
          <label className="flex flex-col gap-1">
            <span>نیمکره</span>
            <select value={hemisphere} onChange={(e) => setHemisphere(e.target.value)} className="border p-2 rounded">
              <option value="north">شمالی</option>
              <option value="south">جنوبی</option>
            </select>
          </label>
        </div>
      </div>

      <div className="grid sm:grid-cols-5 gap-4">
        <label className="flex flex-col gap-1">
          <span>محل پروژه</span>
          <input value={projectInfo.location} onChange={(e) => setProjectInfo((p) => ({ ...p, location: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>نام کارفرما</span>
          <input value={projectInfo.employer} onChange={(e) => setProjectInfo((p) => ({ ...p, employer: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>نام مجری</span>
          <input value={projectInfo.contractor} onChange={(e) => setProjectInfo((p) => ({ ...p, contractor: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>تاریخ</span>
          <input type="date" value={projectInfo.date} onChange={(e) => setProjectInfo((p) => ({ ...p, date: e.target.value }))} className="border p-2 rounded" />
        </label>
        <label className="flex flex-col gap-1">
          <span>مقیاس نقشه</span>
          <input value={projectInfo.scale} onChange={(e) => setProjectInfo((p) => ({ ...p, scale: e.target.value }))} className="border p-2 rounded" />
        </label>
      </div>

      <div className="flex gap-2">
        <button onClick={handleShowOnMap} className="bg-blue-600 text-white rounded px-4 py-2">نمایش روی نقشه</button>
      </div>
    </div>
  );
}


