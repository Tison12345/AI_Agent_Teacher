import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExtractorError, extractText, getExtractorConfig } from "./extractor";

const config = { url: "http://127.0.0.1:8001", key: "secret-key" };
const bytes = new Uint8Array([1, 2, 3]);
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const good = { text: "Page 1:\nhello", pages: [{ number: 1, chars: 5 }], warnings: [] };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("extractText", () => {
  it("posts the raw bytes with the secret key and returns the parsed result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(good));
    const result = await extractText(bytes, "pdf", { config, fetch: fetchMock });
    expect(result).toEqual(good);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8001/extract?type=pdf");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Extractor-Key"]).toBe("secret-key");
    expect(init.body).toBe(bytes);
  });

  it("a problem with the file (422) is shown to the student in the service's own words", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(json({ error: { code: "encrypted", message: "This PDF is password protected." } }, 422));
    const error = await extractText(bytes, "pdf", { config, fetch: fetchMock }).catch((e) => e);
    expect(error).toBeInstanceOf(ExtractorError);
    expect(error).toMatchObject({ code: "rejected", userMessage: "This PDF is password protected." });
  });

  it("a service that is not running gives a friendly message and never a raw error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED 127.0.0.1:8001"));
    const error = await extractText(bytes, "pdf", { config, fetch: fetchMock }).catch((e) => e);
    expect(error).toMatchObject({ code: "unavailable" });
    expect(error.userMessage).not.toMatch(/ECONNREFUSED|fetch failed/);
  });

  it("a timeout is reported as a timeout", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    const error = await extractText(bytes, "pdf", { config, fetch: vi.fn().mockRejectedValue(timeout) }).catch((e) => e);
    expect(error).toMatchObject({ code: "timeout" });
  });

  it.each([
    [401, "not_configured"],
    [503, "not_configured"],
    [500, "unavailable"],
  ])("a %i answer from the service is %s", async (status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(json({ detail: "x" }, status));
    const error = await extractText(bytes, "docx", { config, fetch: fetchMock }).catch((e) => e);
    expect(error).toMatchObject({ code });
  });

  it("a 413 says the file is too large", async () => {
    const error = await extractText(bytes, "pdf", { config, fetch: vi.fn().mockResolvedValue(json({}, 413)) }).catch((e) => e);
    expect(error.userMessage).toBe("The file is larger than 4 MB.");
  });

  it("an answer in the wrong shape is rejected, not trusted", async () => {
    const error = await extractText(bytes, "pdf", { config, fetch: vi.fn().mockResolvedValue(json({ text: 5 })) }).catch((e) => e);
    expect(error).toMatchObject({ code: "invalid_response" });
  });
});

describe("getExtractorConfig", () => {
  const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;

  it("needs the key, defaults the URL and trims trailing slashes", () => {
    expect(() => getExtractorConfig(env({}))).toThrow(ExtractorError);
    expect(getExtractorConfig(env({ EXTRACTOR_KEY: " k " }))).toEqual({ url: "http://127.0.0.1:8001", key: "k" });
    expect(getExtractorConfig(env({ EXTRACTOR_KEY: "k", EXTRACTOR_URL: "http://localhost:9000//" })).url).toBe(
      "http://localhost:9000",
    );
  });
});
