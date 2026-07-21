// Wspólna obsługa załączników (skany faktur/kosztów) w katalogu uploads/.
// Plik zapisujemy jako <id>.<ext>; w bazie trzymamy nazwę pliku + oryginalną nazwę.
// Server-only (fs). Używane przez Przychody (faktura) i maile przypomnień.

import path from "path";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";

export const UPLOADS_DIR = path.join(process.cwd(), "uploads");
export const ALLOWED_EXTENSIONS = ["pdf", "jpg", "jpeg", "png", "webp"] as const;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

export const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export interface AttachmentFile {
  ext: string;
  name: string;
  bytes: Buffer;
}

/** Odczyt i walidacja pliku z FormData (pole `field`). Brak pliku → { file: null }. */
export async function readAttachmentFromForm(
  formData: FormData,
  field = "attachment"
): Promise<{ ok: false; error: string } | { ok: true; file: AttachmentFile | null }> {
  const file = formData.get(field);
  if (!(file instanceof File) || file.size === 0 || !file.name) {
    return { ok: true, file: null };
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, error: "Niedozwolony typ pliku — dozwolone: PDF, JPG, JPEG, PNG, WEBP" };
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: "Plik może mieć maksymalnie 10 MB" };
  }
  const bytes = Buffer.from(await file.arrayBuffer());
  return { ok: true, file: { ext, name: file.name, bytes } };
}

/** Zapisuje plik jako <id>.<ext>, kasując poprzedni. Zwraca dane do zapisu w bazie. */
export async function writeAttachment(
  id: string,
  file: AttachmentFile,
  previousPath: string | null
): Promise<{ attachmentPath: string; attachmentName: string }> {
  const fileName = `${id}.${file.ext}`;
  if (previousPath && previousPath !== fileName) await removeAttachment(previousPath);
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(path.join(UPLOADS_DIR, fileName), file.bytes);
  return { attachmentPath: fileName, attachmentName: file.name };
}

export async function removeAttachment(attachmentPath: string | null): Promise<void> {
  if (!attachmentPath) return;
  await unlink(path.join(UPLOADS_DIR, path.basename(attachmentPath))).catch(() => {});
}

/** Odczyt bajtów załącznika (do serwowania i do maila). null gdy brak pliku. */
export async function readAttachmentBuffer(
  attachmentPath: string | null,
  originalName?: string | null
): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  if (!attachmentPath) return null;
  const fileName = path.basename(attachmentPath);
  let buffer: Buffer;
  try {
    buffer = await readFile(path.join(UPLOADS_DIR, fileName));
  } catch {
    return null;
  }
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return {
    buffer,
    filename: originalName || fileName,
    contentType: MIME_BY_EXTENSION[ext] ?? "application/octet-stream",
  };
}

/** Logo adGen (PNG) do osadzenia w mailu inline (CID). null gdy brak pliku. */
export async function readEmailLogo(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), "assets", "email", "adgen-logo.png"));
  } catch {
    return null;
  }
}
