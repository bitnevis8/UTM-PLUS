"use client";

import { useRef, useState } from "react";

export default function DwgToDxfPage() {
  const fileRef = useRef(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleConvert() {
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setStatus("ابتدا فایل DWG را انتخاب کنید.");
        return;
      }
      setBusy(true);
      setStatus("در حال تبدیل...");
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/dwg-to-dxf", { method: "POST", body: fd });
      if (!res.ok) {
        if (res.status === 501) {
          setStatus("سرویس تبدیل DWG پیکربندی نشده است. لطفاً متغیرهای DWG2DXF_API_URL و در صورت نیاز DWG2DXF_API_KEY را تنظیم کنید.");
          return;
        }
        setStatus("تبدیل ناموفق بود.");
        return;
      }
      const dxfText = await res.text();
      const blob = new Blob([dxfText], { type: "application/dxf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (file.name?.replace(/\.dwg$/i, "") || "converted") + ".dxf";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("دانلود DXF آغاز شد.");
    } catch (_e) {
      setStatus("خطا در تبدیل/دانلود.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold">تبدیل DWG به DXF</h1>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="flex flex-col gap-1">
          <span>فایل DWG</span>
          <input ref={fileRef} type="file" accept=".dwg" className="border p-2 rounded" />
        </label>
      </div>
      <div className="flex gap-2">
        <button onClick={handleConvert} disabled={busy} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">
          {busy ? "در حال تبدیل..." : "تبدیل و دانلود DXF"}
        </button>
      </div>
      {status && <div className="text-sm text-gray-700">{status}</div>}
    </div>
  );
}


