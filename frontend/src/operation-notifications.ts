import { notify } from "./notifications.js";

export type OperationNotifier = Pick<typeof notify, "success" | "error" | "warning" | "info">;

export function applicationSaveFeedback(saved: boolean, editing: boolean, output: OperationNotifier = notify): void {
  if (saved) output.success(editing ? "Application updated." : "Application added.");
  else output.error("Application could not be saved.", { detail: "The changes remain in this tab. Export a backup before closing it." });
}

export function deletionFeedback(saved: boolean, count: number, output: OperationNotifier = notify): void {
  if (saved) output.success(count > 1 ? count + " applications deleted." : "Application deleted.");
  else output.error("Deletion could not be saved.", { detail: "The records are removed in this tab. Export a backup before closing it." });
}

export function statusFeedback(saved: boolean, status: string, output: OperationNotifier = notify): void {
  if (saved) output.info("Moved to " + status + ".", { key: "application-status" });
  else output.error("Changes could not be saved.", { detail: "The status changed in this tab. Export a backup before closing it.", key: "storage-save-failed" });
}

export function cvSaveFeedback(saved: { textSaved: boolean; fileSaved: boolean }, originalFileOmitted: boolean, output: OperationNotifier = notify): void {
  if (!saved.textSaved) output.error("CV could not be saved.", { detail: "The changes remain in this tab. Browser storage may be full or unavailable." });
  else if (!saved.fileSaved || originalFileOmitted) output.warning("CV text saved.", { detail: "The original file is unavailable for local preview." });
  else output.success("CV saved.");
}

export function cvDeleteFeedback(saved: { textSaved: boolean; fileSaved: boolean }, output: OperationNotifier = notify): void {
  if (saved.textSaved && saved.fileSaved) output.success("CV deleted.");
  else output.error("CV deletion could not be saved.", { detail: "The CV is removed in this tab, but browser storage could not be updated." });
}

export function importFeedback(result: { added: number; skipped: number }, persisted: boolean, output: OperationNotifier = notify): void {
  if (!persisted) {
    output.error("Import could not be saved.", { detail: result.added + " application" + (result.added === 1 ? " was" : "s were") + " loaded in this tab. Export a backup before closing it." });
    return;
  }
  const message = result.added ? "Import completed." : "No new applications found.";
  const detail = result.added + " added" + (result.skipped ? ", " + result.skipped + " duplicate" + (result.skipped === 1 ? "" : "s") + " skipped" : "") + ".";
  (result.skipped ? output.warning : result.added ? output.success : output.info)(message, { detail });
}

export function analysisFeedback(saved: boolean, output: OperationNotifier = notify): void {
  if (saved) output.success("Analysis completed.");
  else output.error("Analysis could not be saved.", { detail: "Export a backup before closing this tab." });
}

export function autosaveFeedback(saved: boolean, field: "Notes" | "Job description", announceSuccess: boolean, output: OperationNotifier = notify): void {
  const key = "autosave-" + field.toLowerCase().replace(" ", "-");
  if (saved) {
    if (announceSuccess) output.success(field + " saved.", { key });
    return;
  }
  output.error("Changes could not be saved.", {
    detail: field + " changes remain in this tab. Export a backup before closing it.",
    key: "storage-save-failed",
  });
}

export function cvFileFailureFeedback(detail: string, output: OperationNotifier = notify): void {
  output.warning("CV file could not be processed.", { detail: detail || "Choose another file and try again.", key: "cv-file-error" });
}
