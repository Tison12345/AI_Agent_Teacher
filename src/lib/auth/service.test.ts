// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { AccountsUnavailableError, EmailTakenError, signIn, signUp, type UserRecord, type UserStore } from "./service";

function memoryStore(options: { unavailable?: boolean; raceOnCreate?: boolean } = {}) {
  const users = new Map<string, UserRecord>();
  const store: UserStore = {
    async findByEmail(email) {
      if (options.unavailable) throw new AccountsUnavailableError();
      return users.get(email) ?? null;
    },
    async create(user) {
      if (options.unavailable) throw new AccountsUnavailableError();
      if (options.raceOnCreate || users.has(user.email)) throw new EmailTakenError();
      const record = { ...user, id: `00000000-0000-4000-8000-${String(users.size + 1).padStart(12, "0")}` };
      users.set(user.email, record);
      return record;
    },
  };
  return { users, store };
}

const form = { role: "student", fullName: "Asha Fictional", email: "Asha.Fictional@Gmail.com", password: "secret1", confirmPassword: "secret1" };
let m: ReturnType<typeof memoryStore>;
beforeEach(() => {
  m = memoryStore();
});

describe("signUp", () => {
  it("creates the account, stores only a hash, and returns the session to sign in with", async () => {
    const result = await signUp(form, m.store);
    expect(result).toEqual({ ok: true, session: { id: m.users.get("asha.fictional@gmail.com")!.id, role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" } });
    const stored = m.users.get("asha.fictional@gmail.com")!;
    expect(stored).toMatchObject({ role: "student", fullName: "Asha Fictional" });
    expect(stored.passwordHash).toMatch(/^scrypt\$/);
    expect(JSON.stringify([...m.users.values()])).not.toContain("secret1");
  });

  it("works for faculty too", async () => {
    const result = await signUp({ ...form, role: "faculty", fullName: "Dr Rao", email: "dr.rao@college.edu" }, m.store);
    expect(result).toMatchObject({ ok: true, session: { role: "faculty", name: "Dr Rao" } });
  });

  it("refuses an email that already has an account, whatever the role, and changes nothing", async () => {
    await signUp(form, m.store);
    const again = await signUp({ ...form, role: "faculty", fullName: "Someone Else", password: "other-pass", confirmPassword: "other-pass" }, m.store);
    expect(again).toMatchObject({ ok: false, status: 409, code: "email_taken", fields: { email: expect.stringContaining("already exists") } });
    expect(m.users.size).toBe(1);
    expect(m.users.get("asha.fictional@gmail.com")!.fullName).toBe("Asha Fictional");
  });

  it("two sign-ups at the same moment: the loser of the race is told the email is taken", async () => {
    const race = memoryStore({ raceOnCreate: true });
    expect(await signUp(form, race.store)).toMatchObject({ ok: false, status: 409, code: "email_taken" });
  });

  it("names the fields that are wrong, before touching the store", async () => {
    const result = await signUp({ ...form, fullName: "A", password: "123", confirmPassword: "456" }, m.store);
    expect(result).toMatchObject({ ok: false, status: 400, code: "validation_failed" });
    if (!result.ok) expect(Object.keys(result.fields).sort()).toEqual(["confirmPassword", "fullName", "password"]);
    expect(m.users.size).toBe(0);
  });

  it("says accounts are not set up when the table is missing", async () => {
    expect(await signUp(form, memoryStore({ unavailable: true }).store)).toMatchObject({ ok: false, status: 503, code: "accounts_unavailable" });
  });
});

describe("signIn", () => {
  beforeEach(async () => {
    await signUp(form, m.store);
  });

  it("signs in with the password chosen at sign-up, in any letter case of the email", async () => {
    const result = await signIn({ role: "student", email: " ASHA.fictional@gmail.COM ", password: "secret1" }, m.store);
    expect(result).toEqual({ ok: true, session: { id: m.users.get("asha.fictional@gmail.com")!.id, role: "student", email: "asha.fictional@gmail.com", name: "Asha Fictional" } });
  });

  it("the old shared demo password no longer works", async () => {
    expect(await signIn({ role: "student", email: "asha.fictional@gmail.com", password: "1234" }, m.store)).toMatchObject({ ok: false, status: 401 });
  });

  it("a wrong password and an unknown email get the same answer", async () => {
    const wrong = await signIn({ role: "student", email: "asha.fictional@gmail.com", password: "nope" }, m.store);
    const unknown = await signIn({ role: "student", email: "nobody@gmail.com", password: "secret1" }, m.store);
    expect(wrong).toMatchObject({ ok: false, status: 401, code: "invalid_credentials", fields: { password: "Wrong email or password." } });
    expect(unknown).toEqual(wrong);
  });

  it("the right password with the wrong role is refused, and says which role the account is", async () => {
    const result = await signIn({ role: "faculty", email: "asha.fictional@gmail.com", password: "secret1" }, m.store);
    expect(result).toMatchObject({ ok: false, status: 401, code: "wrong_role", fields: { role: expect.stringContaining("Choose Student") } });
  });

  it("names the fields that are wrong, and says accounts are not set up when the table is missing", async () => {
    expect(await signIn({ role: "student", email: "x", password: "" }, m.store)).toMatchObject({ ok: false, status: 400 });
    expect(await signIn({ role: "student", email: "asha@gmail.com", password: "x" }, memoryStore({ unavailable: true }).store)).toMatchObject({ ok: false, status: 503 });
  });
});
