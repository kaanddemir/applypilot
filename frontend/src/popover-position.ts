export type PopoverPlacement = {
  left: number;
  top: number;
  maxHeight: number;
  placement: "top" | "bottom";
};

// Geometry is kept DOM-free so the edge cases can be regression-tested.
export function calculatePopoverPosition(
  trigger: { left: number; right: number; top: number; bottom: number; width: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  align: "left" | "right" = "left",
  gap = 6,
  padding = 8,
): PopoverPlacement {
  const below = viewport.height - trigger.bottom - gap - padding;
  const above = trigger.top - gap - padding;
  const placement = below < Math.min(menu.height, 160) && above > below ? "top" : "bottom";
  const available = Math.max(80, placement === "bottom" ? below : above);
  const maxHeight = Math.min(menu.height, available);
  const top = placement === "bottom"
    ? trigger.bottom + gap
    : Math.max(padding, trigger.top - gap - maxHeight);
  const desiredLeft = align === "right" ? trigger.right - menu.width : trigger.left;
  const maxLeft = Math.max(padding, viewport.width - menu.width - padding);
  const left = Math.min(Math.max(padding, desiredLeft), maxLeft);
  return { left, top, maxHeight, placement };
}
