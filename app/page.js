"use client";

import { useMemo, useRef, useState } from "react";
import UploaderForm from "@/components/UploaderForm";
import dynamic from "next/dynamic";
import { polygonAreaSqm, edgeLengthsMeters } from "@/lib/geometry";
import { formatNumberFa } from "@/lib/format";
import { createDxf } from "@/lib/dxf";
import { createPdf } from "@/lib/pdf";
import html2canvas from "html2canvas";

const MapClient = dynamic(() => import("@/components/MapClient"), { ssr: false });

export default function Home() {
  const [points, setPoints] = useState([]);
  const [projectInfo, setProjectInfo] = useState(null);
  const mapWrapperRef = useRef(null);

  const area = useMemo(() => (points.length >= 3 ? polygonAreaSqm(points) : 0), [points]);
  const lengths = useMemo(() => (points.length >= 2 ? edgeLengthsMeters(points) : []), [points]);

  function handleParsed({ points: pts, projectInfo: info }) {
    setPoints(pts);
    setProjectInfo(info);
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
    const dxf = createDxf({ points, lengths, area });
    download("polygon.dxf", dxf, "application/dxf");
  }

  async function handleDownloadPdf() {
    let dataUrl = undefined;
    if (mapWrapperRef.current) {
      const canvas = await html2canvas(mapWrapperRef.current, {
        scale: Math.max(2, window.devicePixelRatio || 1),
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      dataUrl = canvas.toDataURL("image/png");
    }
    const doc = createPdf({ projectInfo: projectInfo || {}, points, lengths, area, mapDataUrl: dataUrl });
    doc.save("report.pdf");
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">ابزار تبدیل UTM و ترسیم پلی‌گان</h1>
      <UploaderForm onParsed={handleParsed} />

      <div className="flex gap-2">
        <button onClick={handleDownloadDxf} disabled={points.length < 2} className="bg-emerald-600 text-white rounded px-4 py-2 disabled:opacity-50">دانلود DXF</button>
        <button onClick={handleDownloadPdf} disabled={points.length < 2} className="bg-pink-600 text-white rounded px-4 py-2 disabled:opacity-50">دانلود PDF</button>
      </div>

      <div ref={mapWrapperRef} className="border rounded overflow-hidden">
        <MapClient points={points} />
      </div>
    </div>
  );
}
