// Podgląd załącznika kosztu — plik z katalogu uploads/ serwowany inline.

import path from "path";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ costId: string }> }
): Promise<Response> {
  await requireAdmin();
  const { costId } = await params;

  const cost = await db.cost.findUnique({ where: { id: costId } });
  if (!cost?.attachmentPath) {
    return new Response("Nie znaleziono załącznika", { status: 404 });
  }

  // attachmentPath to sama nazwa pliku (<costId>.<ext>) — basename na wszelki wypadek
  const fileName = path.basename(cost.attachmentPath);
  let data: Buffer;
  try {
    data = await readFile(path.join(UPLOADS_DIR, fileName));
  } catch {
    return new Response("Nie znaleziono załącznika", { status: 404 });
  }

  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  const contentType = MIME_BY_EXTENSION[ext] ?? "application/octet-stream";

  const originalName = cost.attachmentName ?? fileName;
  // fallback ASCII dla starych przeglądarek + pełna nazwa w filename* (RFC 5987)
  const asciiFallback = originalName
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/"/g, "'");

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(originalName)}`,
    },
  });
}
