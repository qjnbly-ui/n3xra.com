import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../", import.meta.url);

test("website billing can open a plain-language cash payment form", async () => {
  const [billing, operations, admin, page] = await Promise.all([
    readFile(new URL("client-portal/billing/billing.js", root), "utf8"),
    readFile(new URL("account/admin/operations/operations.js", root), "utf8"),
    readFile(new URL("account/admin/admin.js", root), "utf8"),
    readFile(new URL("account/admin/operations/index.html", root), "utf8"),
  ]);

  assert.match(billing, /create: "payment"/);
  assert.match(operations, /params\.get\("create"\) === "payment"/);
  assert.match(operations, /payment_method: "cash"/);
  assert.match(admin, /operations\.js\?v=16/);
  assert.match(page, /admin\.js\?v=44/);
});
