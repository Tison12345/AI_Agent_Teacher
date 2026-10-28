// @vitest-environment node
import { describe, expect, it } from "vitest";
import { workflowPoolSettings, WorkflowConfigError } from "./db";

const REMOTE = "postgresql://langgraph_app.abcdefgh:s3cretPASS@aws-0-eu.pooler.supabase.com:6543/postgres";
const ca = () => "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";

describe("workflowPoolSettings", () => {
  it("a remote database gets verified TLS with the downloaded CA certificate", () => {
    const settings = workflowPoolSettings({ DATABASE_URL: REMOTE }, ca, "/repo");
    expect(settings.ssl).toEqual({ ca: ca(), rejectUnauthorized: true });
    expect(settings.connectionString).toContain("aws-0-eu.pooler.supabase.com:6543");
  });

  it("looks for the certificate at the default path, or at DATABASE_CA_PATH", () => {
    const seen: string[] = [];
    workflowPoolSettings({ DATABASE_URL: REMOTE }, (f) => (seen.push(f), ca()), "/repo");
    workflowPoolSettings({ DATABASE_URL: REMOTE, DATABASE_CA_PATH: "other/ca.pem" }, (f) => (seen.push(f), ca()), "/repo");
    expect(seen[0].replace(/\\/g, "/")).toMatch(/\/repo\/certs\/supabase-ca\.crt$|certs\/supabase-ca\.crt$/);
    expect(seen[1].replace(/\\/g, "/")).toMatch(/other\/ca\.pem$/);
  });

  it("never switches certificate verification off: a missing certificate is an error that names the file only", () => {
    let error: unknown;
    try {
      workflowPoolSettings({ DATABASE_URL: REMOTE }, () => null, "/repo");
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(WorkflowConfigError);
    expect((error as Error).message).toContain("certs/supabase-ca.crt");
    expect((error as Error).message).not.toContain("s3cretPASS");
  });

  it("removes connection-string options that would override the TLS settings", () => {
    const settings = workflowPoolSettings({ DATABASE_URL: `${REMOTE}?sslmode=require&sslrootcert=system&application_name=x` }, ca, "/repo");
    expect(settings.connectionString).not.toMatch(/sslmode|sslrootcert/);
    expect(settings.connectionString).toContain("application_name=x");
  });

  it("a local database needs no TLS", () => {
    expect(workflowPoolSettings({ DATABASE_URL: "postgresql://u:p@localhost:5432/db" }, () => null).ssl).toBe(false);
    expect(workflowPoolSettings({ DATABASE_URL: "postgres://u:p@127.0.0.1:5432/db" }, () => null).ssl).toBe(false);
  });

  it("rejects a missing or malformed URL without echoing it", () => {
    expect(() => workflowPoolSettings({}, ca)).toThrow(/DATABASE_URL is not set/);
    expect(() => workflowPoolSettings({ DATABASE_URL: "   " }, ca)).toThrow(/not set/);
    let message = "";
    try {
      workflowPoolSettings({ DATABASE_URL: "not a url with s3cret" }, ca);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/not a valid connection URL/);
    expect(message).not.toContain("s3cret");
    expect(() => workflowPoolSettings({ DATABASE_URL: "https://example.com/db" }, ca)).toThrow(/postgresql/);
  });
});
