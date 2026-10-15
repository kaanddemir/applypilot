import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("the page declares an existing icon instead of relying on /favicon.ico", async () => {
  const html = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.match(html, /<link rel="icon" type="image\/svg\+xml" href="assets\/icon\.svg"\s*\/>/);
  await access(new URL("../frontend/assets/icon.svg", import.meta.url));
});
