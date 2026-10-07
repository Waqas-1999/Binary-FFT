import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/test-app.ts";
import { AuthService } from "./auth.service.ts";

let t: TestApp;
let auth: AuthService;

beforeAll(async () => {
  t = await createTestApp();
  auth = t.app.get(AuthService);
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.reset();
});

// Distinct IPs so per-IP signup limits don't interfere with concurrency tests.
const client = (i: number) => ({ ip: `10.0.${Math.floor(i / 250)}.${i % 250}`, userAgent: "test" });

describe("user numbers", () => {
  it("are unique, start at 10000 or above, and are safe under concurrent signups", async () => {
    const count = 25;
    await Promise.all(
      Array.from({ length: count }, (_, i) =>
        auth.signup({ email: `user${i}@example.com`, password: "calm-river-sunrise-42" }, client(i)),
      ),
    );

    const users = await t.prisma.user.findMany({ select: { userNumber: true } });
    const numbers = users.map((user) => user.userNumber);
    expect(numbers).toHaveLength(count);
    expect(new Set(numbers).size).toBe(count);
    expect(Math.min(...numbers)).toBeGreaterThanOrEqual(10000);
  });

  it("increase and are never reused after deletion", async () => {
    const first = await t.prisma.user.create({ data: {}, select: { id: true, userNumber: true } });
    await t.prisma.user.delete({ where: { id: first.id } });
    const second = await t.prisma.user.create({ data: {}, select: { userNumber: true } });
    expect(second.userNumber).toBeGreaterThan(first.userNumber);
  });

  it("cannot be supplied by the caller", async () => {
    await expect(
      t.prisma.$executeRaw`INSERT INTO users (id, user_number, updated_at) VALUES (gen_random_uuid(), 1, now())`,
    ).rejects.toThrow(/GENERATED ALWAYS|cannot insert/i);
  });

  it("are immutable once assigned", async () => {
    const user = await t.prisma.user.create({ data: {}, select: { id: true } });
    // Explicit values are rejected by the identity column...
    await expect(t.prisma.$executeRaw`UPDATE users SET user_number = 99999 WHERE id = ${user.id}::uuid`).rejects.toThrow(
      /can only be updated to DEFAULT/,
    );
    // ...and re-drawing a new number via DEFAULT is rejected by the trigger.
    await expect(t.prisma.$executeRaw`UPDATE users SET user_number = DEFAULT WHERE id = ${user.id}::uuid`).rejects.toThrow(
      /immutable/,
    );
  });
});

describe("concurrent signups for one email", () => {
  it("create exactly one account", async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        auth.signup({ email: "same@example.com", password: "calm-river-sunrise-42" }, client(i)),
      ),
    );
    expect(await t.prisma.emailAccount.count()).toBe(1);
    expect(await t.prisma.user.count()).toBe(1);
  });
});
