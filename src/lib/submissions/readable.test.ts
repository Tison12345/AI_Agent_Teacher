import { describe, expect, it } from "vitest";
import { assessExtraction } from "./readable";

const pages = (...chars: number[]) => chars.map((c, i) => ({ number: i + 1, chars: c }));

describe("assessExtraction", () => {
  it("accepts a typed document", () => {
    expect(assessExtraction(pages(900, 700), "pdf")).toEqual({ readable: true });
    expect(assessExtraction(pages(450), "docx")).toEqual({ readable: true });
  });

  it("a fully scanned PDF needs OCR, and says why", () => {
    const result = assessExtraction(pages(0, 0, 0), "pdf");
    expect(result.readable).toBe(false);
    expect(!result.readable && result.reason).toMatch(/scanned or image-only PDF/);
  });

  it("a mostly blank PDF needs OCR even if one page has text", () => {
    expect(assessExtraction(pages(2000, 0, 0), "pdf").readable).toBe(false);
  });

  it("a few blank pages in a typed document are allowed (they are reported as warnings)", () => {
    expect(assessExtraction(pages(900, 0, 800, 700), "pdf")).toEqual({ readable: true });
  });

  it("exactly half blank is allowed; more than half is not", () => {
    expect(assessExtraction(pages(900, 0), "pdf").readable).toBe(true);
    expect(assessExtraction(pages(900, 0, 0), "pdf").readable).toBe(false);
  });

  it("too little text overall is not graded as an answer", () => {
    expect(assessExtraction(pages(60), "docx").readable).toBe(false);
    expect(assessExtraction(pages(100), "docx").readable).toBe(true);
    const result = assessExtraction(pages(10), "docx");
    expect(!result.readable && result.reason).toMatch(/almost no typed text/);
  });

  it("no pages at all is not readable", () => {
    expect(assessExtraction([], "pdf").readable).toBe(false);
  });

  it("a page of exactly 30 characters counts as having text", () => {
    expect(assessExtraction(pages(30, 30, 30, 30), "pdf").readable).toBe(true);
    expect(assessExtraction(pages(29, 29, 29, 100), "pdf").readable).toBe(false);
  });
});
