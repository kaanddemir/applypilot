import { NotificationStore } from "./notification-store.js";
import type { NotificationInput, NotificationTone } from "./notification-store.js";

type NotifyOptions = Pick<NotificationInput, "detail" | "duration" | "persistent" | "key">;

const store = new NotificationStore(4);

const ICONS: Record<NotificationTone, string> = {
  success: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg>',
  error: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 17h.01"/></svg>',
  warning: '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v4M12 17h.01"/></svg>',
  info: '<svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7h.01"/></svg>',
};

function render(): void {
  const center = document.getElementById("notificationCenter");
  if (!center) return;
  const visibleIds = new Set(store.visible.map((item) => String(item.id)));
  center.querySelectorAll<HTMLElement>("[data-notification-id]").forEach((element) => {
    if (!visibleIds.has(element.dataset.notificationId || "")) element.remove();
  });
  store.visible.forEach((item) => {
    let toast = center.querySelector<HTMLElement>('[data-notification-id="' + item.id + '"]');
    if (!toast) {
      toast = document.createElement("section");
      toast.dataset.notificationId = String(item.id);
      toast.innerHTML = '<span class="notification-icon"></span>' +
        '<div class="notification-copy"><p class="notification-message"></p><p class="notification-detail"></p></div>' +
        '<button class="notification-close" type="button" aria-label="Dismiss notification">' +
        '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m6 6 12 12M18 6 6 18"/></svg></button>';
      toast.querySelector(".notification-close")?.addEventListener("click", () => store.dismiss(item.id));
    }
    toast.className = "notification notification-" + item.tone;
    toast.setAttribute("role", item.tone === "error" ? "alert" : "status");
    toast.setAttribute("aria-live", item.tone === "error" ? "assertive" : "polite");
    toast.setAttribute("aria-atomic", "true");
    (toast.querySelector(".notification-icon") as HTMLElement).innerHTML = ICONS[item.tone];
    (toast.querySelector(".notification-message") as HTMLElement).textContent = item.message;
    const detail = toast.querySelector<HTMLElement>(".notification-detail");
    if (detail) { detail.textContent = item.detail || ""; detail.hidden = !item.detail; }
    center.appendChild(toast);
  });
}

let renderQueued = false;
store.subscribe(() => {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    try { render(); }
    catch (error) { console.error("Notification render failed.", error); }
  });
});

function send(tone: NotificationTone, message: string, options: NotifyOptions = {}): number {
  try { return store.add({ tone, message, ...options }); }
  catch (error) {
    console.error("Notification dispatch failed.", error);
    return 0;
  }
}

export const notify = {
  success: (message: string, options?: NotifyOptions) => send("success", message, options),
  error: (message: string, options?: NotifyOptions) => send("error", message, options),
  warning: (message: string, options?: NotifyOptions) => send("warning", message, options),
  info: (message: string, options?: NotifyOptions) => send("info", message, options),
  dismiss: (id: number) => store.dismiss(id),
};

export function initializeNotifications(): void { render(); }
