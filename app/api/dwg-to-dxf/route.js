export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  try {
    // Read form-data with a single file field named 'file'
    const form = await req.formData();
    const file = form.get("file");
    if (!file) {
      return new Response("Missing file", { status: 400 });
    }
    // 1) Some users upload DXF text with .dwg extension. Try interpreting as DXF text first.
    try {
      const text = await file.text();
      if (text && /SECTION/i.test(text) && /ENTITIES/i.test(text)) {
        return new Response(text, { status: 200, headers: { "Content-Type": "application/dxf; charset=utf-8" } });
      }
    } catch {}

    // 2) If an external converter is configured, forward the file and return DXF text
    const apiUrl = process.env.DWG2DXF_API_URL;
    if (!apiUrl) {
      return new Response("DWG conversion not configured", { status: 501 });
    }

    const fd = new FormData();
    const buf = await file.arrayBuffer();
    const blob = new Blob([buf], { type: file.type || "application/octet-stream" });
    const filename = typeof file.name === "string" ? file.name : "upload.dwg";
    fd.append("file", blob, filename);

    const headers = {};
    if (process.env.DWG2DXF_API_KEY) headers["Authorization"] = `Bearer ${process.env.DWG2DXF_API_KEY}`;

    const res = await fetch(apiUrl, { method: "POST", body: fd, headers });
    if (!res.ok) {
      return new Response("Failed to convert DWG", { status: 502 });
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      const data = await res.json().catch(() => null);
      if (data && typeof data.dxf === "string") {
        return new Response(data.dxf, { status: 200, headers: { "Content-Type": "application/dxf; charset=utf-8" } });
      }
    }
    const dxfText = await res.text();
    return new Response(dxfText, { status: 200, headers: { "Content-Type": "application/dxf; charset=utf-8" } });
  } catch (e) {
    return new Response("Failed to process", { status: 500 });
  }
}


