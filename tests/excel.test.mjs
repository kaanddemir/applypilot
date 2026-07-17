import assert from "node:assert/strict";
import test from "node:test";

let exportedBlob = null;

globalThis.document = {
  body: { appendChild() {} },
  createElement() {
    return {
      click() {},
      remove() {},
      set href(value) { this._href = value; },
      get href() { return this._href; },
      download: "",
    };
  },
  getElementById() { return null; },
};

URL.createObjectURL = (blob) => {
  exportedBlob = blob;
  return "blob:applypilot-test";
};
URL.revokeObjectURL = () => {};

const { exportExcelTable, readExcelApplications } = await import("../frontend/js/excel.js");

function makeWorkbook(apps) {
  exportedBlob = null;
  exportExcelTable(apps);
  assert.ok(exportedBlob instanceof Blob, "export should produce an Excel blob");
  return exportedBlob;
}

function replaceBytes(buffer, from, to) {
  assert.equal(from.length, to.length, "replacement text must have the same byte length");
  const bytes = new Uint8Array(buffer.slice(0));
  const needle = new TextEncoder().encode(from);
  const replacement = new TextEncoder().encode(to);
  let replacements = 0;
  for (let i = 0; i <= bytes.length - needle.length; i++) {
    let matches = true;
    for (let j = 0; j < needle.length; j++) {
      if (bytes[i + j] !== needle[j]) { matches = false; break; }
    }
    if (!matches) continue;
    bytes.set(replacement, i);
    replacements++;
    i += needle.length - 1;
  }
  assert.ok(replacements > 0, `expected to find ${from} in workbook`);
  return bytes;
}

test("job descriptions survive Excel export and import", async () => {
  const invalidControls = "\u0000\u000b\u001f";
  const jobText = [
    "Türkçe ilan açıklaması — Yazılım Geliştirici 🚀",
    "Satır 2: <React> & \"Node.js\" 'deneyimi'",
    `Kontrol karakterleri:${invalidControls}temizlenmeli`,
    "x".repeat(29_700),
  ].join("\n");
  const expectedJobText = jobText.replace(/[\u0000\u000b\u001f]/g, "");
  const workbook = makeWorkbook([
    {
      id: "app-special",
      company: "Örnek & Şirket",
      role: "Senior Developer",
      status: "Applied",
      jobSources: [
        { source: "LinkedIn", url: "https://example.com/jobs/1" },
        { source: "Company Site", url: "https://example.com/careers/1" },
      ],
      appliedAt: "2026-07-17",
      notes: "Not <önemli> & takip et",
      jobText,
      matchAnalysis: {
        summary: "Strong fit for the core requirements",
        overall_recommendation: "Proceed with a tailored application",
      },
      createdAt: "2026-07-16",
      updatedAt: "2026-07-17",
    },
    {
      id: "app-empty-description",
      company: "No Description Inc.",
      role: "Analyst",
      status: "Saved",
      jobText: "",
    },
  ]);

  const workbookText = new TextDecoder().decode(await workbook.arrayBuffer());
  assert.match(workbookText, /Job Description/);
  assert.match(workbookText, /<pane ySplit="1"/);
  assert.match(workbookText, /<autoFilter ref="A1:/);
  assert.match(workbookText, /<hyperlinks>/);
  assert.match(workbookText, /Kontrol karakterleri:temizlenmeli/);

  const imported = await readExcelApplications(workbook);
  assert.equal(imported.length, 2);
  assert.equal(imported[0].company, "Örnek & Şirket");
  assert.equal(imported[0].role, "Senior Developer");
  assert.equal(imported[0].status, "Applied");
  assert.equal(imported[0].notes, "Not <önemli> & takip et");
  assert.equal(imported[0].jobText, expectedJobText);
  assert.deepEqual(imported[0].matchAnalysis, {
    summary: "Strong fit for the core requirements",
    overall_recommendation: "Proceed with a tailored application",
  });
  assert.deepEqual(imported[0].jobSources, [
    { source: "LinkedIn", url: "https://example.com/jobs/1" },
    { source: "Company Site", url: "https://example.com/careers/1" },
  ]);
  assert.equal(imported[1].jobText, "");
});

test("older workbooks without a Job Description header still import", async () => {
  const workbook = makeWorkbook([{
    id: "legacy-app",
    company: "Legacy Co",
    role: "Designer",
    status: "Saved",
    notes: "Existing notes",
    jobText: "This column should be ignored by the legacy-header fixture",
  }]);
  const legacyBytes = replaceBytes(
    await workbook.arrayBuffer(),
    "Job Description",
    "Legacy Field 01",
  );
  const imported = await readExcelApplications(new Blob([legacyBytes]));

  assert.equal(imported.length, 1);
  assert.equal(imported[0].company, "Legacy Co");
  assert.equal(imported[0].notes, "Existing notes");
  assert.equal(imported[0].jobText, "");
});
