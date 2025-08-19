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

  // PDF download removed per request

  return (
    <div className="p-6 space-y-6">
      
      <UploaderForm onParsed={handleParsed} />

      <div className="flex gap-2 flex-nowrap">
        <button onClick={handleDownloadDxf} disabled={points.length < 2} className="bg-white text-gray-900 border border-gray-300 rounded px-4 py-2 disabled:opacity-50 hover:bg-gray-50">دانلود DXF</button>
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
