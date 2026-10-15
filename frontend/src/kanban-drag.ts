// Kanban drag state, kept free of DOM queries so it can be tested directly.
// board.ts wires the native drag events to these calls.
"use strict";

interface ClassTarget { classList: { add(c: string): void; remove(c: string): void } }

export interface DragController {
  start(id: string, fromStatus: string): void;
  // Returns true when the column accepts the drop (the caller then calls
  // preventDefault). The source column and drags that did not start on a
  // card, such as files dragged in from the desktop, are refused.
  over(status: string, column: ClassTarget): boolean;
  leave(): void;
  drop(status: string): boolean;
  end(): void;
  readonly activeId: string;
}

export function createDragController(onMove: (id: string, status: string) => void): DragController {
  let id = "";
  let from = "";
  let target: ClassTarget | null = null;

  function highlight(next: ClassTarget | null) {
    if (next === target) return;
    target?.classList.remove("drop-target");
    next?.classList.add("drop-target");
    target = next;
  }

  return {
    get activeId() { return id; },
    start(nextId, fromStatus) { id = nextId; from = fromStatus; highlight(null); },
    over(status, column) {
      if (!id || status === from) { highlight(null); return false; }
      highlight(column);
      return true;
    },
    leave() { highlight(null); },
    drop(status) {
      const moved = !!id && status !== from;
      const movedId = id;
      this.end();
      if (moved) onMove(movedId, status);
      return moved;
    },
    end() { highlight(null); id = ""; from = ""; },
  };
}
