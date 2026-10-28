import { describe, expect, it } from "vitest";
import { checkUpload, cleanFileName, MAX_UPLOAD_BYTES } from "./file";

const pdfBytes = () => new TextEncoder().encode("%PDF-1.7\n...");
const zipBytes = () => new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
const file = (bytes: Uint8Array | string, name: string) => new File([bytes as BlobPart], name);

describe("checkUpload", () => {
  it("accepts a real PDF and a real DOCX (by extension and first bytes)", async () => {
    const pdf = await checkUpload(file(pdfBytes(), "answers.pdf"));
    expect(pdf).toMatchObject({ ok: true, type: "pdf", fileName: "answers.pdf" });
    const docx = await checkUpload(file(zipBytes(), "Answers.DOCX"));
    expect(docx).toMatchObject({ ok: true, type: "docx" });
  });

  it.each(["answers.exe", "answers.txt", "answers", "answers.pdf.exe", "answers.doc", "photo.png"])(
    "rejects %s by its extension",
    async (name) => {
      const result = await checkUpload(file(pdfBytes(), name));
      expect(result).toEqual({ ok: false, message: "Upload a PDF or Word (.docx) file." });
    },
  );

  it("rejects a file whose bytes do not match its extension", async () => {
    expect(await checkUpload(file("just text", "fake.pdf"))).toEqual({ ok: false, message: "This file is not a real PDF." });
    expect(await checkUpload(file(pdfBytes(), "fake.docx"))).toEqual({
      ok: false,
      message: "This file is not a real Word (.docx) document.",
    });
  });

  it("rejects an empty file and one over 4 MB, and accepts one exactly at the limit", async () => {
    expect(await checkUpload(file("", "a.pdf"))).toEqual({ ok: false, message: "The file is empty." });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(pdfBytes());
    expect(await checkUpload(file(big, "a.pdf"))).toEqual({ ok: false, message: "The file is larger than 4 MB." });
    const exact = new Uint8Array(MAX_UPLOAD_BYTES);
    exact.set(pdfBytes());
    expect((await checkUpload(file(exact, "a.pdf"))).ok).toBe(true);
  });

  it("returns the file's bytes unchanged", async () => {
    const result = await checkUpload(file(pdfBytes(), "a.pdf"));
    expect(result.ok && Array.from(result.bytes)).toEqual(Array.from(pdfBytes()));
  });
});

describe("cleanFileName", () => {
  it("drops folders and control characters, and caps the length", () => {
    expect(cleanFileName("C:\\Users\\me\\answers.pdf")).toBe("answers.pdf");
    expect(cleanFileName("../../etc/passwd.pdf")).toBe("passwd.pdf");
    expect(cleanFileName("ans\u0000wers\n.pdf")).toBe("answers.pdf");
    expect(cleanFileName("a".repeat(500) + ".pdf").length).toBe(200);
    expect(cleanFileName("   ")).toBe("answers");
  });
});
