// Shared limits for editable fields and files. Imported and restored values are
// untrusted too; callers decide whether to reject or display invalid data.
export const INPUT_LIMITS = {
  company: 120,
  role: 200,
  jobUrl: 2_048,
  source: 120,
  notes: 5_000,
  jobText: 30_000,
  profile: 30_000,
  cvFileBytes: 10 * 1024 * 1024,
  storedCvBytes: 2 * 1024 * 1024,
  excelBytes: 20 * 1024 * 1024,
  excelRows: 10_000,
  excelColumns: 64,
} as const;

export function isSafeJobUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > INPUT_LIMITS.jobUrl || /[\u0000-\u0020\u007f\\]/u.test(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}

export function isSafeProfileDataUrl(value: unknown, mime: "pdf" | "docx"): value is string {
  if (typeof value !== "string" || value.length > Math.ceil(INPUT_LIMITS.storedCvBytes * 4 / 3) + 200) return false;
  const prefix = mime === "pdf" ? "data:application/pdf;base64," : "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,";
  const encoded = value.slice(prefix.length);
  const magic = mime === "pdf" ? "JVBERi0" : "UEsDB";
  return value.startsWith(prefix) && encoded.startsWith(magic) && /^[A-Za-z0-9+/]+={0,2}$/.test(encoded);
}

export function isValidDate(value: unknown): boolean {
  if (value === "") return true;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function toDateInput(value: unknown): string {
  if (isValidDate(value) && typeof value === "string") return value;
  if (typeof value !== "string" || !value.trim()) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

export function hasDisallowedControl(value: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
}
