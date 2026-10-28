export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type UploadType = "pdf" | "docx";

export type UploadCheck =
  | { ok: true; type: UploadType; bytes: Uint8Array; fileName: string }
  | { ok: false; message: string };

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/** "%PDF-" */
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d];
/** A .docx is a zip archive: "PK\x03\x04" */
const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

/** A display name that is safe to store and show: no folders, no control characters, at most 200 characters. */
export function cleanFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (cleaned || "answers").slice(-200);
}

/**
 * Checks an uploaded file before anything is stored: a PDF or DOCX by extension AND by its first bytes,
 * not empty, at most 4 MB. The browser's reported content type is not trusted.
 */
export async function checkUpload(file: File): Promise<UploadCheck> {
  const fileName = cleanFileName(file.name);
  const extension = /\.([A-Za-z0-9]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (extension !== "pdf" && extension !== "docx") {
    return { ok: false, message: "Upload a PDF or Word (.docx) file." };
  }
  if (file.size === 0) return { ok: false, message: "The file is empty." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, message: "The file is larger than 4 MB." };

  const bytes = new Uint8Array(await file.arrayBuffer());
  const looksRight = extension === "pdf" ? startsWith(bytes, PDF_SIGNATURE) : startsWith(bytes, ZIP_SIGNATURE);
  if (!looksRight) {
    return {
      ok: false,
      message: extension === "pdf" ? "This file is not a real PDF." : "This file is not a real Word (.docx) document.",
    };
  }
  return { ok: true, type: extension, bytes, fileName };
}
