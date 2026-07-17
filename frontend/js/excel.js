"use strict";

import { formatDate, normalizeApps } from "./state.js";

// Column model for the Excel export. Keep Company/Role/Status/Source/Applied/
// Notes names stable so exported files round-trip through the importer.
const BASE_EXPORT_COLUMNS = [
  { header: "Company", width: 22, get: (a) => a.company || "" },
  { header: "Role", width: 26, get: (a) => a.role || "" },
  { header: "Status", width: 12, get: (a) => a.status || "" },
  { header: "Applied", width: 14, get: (a) => (a.appliedAt ? formatDate(a.appliedAt) : "") },
  { header: "AI Reviewed", width: 12, get: (a) => (a.matchAnalysis ? "Yes" : "No") },
  { header: "AI Fit", width: 40, get: (a) => a.matchAnalysis?.summary || "" },
  { header: "AI Recommendation", width: 48, get: (a) => a.matchAnalysis?.overall_recommendation || "" },
  { header: "Notes", width: 40, get: (a) => a.notes || "" },
  { header: "Job Description", width: 72, get: (a) => a.jobText || "" },
  { header: "Created", width: 14, get: (a) => (a.createdAt ? formatDate(a.createdAt) : "") },
  { header: "Last Updated", width: 14, get: (a) => (a.updatedAt ? formatDate(a.updatedAt) : "") },
  { header: "Application ID", width: 18, get: (a) => a.id || "" },
];

function applicationSources(app) {
  return Array.isArray(app.jobSources) ? app.jobSources : [];
}

function exportColumns(apps) {
  const sourceCount = Math.max(1, ...apps.map((app) => applicationSources(app).length));
  const sourceColumns = [];
  for (let index = 0; index < sourceCount; index++) {
    const suffix = sourceCount === 1 ? "" : " " + (index + 1);
    sourceColumns.push(
      { header: "Source" + suffix, width: 18, get: (a) => applicationSources(a)[index]?.source || "" },
      {
        header: "Job URL" + suffix,
        width: 42,
        get: (a) => {
          const url = applicationSources(a)[index]?.url || "";
          return /^https?:\/\/\S+$/i.test(url) ? { value: url, hyperlink: url } : url;
        },
      },
    );
  }
  return BASE_EXPORT_COLUMNS.slice(0, 3).concat(sourceColumns, BASE_EXPORT_COLUMNS.slice(3));
}

export function exportExcelTable(apps) {
  const columns = exportColumns(apps);
  const rows = [columns.map((c) => c.header)]
    .concat(apps.map((app) => columns.map((c) => c.get(app))));
  const blob = buildXlsx(rows, columns.map((c) => c.width));
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const stamp = new Date().toISOString().slice(0, 10);
  a.download = "applypilot-applications-" + stamp + ".xlsx";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildXlsx(rows, widths) {
  const hyperlinks = [];
  const sheetRows = rows.map((row, rIdx) => {
    const attrs = rIdx === 0 ? ' ht="26" customHeight="1"' : "";
    return '<row r="' + (rIdx + 1) + '"' + attrs + '>' +
      row.map((value, cIdx) => cellXml(cIdx, rIdx, value, hyperlinks)).join("") + "</row>";
  }).join("");
  const colCount = rows[0] ? rows[0].length : 1;
  const lastCol = columnName(colCount);
  const lastRow = rows.length;
  const cols = "<cols>" + (widths || []).map((w, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'
  ).join("") + "</cols>";
  const sheetViews = '<sheetViews><sheetView workbookViewId="0">' +
    '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
    '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
  const autoFilter = '<autoFilter ref="A1:' + lastCol + lastRow + '"/>';
  const hyperlinkXml = hyperlinks.length
    ? "<hyperlinks>" + hyperlinks.map((link) => '<hyperlink ref="' + link.ref + '" r:id="' + link.id + '"/>').join("") + "</hyperlinks>"
    : "";
  const hyperlinkRels = hyperlinks.length
    ? '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      hyperlinks.map((link) => '<Relationship Id="' + link.id + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="' + xmlEsc(link.target) + '" TargetMode="External"/>').join("") +
      "</Relationships>"
    : "";
  const files = {
    "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      "</Types>",
    "_rels/.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      "</Relationships>",
    "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets><sheet name="Applications" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      "</Relationships>",
    "xl/styles.xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="3">' +
        '<font><sz val="11"/><color rgb="FF1F2430"/><name val="Calibri"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
        '<font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/></font>' +
      '</fonts>' +
      '<fills count="4">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF4F46E5"/></patternFill></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFF3F4FB"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color rgb="FFDDE1EA"/></left><right style="thin"><color rgb="FFDDE1EA"/></right><top style="thin"><color rgb="FFDDE1EA"/></top><bottom style="thin"><color rgb="FFDDE1EA"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="6">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
        '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '</cellXfs>' +
      "</styleSheet>",
    "xl/worksheets/sheet1.xml": '<?xml version="1.0" encoding="UTF-8"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      sheetViews +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      cols +
      '<sheetData>' + sheetRows + "</sheetData>" +
      autoFilter +
      hyperlinkXml +
      "</worksheet>",
  };
  if (hyperlinkRels) files["xl/worksheets/_rels/sheet1.xml.rels"] = hyperlinkRels;
  return zipFiles(files);
}

function cellXml(cIdx, rIdx, rawValue, hyperlinks) {
  const ref = columnName(cIdx + 1) + (rIdx + 1);
  const isHyperlink = rawValue && typeof rawValue === "object" && rawValue.hyperlink;
  const value = isHyperlink ? rawValue.value : rawValue;
  // 1 = header, 2 = data, 3 = zebra (alternating data rows)
  // 4/5 are the corresponding hyperlink styles.
  const s = rIdx === 0 ? 1 : (isHyperlink ? (rIdx % 2 === 1 ? 4 : 5) : (rIdx % 2 === 1 ? 2 : 3));
  if (isHyperlink) hyperlinks.push({ ref, id: "rId" + (hyperlinks.length + 1), target: rawValue.hyperlink });
  return '<c r="' + ref + '" t="inlineStr" s="' + s + '"><is><t xml:space="preserve">' + xmlEsc(value) + "</t></is></c>";
}

function columnName(n) {
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function xmlEsc(value) {
  // XML 1.0 rejects most control characters and unpaired surrogates. Remove
  // only invalid code points while preserving tabs, line breaks and emoji.
  const safe = Array.from(String(value ?? "")).filter((ch) => {
    const cp = ch.codePointAt(0);
    return cp === 0x09 || cp === 0x0a || cp === 0x0d
      || (cp >= 0x20 && cp <= 0xd7ff)
      || (cp >= 0xe000 && cp <= 0xfffd)
      || (cp >= 0x10000 && cp <= 0x10ffff);
  }).join("");
  return safe.replace(/[<>&'"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" }[ch]));
}

function zipFiles(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const local = zipHeader(0x04034b50, 20, 0, 0, crc, data.length, data.length, nameBytes.length, 0);
    chunks.push(local, nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += local.length + nameBytes.length + data.length;
  });
  let centralSize = 0;
  central.forEach((entry) => {
    const header = zipCentralHeader(entry);
    chunks.push(header, entry.nameBytes);
    centralSize += header.length + entry.nameBytes.length;
  });
  chunks.push(zipEndRecord(central.length, centralSize, offset));
  return new Blob(chunks, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

function zipHeader(sig, version, flags, compression, crc, compressedSize, size, nameLen, extraLen) {
  const bytes = new Uint8Array(30);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, sig, true);
  view.setUint16(4, version, true);
  view.setUint16(6, flags, true);
  view.setUint16(8, compression, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, 0, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, compressedSize, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameLen, true);
  view.setUint16(28, extraLen, true);
  return bytes;
}

function zipCentralHeader(entry) {
  const bytes = new Uint8Array(46);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(14, 0, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint32(42, entry.offset, true);
  return bytes;
}

function zipEndRecord(count, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, count, true);
  view.setUint16(10, count, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  return bytes;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- Excel import -----------------------------------------------------------
// Reads an .xlsx (our own export, or one edited/saved in Excel). Handles both
// stored and deflate-compressed zip entries, and both inline and shared strings.
export async function readExcelApplications(file) {
  try {
    const entries = await unzip(await file.arrayBuffer());
    const dec = new TextDecoder();
    const sheetKey = Object.keys(entries).find((n) => /^xl\/worksheets\/sheet1\.xml$/i.test(n))
      || Object.keys(entries).find((n) => /^xl\/worksheets\/.+\.xml$/i.test(n));
    if (!sheetKey) throw new Error("No worksheet found in that file.");
    const sharedKey = Object.keys(entries).find((n) => /^xl\/sharedStrings\.xml$/i.test(n));
    const shared = parseSharedStrings(sharedKey ? dec.decode(entries[sharedKey]) : "");
    const rows = parseSheetRows(dec.decode(entries[sheetKey]), shared);
    if (rows.length < 2) throw new Error("The sheet has no data rows.");

    const header = (rows[0] || []).map((h) => String(h || "").trim().toLowerCase());
    const col = (name) => header.indexOf(name);
    const ci = {
      company: col("company"), role: col("role"), status: col("status"),
      applied: col("applied"), notes: col("notes"), created: col("created"),
      jobText: col("job description"),
      updated: col("last updated"), reviewed: col("ai reviewed"),
      fit: col("ai fit"), recommendation: col("ai recommendation"), id: col("application id"),
    };
    if (ci.company === -1 && ci.role === -1) {
      throw new Error("Missing Company/Role columns. Use a file exported from ApplyPilot.");
    }
    const cell = (row, i) => (i >= 0 ? String((row && row[i]) ?? "").trim() : "");
    const numberedColumns = (name) => header
      .map((value, index) => {
        const match = new RegExp("^" + name + "(?:\\s+(\\d+))?$").exec(value);
        return match ? { index, order: match[1] ? Number(match[1]) : 1 } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.order - b.order);
    const sourceColumns = numberedColumns("source");
    const urlColumns = numberedColumns("job url");
    const pairedSources = (row) => {
      const count = Math.max(sourceColumns.length, urlColumns.length);
      const pairs = [];
      for (let index = 0; index < count; index++) {
        const source = cell(row, sourceColumns[index]?.index ?? -1);
        const url = cell(row, urlColumns[index]?.index ?? -1);
        if (source || url) pairs.push({ source, url });
      }
      return pairs;
    };
    const raw = rows.slice(1)
      .filter((r) => r && r.some((v) => String(v || "").trim()))
      .map((r) => {
        const fit = cell(r, ci.fit);
        const recommendation = cell(r, ci.recommendation);
        const reviewed = /^(yes|true|1)$/i.test(cell(r, ci.reviewed));
        return {
          id: cell(r, ci.id) || undefined,
          company: cell(r, ci.company),
          role: cell(r, ci.role),
          status: cell(r, ci.status),
          jobSources: pairedSources(r),
          appliedAt: cell(r, ci.applied),
          notes: cell(r, ci.notes),
          jobText: cell(r, ci.jobText),
          matchAnalysis: reviewed || recommendation || fit ? { summary: fit, overall_recommendation: recommendation } : null,
          createdAt: cell(r, ci.created) || undefined,
          updatedAt: cell(r, ci.updated) || undefined,
        };
      });
    const imported = normalizeApps(raw);
    if (!imported.length) throw new Error("No rows to import.");
    return imported;
  } catch (err) {
    throw new Error(err.message || "Could not read that file.");
  }
}

async function unzip(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error("Not a valid .xlsx (zip) file.");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = {};
  const decoder = new TextDecoder();
  for (let e = 0; e < count; e++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOff = view.getUint32(ptr + 42, true);
    const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    const lNameLen = view.getUint16(localOff + 26, true);
    const lExtraLen = view.getUint16(localOff + 28, true);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = bytes.subarray(dataStart, dataStart + compSize);
    out[name] = method === 0 ? comp : await inflateRaw(comp);
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser can't read compressed .xlsx. Use Chrome/Edge, or re-export from ApplyPilot.");
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function xmlUnesc(s) {
  return String(s)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d))
    .replace(/&amp;/g, "&");
}

function colToIndex(ref) {
  const m = /^([A-Z]+)/.exec(ref);
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m;
  while ((m = siRe.exec(xml))) {
    const texts = [];
    const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
    let t;
    while ((t = tRe.exec(m[1]))) texts.push(xmlUnesc(t[1]));
    out.push(texts.join(""));
  }
  return out;
}

function parseSheetRows(xml, shared) {
  const rows = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const cells = [];
    const cellRe = /<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm;
    let seq = 0;
    while ((cm = cellRe.exec(rm[1]))) {
      const attrs = cm[1];
      const body = cm[2] || "";
      const refM = /r="([A-Z]+\d+)"/.exec(attrs);
      const idx = refM ? colToIndex(refM[1]) : seq;
      const typeM = /t="([^"]+)"/.exec(attrs);
      const type = typeM ? typeM[1] : "";
      let value = "";
      if (type === "s") {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = vM ? (shared[Number(vM[1])] || "") : "";
      } else if (type === "inlineStr") {
        const isM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body);
        value = isM ? xmlUnesc(isM[1]) : "";
      } else {
        const vM = /<v>([\s\S]*?)<\/v>/.exec(body);
        if (vM) value = xmlUnesc(vM[1]);
        else { const tM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(body); value = tM ? xmlUnesc(tM[1]) : ""; }
      }
      cells[idx] = value;
      seq++;
    }
    rows.push(cells);
  }
  return rows;
}
