// Podgląd/pobranie załącznika faktury (skan) — plik z uploads/ serwowany inline.

import path from "path";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { readAttachmentBuffer } from "@/lib/attachments";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ invoiceId: string }> }
): Promise<Response> {
  await requireAdmin();
  const { invoiceId } = await params;

  const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
  const file = await readAttachmentBuffer(invoice?.attachmentPath ?? null, invoice?.attachmentName);
  if (!file) return new Response("Nie znaleziono załącznika", { status: 404 });

  const asciiFallback = file.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "'");
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
    },
  });
}
