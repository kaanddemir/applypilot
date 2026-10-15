export const LS = {
  profile: "applypilot_profile",
  profileFile: "applypilot_profile_file",
  applications: "applypilot_applications",
  view: "applypilot_view",
  selectedId: "applypilot_selected",
  boardLayout: "applypilot_board_layout",
  filter: "applypilot_filter",
  sortBy: "applypilot_sort",
  theme: "applypilot_theme",
} as const;

export type StorageRead<T> =
  | { ok: true; found: boolean; value: T }
  | { ok: false; found: false; value: T; error: "unavailable" | "malformed" | "oversized" };

export const store = {
  get(key: string, fallback: string | null): string | null {
    try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string): boolean {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  },
  remove(key: string): boolean {
    try { localStorage.removeItem(key); return true; } catch { return false; }
  },
  getJSON(key: string, fallback: unknown): unknown {
    try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value) as unknown; } catch { return fallback; }
  },
  setJSON(key: string, value: unknown): boolean {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  },
  readJSON<T>(key: string, fallback: T): StorageRead<T> {
    let raw: string | null;
    try { raw = localStorage.getItem(key); } catch { return { ok: false, found: false, value: fallback, error: "unavailable" }; }
    if (raw == null) return { ok: true, found: false, value: fallback };
    if (raw.length > 8 * 1024 * 1024) return { ok: false, found: false, value: fallback, error: "oversized" };
    try { return { ok: true, found: true, value: JSON.parse(raw) as T }; }
    catch { return { ok: false, found: false, value: fallback, error: "malformed" }; }
  },
};
