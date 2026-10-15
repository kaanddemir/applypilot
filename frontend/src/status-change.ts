import { statusFeedback } from "./operation-notifications.js";
import type { OperationNotifier } from "./operation-notifications.js";

export type StatusApplication = { status: string; updatedAt?: number };
export type StatusChangeResult = "unchanged" | "saved" | "unsaved";

// Keep mutation, persistence and the visible update in one ordered pathway.
// Rendering precedes notification delivery so feedback UI can never prevent
// the card/table/detail view from reflecting the in-memory state.
export function applyStatusChange(
  app: StatusApplication,
  status: string,
  persist: () => boolean,
  render: () => void,
  output?: OperationNotifier,
  now: () => number = Date.now,
): StatusChangeResult {
  if (!app || app.status === status) return "unchanged";
  app.status = status;
  app.updatedAt = now();
  const saved = persist();
  render();
  statusFeedback(saved, status, output);
  return saved ? "saved" : "unsaved";
}
