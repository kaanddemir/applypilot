export type NotificationTone = "success" | "error" | "warning" | "info";

export type NotificationItem = {
  id: number;
  tone: NotificationTone;
  message: string;
  detail?: string;
  key?: string;
  persistent: boolean;
  duration: number;
};

export type NotificationInput = Omit<NotificationItem, "id" | "persistent" | "duration"> & {
  persistent?: boolean;
  duration?: number;
};

export const NOTIFICATION_DURATIONS: Record<NotificationTone, number> = {
  success: 4_000,
  info: 5_000,
  warning: 7_000,
  error: 0,
};

export class NotificationStore {
  readonly visible: NotificationItem[] = [];
  readonly queued: NotificationItem[] = [];
  private nextId = 1;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();
  private listeners = new Set<() => void>();

  constructor(
    readonly visibleLimit = 4,
    private schedule: typeof setTimeout = (...args) => globalThis.setTimeout(...args),
    private cancel: typeof clearTimeout = (timer) => globalThis.clearTimeout(timer),
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  add(input: NotificationInput): number {
    const existing = [...this.visible, ...this.queued].find((item) =>
      input.key ? item.key === input.key : item.tone === input.tone && item.message === input.message && item.detail === input.detail
    );
    if (existing) {
      existing.tone = input.tone;
      existing.message = input.message;
      existing.detail = input.detail;
      existing.persistent = input.persistent ?? input.tone === "error";
      existing.duration = input.duration ?? NOTIFICATION_DURATIONS[input.tone];
      if (this.visible.includes(existing)) this.startTimer(existing);
      else if (existing.persistent) {
        let replaceIndex = -1;
        for (let index = this.visible.length - 1; index >= 0; index -= 1) {
          if (!this.visible[index].persistent) { replaceIndex = index; break; }
        }
        if (replaceIndex >= 0) {
          this.queued.splice(this.queued.indexOf(existing), 1);
          const [displaced] = this.visible.splice(replaceIndex, 1);
          this.stopTimer(displaced.id);
          this.queued.unshift(displaced);
          this.activate(existing);
        }
      }
      this.emit();
      return existing.id;
    }
    const item: NotificationItem = {
      id: this.nextId++,
      tone: input.tone,
      message: input.message,
      detail: input.detail,
      key: input.key,
      persistent: input.persistent ?? input.tone === "error",
      duration: input.duration ?? NOTIFICATION_DURATIONS[input.tone],
    };
    if (this.visible.length < this.visibleLimit) this.activate(item);
    else if (item.persistent) {
      let replaceIndex = -1;
      for (let index = this.visible.length - 1; index >= 0; index -= 1) {
        if (!this.visible[index].persistent) { replaceIndex = index; break; }
      }
      if (replaceIndex >= 0) {
        const [displaced] = this.visible.splice(replaceIndex, 1);
        this.stopTimer(displaced.id);
        this.queued.unshift(displaced);
        this.activate(item);
      } else this.queued.push(item);
    } else this.queued.push(item);
    this.emit();
    return item.id;
  }

  dismiss(id: number): boolean {
    const visibleIndex = this.visible.findIndex((item) => item.id === id);
    if (visibleIndex >= 0) {
      this.visible.splice(visibleIndex, 1);
      this.stopTimer(id);
      const next = this.queued.shift();
      if (next) this.activate(next);
      this.emit();
      return true;
    }
    const queuedIndex = this.queued.findIndex((item) => item.id === id);
    if (queuedIndex < 0) return false;
    this.queued.splice(queuedIndex, 1);
    this.emit();
    return true;
  }

  clear(): void {
    this.timers.forEach((timer) => this.cancel(timer));
    this.timers.clear();
    this.visible.length = 0;
    this.queued.length = 0;
    this.emit();
  }

  private activate(item: NotificationItem): void {
    this.startTimer(item);
    this.visible.push(item);
  }

  private startTimer(item: NotificationItem): void {
    this.stopTimer(item.id);
    if (item.persistent || item.duration <= 0) return;
    this.timers.set(item.id, this.schedule(() => this.dismiss(item.id), item.duration));
  }

  private stopTimer(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) this.cancel(timer);
    this.timers.delete(id);
  }

  private emit(): void { this.listeners.forEach((listener) => listener()); }
}
