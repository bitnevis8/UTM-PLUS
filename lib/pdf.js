import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatNumberFa } from "@/lib/format";

/**
 * Generate PDF with project info, map snapshot, points table, and area
 * @param {{ projectInfo: any, points: Array<any>, lengths: number[], area: number, mapDataUrl?: string }} params
 */
export function createPdf({ projectInfo, points, lengths, area, mapDataUrl }) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  // Header
  doc.setFontSize(16);
  doc.text("گزارش پلی‌گان پروژه", 105, 15, { align: "center" });

  doc.setFontSize(11);
  const info = [
    [`محل پروژه: ${projectInfo.location || "-"}`],
    [`کارفرما: ${projectInfo.employer || "-"}`],
    [`مجری: ${projectInfo.contractor || "-"}`],
    [`تاریخ: ${projectInfo.date || "-"}`],
    [`مقیاس: ${projectInfo.scale || "-"}`],
  ];
  autoTable(doc, {
    startY: 20,
    head: [["اطلاعات پروژه"]],
    body: info,
    styles: { font: "helvetica", halign: "right" },
    headStyles: { fillColor: [230, 230, 230] },
    theme: "grid",
    margin: { left: 15, right: 15 },
  });

  let y = (doc.lastAutoTable?.finalY || 20) + 5;

  // Map snapshot
  if (mapDataUrl) {
    doc.addImage(mapDataUrl, "PNG", 15, y, 180, 100);
    y += 105;
  }

  // Points table
  const head = [["نام", "Easting", "Northing", "طول ضلع بعدی (m)"]];
  const body = points.map((p, i) => [p.name, String(p.easting ?? ""), String(p.northing ?? ""), String(formatNumberFa(lengths[i] ?? 0))]);
  autoTable(doc, {
    startY: y,
    head,
    body,
    styles: { halign: "center" },
    headStyles: { fillColor: [240, 240, 240] },
    theme: "grid",
    margin: { left: 15, right: 15 },
  });

  y = (doc.lastAutoTable?.finalY || y) + 8;
  doc.setFontSize(14);
  doc.text(`مساحت: ${formatNumberFa(area)}m²`, 105, y, { align: "center" });

  return doc;
}


