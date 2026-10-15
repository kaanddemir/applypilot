// Shared popover menus (board overflow, profile actions, theme). One set of
// document listeners serves every menu, so re-rendering a page never stacks
// duplicate outside-click handlers.
import { calculatePopoverPosition } from "./popover-position.js";

const OPEN_SELECTOR = ".data-menu.open, .status-select-menu.open, .select-popover.open";

function triggerFor(menu: Element): HTMLElement | null {
  return menu.id ? document.querySelector<HTMLElement>('[aria-controls="' + menu.id + '"]') : null;
}

function menuItems(menu: Element): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [role="option"]'));
}

export function positionMenu(trigger: HTMLElement, menu: HTMLElement): void {
  const ownTriggerRect = trigger.getBoundingClientRect();
  const spanFrom = menu.dataset.spanFrom ? document.getElementById(menu.dataset.spanFrom) : null;
  const spanRect = spanFrom?.getBoundingClientRect();
  const triggerRect = spanRect ? {
    left: spanRect.left,
    right: ownTriggerRect.right,
    top: ownTriggerRect.top,
    bottom: ownTriggerRect.bottom,
    width: ownTriggerRect.right - spanRect.left,
  } : ownTriggerRect;
  if (spanRect) menu.style.width = triggerRect.width + "px";
  if (menu.classList.contains("select-popover")) menu.style.width = triggerRect.width + "px";
  const menuRect = menu.getBoundingClientRect();
  const align = menu.dataset.align === "right" ? "right" : "left";
  const position = calculatePopoverPosition(triggerRect, menuRect, { width: window.innerWidth, height: window.innerHeight }, align);
  menu.style.left = position.left + "px";
  menu.style.top = position.top + "px";
  menu.style.maxHeight = position.maxHeight + "px";
  menu.dataset.placement = position.placement;
}

export function closeMenus(returnFocus = false): boolean {
  const open = Array.from(document.querySelectorAll(OPEN_SELECTOR));
  open.forEach((menu) => {
    menu.classList.remove("open");
    const trigger = triggerFor(menu);
    trigger?.setAttribute("aria-expanded", "false");
    if (returnFocus && menu.contains(document.activeElement)) trigger?.focus();
  });
  return open.length > 0;
}

export function bindMenu(trigger: HTMLElement | null, menu: HTMLElement | null): void {
  if (!trigger || !menu) return;
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-controls", menu.id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = !menu.classList.contains("open");
    closeMenus();
    if (!opening) return;
    menu.classList.add("open");
    trigger.setAttribute("aria-expanded", "true");
    positionMenu(trigger, menu);
    // Keyboard users land on the first item; pointer users keep focus on the trigger.
    if ((event as MouseEvent).detail === 0) menuItems(menu)[0]?.focus();
  });
  menu.addEventListener("click", (event) => event.stopPropagation());
}

document.addEventListener("click", () => closeMenus());

// Fixed positioning escapes modal/scroll-panel clipping; keep it anchored as
// any scroll container or the viewport moves.
window.addEventListener("resize", () => {
  document.querySelectorAll<HTMLElement>(OPEN_SELECTOR).forEach((menu) => {
    const trigger = triggerFor(menu);
    if (trigger) positionMenu(trigger, menu);
  });
});
document.addEventListener("scroll", () => {
  document.querySelectorAll<HTMLElement>(OPEN_SELECTOR).forEach((menu) => {
    const trigger = triggerFor(menu);
    if (trigger) positionMenu(trigger, menu);
  });
}, true);

// Arrow keys move between items of whichever menu holds focus.
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    // Continue native Tab navigation from a visible control, not a now-hidden
    // menu item whose position differs between browsers.
    closeMenus(true);
    return;
  }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const menu = (document.activeElement as HTMLElement | null)?.closest(OPEN_SELECTOR);
  if (!menu) return;
  const items = menuItems(menu);
  const index = items.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  event.preventDefault();
  items[(index + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length].focus();
});
