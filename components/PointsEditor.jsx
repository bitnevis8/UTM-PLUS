"use client";

import { useCallback } from "react";
import { convertUtmToLatLon, convertLatLonToUtm } from "@/lib/utm";

/**
 * Editable list of points with UTM coordinates
 * @param {{
 *  points: Array<{name?:string, easting?:number, northing?:number, lat?:number, lon?:number}>,
 *  onChange: (points:any[])=>void,
 *  zone?: number,
 *  hemisphere?: 'north'|'south',
 * }} props
 */
export default function PointsEditor({ points, onChange, zone = 39, hemisphere = "north" }) {
  const updatePoint = useCallback((idx, updater) => {
    const next = points.map((p, i) => (i === idx ? { ...p, ...updater(p) } : p));
    onChange?.(next);
  }, [points, onChange]);

  const handleNameChange = (idx, value) => {
    updatePoint(idx, () => ({ name: value }));
  };

  const handleUtmChange = (idx, field, value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return; // ignore invalid
    const base = points[idx] || {};
    const easting = field === "easting" ? num : Number(base.easting);
    const northing = field === "northing" ? num : Number(base.northing);
    if (!Number.isFinite(easting) || !Number.isFinite(northing)) {
      updatePoint(idx, () => ({ [field]: num }));
      return;
    }
    const { lat, lon } = convertUtmToLatLon({ easting, northing, zone: Number(zone), hemisphere });
    updatePoint(idx, () => ({ easting, northing, lat, lon }));
  };

  const handleAdd = () => {
    const last = points[points.length - 1];
    let newPoint = { name: `P${points.length + 1}`, easting: 0, northing: 0, lat: 0, lon: 0 };
    if (last && Number.isFinite(last.easting) && Number.isFinite(last.northing)) {
      const easting = Number(last.easting) + 1;
      const northing = Number(last.northing);
      const { lat, lon } = convertUtmToLatLon({ easting, northing, zone: Number(zone), hemisphere });
      newPoint = { name: `P${points.length + 1}`, easting, northing, lat, lon };
    }
    onChange?.([...(points || []), newPoint]);
  };

  const handleRemove = (idx) => {
    const next = (points || []).filter((_, i) => i !== idx);
    onChange?.(next);
  };

  const move = (idx, dir) => {
    const j = idx + dir;
    if (j < 0 || j >= points.length) return;
    const next = points.slice();
    const tmp = next[idx];
    next[idx] = next[j];
    next[j] = tmp;
    onChange?.(next);
  };

  const handleAddAbove = (idx) => {
    const blank = { name: `P${idx + 1}`, easting: "", northing: "" };
    const next = points.slice();
    next.splice(idx, 0, blank);
    onChange?.(next);
  };

  const handleAddBelow = (idx) => {
    const blank = { name: `P${idx + 2}`, easting: "", northing: "" };
    const next = points.slice();
    next.splice(idx + 1, 0, blank);
    onChange?.(next);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">نقاط (UTM)</h2>
        <button onClick={handleAdd} className="px-3 py-1.5 rounded bg-white text-gray-900 border border-gray-300 hover:bg-gray-50">افزودن نقطه</button>
      </div>
      <div className="overflow-auto border rounded">
        <table className="min-w-full text-xs sm:text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-right p-2 whitespace-nowrap">#</th>
              <th className="text-right p-2 whitespace-nowrap">نام</th>
              <th className="text-right p-2 whitespace-nowrap">Easting</th>
              <th className="text-right p-2 whitespace-nowrap">Northing</th>
              <th className="text-right p-2 whitespace-nowrap">اکشن</th>
            </tr>
          </thead>
          <tbody>
            {(points || []).map((p, idx) => (
              <tr key={idx} className="border-t">
                <td className="p-2 text-gray-500">{idx + 1}</td>
                <td className="p-2">
                  <input className="border rounded p-1 w-full sm:w-28" value={p.name || ""} onChange={(e) => handleNameChange(idx, e.target.value)} />
                </td>
                <td className="p-2">
                  <input type="number" className="border rounded p-1 w-full sm:w-36" value={Number.isFinite(p.easting) ? p.easting : ""} onChange={(e) => handleUtmChange(idx, "easting", e.target.value)} />
                </td>
                <td className="p-2">
                  <input type="number" className="border rounded p-1 w-full sm:w-36" value={Number.isFinite(p.northing) ? p.northing : ""} onChange={(e) => handleUtmChange(idx, "northing", e.target.value)} />
                </td>
                <td className="p-2">
                  <div className="flex gap-2 flex-nowrap overflow-x-auto">
                    <button onClick={() => handleAddAbove(idx)} className="px-2 py-1 border rounded" title="افزودن بالا">↑</button>
                    <button onClick={() => handleAddBelow(idx)} className="px-2 py-1 border rounded" title="افزودن پایین">↓</button>
                    <button onClick={() => move(idx, -1)} className="px-2 py-1 border rounded" title="انتقال به بالا">⤴</button>
                    <button onClick={() => move(idx, 1)} className="px-2 py-1 border rounded" title="انتقال به پایین">⤵</button>
                    <button onClick={() => handleRemove(idx)} className="px-2 py-1 border rounded text-red-600" title="حذف">×</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-gray-600">زون: {String(zone)} | نیمکره: {hemisphere === "south" ? "جنوبی" : "شمالی"}</div>
    </div>
  );
}


