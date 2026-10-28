// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decoyHash, hashPassword, verifyPassword } from "./password";

describe("passwords", () => {
  it("are stored as a salted hash, never as the password", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[\w-]+\$[\w-]+$/);
    expect(stored).not.toContain("correct horse");
    expect(stored.length).toBeGreaterThan(40);
    expect(stored.length).toBeLessThan(400); // the app_users column limit
  });

  it("the same password gets a different hash each time, and both verify", async () => {
    const [a, b] = await Promise.all([hashPassword("secret1"), hashPassword("secret1")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("secret1", a)).toBe(true);
    expect(await verifyPassword("secret1", b)).toBe(true);
  });

  it("a wrong password, a near miss and an empty one do not verify", async () => {
    const stored = await hashPassword("secret1");
    for (const attempt of ["secret2", "Secret1", "secret1 ", "", "1234"]) expect(await verifyPassword(attempt, stored)).toBe(false);
  });

  it("a stored value that is not one of ours never verifies and never throws", async () => {
    for (const stored of ["", "plain", "scrypt$1$2", "bcrypt$1$2$3$4$5", "scrypt$x$8$1$AA$BB", "scrypt$16384$8$1$AA$BB"]) {
      expect(await verifyPassword("secret1", stored)).toBe(false);
    }
  });

  it("has a decoy hash that no password matches", async () => {
    expect(await verifyPassword("secret1", await decoyHash())).toBe(false);
  });
});
