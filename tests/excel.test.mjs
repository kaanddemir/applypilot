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
const { normalizeApps } = await import("../frontend/js/state.js");

function makeWorkbook(apps) {
  exportedBlob = null;
  exportExcelTable(apps);
  assert.ok(exportedBlob instanceof Blob, "export should produce an Excel blob");
  return exportedBlob;
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
      id: "AP-1234-5678",
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
  assert.equal(imported[0].id, "AP-1234-5678");
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

test("application normalization emits only the current schema", () => {
  const [app] = normalizeApps([{
    id: "legacy-app",
    company: "Current Co",
    role: "Designer",
    status: "Unknown",
    jobSources: [{ source: "Company site", url: "https://example.com/job" }],
    jobUrl: "https://legacy.example/job",
    jobUrls: ["https://legacy.example/job"],
    source: "Legacy source",
    sources: ["Legacy source"],
    nextAction: "Legacy action",
  }]);

  assert.match(app.id, /^AP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  assert.equal(app.status, "Saved");
  assert.deepEqual(app.jobSources, [
    { source: "Company site", url: "https://example.com/job" },
  ]);
  for (const removed of ["jobUrl", "jobUrls", "source", "sources", "nextAction"]) {
    assert.equal(Object.hasOwn(app, removed), false, `${removed} should not be emitted`);
  }
});
