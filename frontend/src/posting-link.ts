import { isSafeJobUrl } from "./input-validation.js";

export function openPostingUrl(
  url: string,
  open: (url: string, target: string, features: string) => Window | null = (value, target, features) => window.open(value, target, features),
): "invalid" | "requested" | "error" {
  if (!isSafeJobUrl(url)) return "invalid";
  try {
    // With noopener/noreferrer, null does not prove that navigation failed.
    open(url, "_blank", "noopener,noreferrer");
    return "requested";
  } catch {
    return "error";
  }
}
