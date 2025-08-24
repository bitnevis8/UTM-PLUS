"use client";

import { useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { convertManyUtmToLatLon, convertManyLatLonToUtm } from "@/lib/utm";

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
  const [mode, setMode] = useState("utm");
  const fileRef = useRef(null);
  const dxfFileRef = useRef(null);
  const [notice, setNotice] = useState("");
  const [rawType, setRawType] = useState(null); // 'utm' | 'wgs84'

  function parseText(text) {
    // Try CSV via Papa; fallback to whitespace/CSV lines (name-first or easting-first)
    const parsed = Papa.parse(String(text || "").trim(), { header: true, skipEmptyLines: true });
    let rows = [];
    if (parsed && parsed.data && parsed.data.length > 0 && parsed.meta && parsed.meta.fields && parsed.meta.fields.length) {
      rows = parsed.data
        .map((r, idx) => {
          const name = r.name || r.Name || r["Point name"] || r.point || r.Point || r.id || r.ID || `P${idx + 1}`;
          const e = Number(r.easting ?? r.Easting ?? r.EASTING ?? r.x ?? r.X ?? r.E ?? r.e ?? r.east ?? r.East);
          const n = Number(r.northing ?? r.Northing ?? r.NORTHING ?? r.y ?? r.Y ?? r.N ?? r.n ?? r.north ?? r.North);
          return { name, easting: e, northing: n };
        })
        .filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
      setRawRows(rows);
      return rows;
    }

    // Headerless or irregular lines: support both "name,e,n" and "e,n,name"
    const lines = String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    rows = lines
      .map((line, idx) => {
        const parts = line.split(/[;,\s]+/).filter(Boolean);
        let name = `P${idx + 1}`;
        let e = Number(parts[0]);
        let n = Number(parts[1]);
        // Case: name first, then easting, northing
        if (!Number.isFinite(e) && Number.isFinite(Number(parts[1])) && Number.isFinite(Number(parts[2]))) {
          name = parts[0];
          e = Number(parts[1]);
          n = Number(parts[2]);
        } else {
          // Case: easting, northing, [name]
          if (parts[2] && isNaN(Number(parts[2]))) name = parts[2];
        }
        return { name, easting: e, northing: n };
      })
      .filter((r) => Number.isFinite(r.easting) && Number.isFinite(r.northing));
    setRawRows(rows);
    return rows;
  }

  function parseTextMode2(text) {
    const t = String(text || "").trim();
    if (!t) {
      setRawRows([]);
      return [];
    }
    const lines = t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const rows = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let name = `P${i + 1}`;
      let easting = undefined;
      let northing = undefined;
      // Try key=value tokens first (E=..., N=..., X=..., Y=...)
      const kvParts = line.split(/[;,\s]+/).map((s) => s.trim()).filter(Boolean);
      for (const tok of kvParts) {
        const m = tok.match(/^([eEnNxX]|Easting|Northing|east|north)\s*[:=]\s*(-?\d+(?:\.\d+)?)/);
        if (m) {
          const key = m[1].toLowerCase();
          const val = Number(m[2]);
          if (key === 'e' || key === 'x' || key === 'east' || key === 'easting') easting = val;
          if (key === 'n' || key === 'y' || key === 'north' || key === 'northing') northing = val;
          continue;
        }
      }
      // If still missing, extract all numbers and pick two largest as UTM (northing>=easting)
      if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
        const nums = (line.match(/-?\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n));
        if (nums.length >= 2) {
          const sorted = nums.slice().sort((a, b) => b - a);
          const nVal = sorted[0];
          const eVal = sorted[1];
          // Basic sanity: swap if needed to keep northing >= easting
          northing = Math.max(nVal, eVal);
          easting = Math.min(nVal, eVal);
        }
      }
      // Try to infer name from tokens containing letters
      const word = kvParts.find((s) => /[A-Za-z\u0600-\u06FF]/.test(s) && !s.includes('=') && !s.includes(':'));
      if (word) name = word;
      if (Number.isFinite(easting) && Number.isFinite(northing)) {
        rows.push({ name, easting: Number(easting), northing: Number(northing) });
      }
    }
    setRawRows(rows);
    return rows;
  }

  async function onFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const rows = mode === 'utm2' ? parseTextMode2(text) : parseText(text);
    setNotice(`تعداد نقاط خوانده‌شده از فایل: ${rows.length}`);
  }

  function parseDxfRowsLight(text) {
    try {
      const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
      const ents = [];
      let i = 0;
      const readPair = (idx) => ({ code: lines[idx]?.trim(), value: lines[idx + 1] });
      while (i + 1 < lines.length) {
        const { code, value } = readPair(i);
        if (code === "0") {
          const type = (value || "").trim();
          if (type === "LWPOLYLINE") {
            i += 2;
            let closed = false;
            let pendingX = undefined;
            const pts = [];
            while (i + 1 < lines.length) {
              const p = readPair(i);
              if (p.code === "0") break;
              if (p.code === "70") {
                const flags = Number((p.value || "").trim());
                if (Number.isFinite(flags)) closed = (flags & 1) === 1;
              } else if (p.code === "10") {
                pendingX = Number((p.value || "").trim());
              } else if (p.code === "20") {
                const y = Number((p.value || "").trim());
                if (Number.isFinite(pendingX) && Number.isFinite(y)) {
                  pts.push({ easting: pendingX, northing: y });
                }
                pendingX = undefined;
              }
              i += 2;
            }
            if (pts.length >= 2) ents.push({ pts, closed });
            continue;
          }
          if (type === "POLYLINE") {
            i += 2;
            let closed = false;
            const pts = [];
            while (i + 1 < lines.length) {
              const p = readPair(i);
              if (p.code === "0") {
                const t = (p.value || "").trim();
                if (t === "VERTEX") {
                  i += 2;
                  let vx = undefined;
                  let vy = undefined;
                  while (i + 1 < lines.length) {
                    const pv = readPair(i);
                    if (pv.code === "0") break;
                    if (pv.code === "10") vx = Number((pv.value || "").trim());
                    if (pv.code === "20") vy = Number((pv.value || "").trim());
                    i += 2;
                  }
                  if (Number.isFinite(vx) && Number.isFinite(vy)) pts.push({ easting: vx, northing: vy });
                  continue;
                }
                if (t === "SEQEND") {
                  i += 2;
                  break;
                }
                // Unexpected type; break polyline
                break;
              }
              if (p.code === "70") {
                const flags = Number((p.value || "").trim());
                if (Number.isFinite(flags)) closed = (flags & 1) === 1;
              }
              i += 2;
            }
            if (pts.length >= 2) ents.push({ pts, closed });
            continue;
          }
        }
        i += 2;
      }
      if (!ents.length) return [];
      // Prefer closed with max points; fallback to largest entity
      const closed = ents.filter((e) => e.closed);
      const chosen = (closed.length ? closed : ents).sort((a, b) => (b.pts.length - a.pts.length))[0];
      return chosen.pts.map((p, idx) => ({ name: `P${idx + 1}`, easting: Number(p.easting), northing: Number(p.northing) }))
        .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
    } catch {
      return [];
    }
  }

  async function parseDxfRows(text) {
    try {
      // Try lightweight parser first (works in browser without deps)
      const light = parseDxfRowsLight(text);
      if (light && light.length >= 2) return light;
      // Fallback to dxf-parser if available
      const mod = await import("dxf-parser");
      const DxfParser = mod.default || mod;
      const parser = new DxfParser();
      const d = parser.parseSync(text);
      const entities = Array.isArray(d?.entities) ? d.entities : [];
      const lwps = entities.filter((e) => e.type === "LWPOLYLINE");
      const polysClosed = lwps.filter((e) => e.closed || e.shape);
      const lw = (polysClosed.length ? polysClosed : lwps).sort((a, b) => (b.vertices?.length || 0) - (a.vertices?.length || 0))[0];
      let verts = [];
      if (lw && Array.isArray(lw.vertices)) {
        verts = lw.vertices
          .map((v, idx) => ({ name: `P${idx + 1}`, easting: Number(v.x), northing: Number(v.y) }))
          .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
      } else {
        const polys = entities.filter((e) => e.type === "POLYLINE");
        const poly = polys.sort((a, b) => (b.vertices?.length || 0) - (a.vertices?.length || 0))[0];
        if (poly && Array.isArray(poly.vertices)) {
          verts = poly.vertices
            .map((v, idx) => {
              const x = Number(v.location?.x ?? v.x);
              const y = Number(v.location?.y ?? v.y);
              return { name: `P${idx + 1}`, easting: x, northing: y };
            })
            .filter((p) => Number.isFinite(p.easting) && Number.isFinite(p.northing));
        }
      }
      return verts;
    } catch {
      return [];
    }
  }

  async function onDxfFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const verts = await parseDxfRows(text);
    setRawRows(verts);
    // Detect CRS from value ranges
    if (verts.length >= 2) {
      const xs = verts.map((v) => Math.abs(Number(v.easting)));
      const ys = verts.map((v) => Math.abs(Number(v.northing)));
      const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
      setRawType(inLonLat ? "wgs84" : "utm");
    } else {
      setRawType(null);
    }
    if (verts.length >= 2) setNotice(`DXF خوانده شد: ${verts.length} نقطه`);
    else setNotice("نتوانستم پلی‌لاین معتبری در DXF پیدا کنم.");
  }

  async function onDwgFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // Fallback: some files with .dwg are actually DXF text; try local parse first
    try {
      const maybeText = await file.text();
      const asDxf = await parseDxfRows(maybeText);
      if (asDxf && asDxf.length >= 2) {
        setRawRows(asDxf);
        const xs = asDxf.map((v) => Math.abs(Number(v.easting)));
        const ys = asDxf.map((v) => Math.abs(Number(v.northing)));
        const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
        setRawType(inLonLat ? "wgs84" : "utm");
        setNotice(`DWG (DXF متنی) خوانده شد: ${asDxf.length} نقطه`);
        return;
      }
    } catch {}

    const fd = new FormData();
    fd.append("file", file);
    try {
      const res = await fetch("/api/dwg-to-dxf", { method: "POST", body: fd });
      if (!res.ok) {
        if (res.status === 501) {
          setNotice("تبدیل DWG هنوز پیکربندی نشده است. لطفاً فایل را به DXF تبدیل کرده و بارگذاری کنید.");
          setRawRows([]);
          return;
        }
        throw new Error("convert failed");
      }
      const text = await res.text();
      const verts = await parseDxfRows(text);
      setRawRows(verts);
      if (verts.length >= 2) {
        const xs = verts.map((v) => Math.abs(Number(v.easting)));
        const ys = verts.map((v) => Math.abs(Number(v.northing)));
        const inLonLat = xs.every((x) => x <= 180) && ys.every((y) => y <= 90);
        setRawType(inLonLat ? "wgs84" : "utm");
      } else {
        setRawType(null);
      }
      if (verts.length >= 2) setNotice(`DWG تبدیل شد و ${verts.length} نقطه استخراج شد`);
      else setNotice("پس از تبدیل DWG، پلی‌لاین معتبری یافت نشد.");
    } catch {
      setRawRows([]);
      setNotice("خواندن/تبدیل DWG با خطا مواجه شد.");
    }
  }


  function handleShowOnMap() {
    if (mode === "utm" || mode === "utm2") {
      if (rawRows.length < 2) return;
      const wgs = convertManyUtmToLatLon(rawRows, { zone: Number(zone), hemisphere });
      onParsed?.({ points: wgs, projectInfo: { ...projectInfo, zone, hemisphere } });
      setNotice(`روی نقشه نمایش داده شد (${wgs.length} نقطه).`);
    } else if (mode === "polygon") {
      const pts = parsePolygonText(polygonText);
      if (!pts || pts.length < 2) return;
      const withUtm = convertManyLatLonToUtm(pts, { zone: Number(zone), hemisphere });
      onParsed?.({ points: withUtm, projectInfo: { ...projectInfo, zone, hemisphere } });
      setNotice(`پلی‌گان نمایش داده شد (${withUtm.length} نقطه).`);
    } else if (mode === "dxf") {
      if (rawRows.length < 2) return;
      if (rawType === "wgs84") {
        const latlon = rawRows.map((p) => ({ name: p.name, lat: Number(p.northing), lon: Number(p.easting) }));
        const enriched = convertManyLatLonToUtm(latlon, { zone: Number(zone), hemisphere });
        onParsed?.({ points: enriched, projectInfo: { ...projectInfo, zone, hemisphere } });
        setNotice(`DXF (WGS84) روی نقشه نمایش داده شد (${enriched.length} نقطه).`);
      } else {
        const wgs = convertManyUtmToLatLon(rawRows, { zone: Number(zone), hemisphere });
        onParsed?.({ points: wgs, projectInfo: { ...projectInfo, zone, hemisphere } });
        setNotice(`DXF (UTM) روی نقشه نمایش داده شد (${wgs.length} نقطه).`);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-4 flex-wrap">
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm" checked={mode === "utm"} onChange={() => setMode("utm")} />
          <span>ورودی TXT / CSV (مود 1)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="utm2" checked={mode === "utm2"} onChange={() => setMode("utm2")} />
          <span>ورودی TXT / CSV (مود 2)</span>
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" value="dxf" checked={mode === "dxf"} onChange={() => setMode("dxf")} />
          <span>فایل DXF</span>
        </label>
      </div>

      {(mode === "utm" || mode === "utm2") ? (
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
      ) : mode === "polygon" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>زون UTM برای برون‌داد متریک</span>
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
          <label className="flex flex-col gap-1">
            <span>متن پلی‌گان</span>
            <textarea
              value={polygonText}
              onChange={(e) => setPolygonText(e.target.value)}
              className="border p-2 rounded min-h-[120px]"
              placeholder={`نمونه‌ها:\n- WKT: POLYGON((51.3 35.7, 51.31 35.71, 51.29 35.72, 51.3 35.7))\n- GeoJSON: {"type":"Polygon","coordinates":[[[51.3,35.7],[51.31,35.71],[51.29,35.72],[51.3,35.7]]]}\n- lat,lon سطر به سطر: 35.7,51.3`}
            />
          </label>
        </div>
      ) : mode === "dxf" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span>فایل DXF</span>
              <input ref={dxfFileRef} type="file" accept=".dxf" onChange={onDxfFileChange} className="border p-2 rounded" />
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
          <p className="text-sm text-gray-600">از پلی‌لاین‌های بسته (LWPOLYLINE/POLYLINE) مختصات استخراج می‌شود.</p>
        </div>
      ) : null}

      {/* DWG mode removed per request */}

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

      <div className="flex gap-2 flex-nowrap">
        <button
          onClick={handleShowOnMap}
          disabled={(((mode === "utm") || (mode === "utm2")) && rawRows.length < 2) || (mode === "dxf" && rawRows.length < 2)}
          className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50"
        >
          نمایش روی نقشه
        </button>
      </div>
      {notice && (
        <div className="text-sm text-gray-700">{notice}</div>
      )}
    </div>
  );
}


