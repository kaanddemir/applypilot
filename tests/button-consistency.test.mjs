import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [baseCss, appCss, board, profile, wizards, index] = await Promise.all([
  readFile(new URL("../frontend/css/base.css", import.meta.url), "utf8"),
  readFile(new URL("../frontend/css/app.css", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/board.ts", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/profile.ts", import.meta.url), "utf8"),
  readFile(new URL("../frontend/src/wizards.ts", import.meta.url), "utf8"),
  readFile(new URL("../frontend/index.html", import.meta.url), "utf8"),
]);

test("shared action variants use the control tokens and consistent icon sizing", () => {
  assert.match(baseCss, /--control-h:\s*40px/);
  assert.match(baseCss, /\.primary-btn, \.secondary-btn, \.danger-btn, \.ghost-btn\s*\{[^}]*min-height:\s*var\(--control-h\)/s);
  assert.match(baseCss, /\.primary-btn svg, \.secondary-btn svg, \.danger-btn svg, \.ghost-btn svg\s*\{[^}]*width:\s*16px;\s*height:\s*16px/s);
  assert.match(baseCss, /\.icon-btn svg\s*\{[^}]*width:\s*18px;\s*height:\s*18px/s);
  assert.match(baseCss, /button\[aria-busy="true"\]\s*\{[^}]*cursor:\s*progress/s);
});

test("modal footers and close actions follow the shared conventions", () => {
  assert.match(baseCss, /\.modal-foot\s*\{[^}]*justify-content:\s*flex-end;[^}]*gap:\s*10px/s);
  assert.match(baseCss, /\.modal-foot > \.primary-btn, \.modal-foot > \.secondary-btn, \.modal-foot > \.danger-btn\s*\{[^}]*min-width:\s*84px/s);
  for (const source of [profile, wizards]) {
    const closeButtons = [...source.matchAll(/<button class=\"icon-btn\" id=\"modalClose\"[^>]*>/g)].map((match) => match[0]);
    assert.ok(closeButtons.length > 0);
    closeButtons.forEach((button) => assert.match(button, /aria-label=\"Close/));
  }
});

test("recognizable actions keep their established icons and accessible names", () => {
  assert.match(index, /id="addAppBtn"[\s\S]*?<svg[^>]*aria-hidden="true"/);
  assert.match(board, /I\.external \+ "Open posting/);
  assert.match(board, /I\.edit \+ "Edit/);
  assert.match(board, /I\.trash \+ "Delete/);
  assert.match(board, /I\.bolt \+ \(a \? "Re-analyze" : "Analyze"\)/);
  assert.match(board, /I\.back \+ 'Back to applications/);
  assert.match(profile, /I\.download \+ 'Download original/);
  assert.match(profile, /I\.trash \+ 'Delete/);
  assert.match(profile, /aria-label="Copy extracted text"/);
});

test("toolbar and compact table controls retain their intentional size scale", () => {
  assert.match(appCss, /\.search input\s*\{[^}]*height:\s*var\(--control-h\)/s);
  assert.match(appCss, /\.seg\s*\{[^}]*padding:\s*3px/s);
  assert.match(appCss, /\.seg-btn\s*\{[^}]*height:\s*32px/s);
  assert.match(appCss, /\.mini-select\s*\{[^}]*height:\s*var\(--control-h-sm\)/s);
  assert.match(appCss, /@media \(max-width: 640px\)[\s\S]*?\.table-edit-btn\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/s);
});
