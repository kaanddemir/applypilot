export function createAutosave(
  update: (value: string) => void,
  persist: () => boolean,
  report: (saved: boolean, announceSuccess: boolean) => void,
  initialValue: string,
  delay = 350,
  schedule: typeof setTimeout = (...args) => globalThis.setTimeout(...args),
  cancel: typeof clearTimeout = (timer) => globalThis.clearTimeout(timer),
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let persistedValue = initialValue;

  function save(announceSuccess: boolean) {
    if (timer !== null) { cancel(timer); timer = null; }
    if (!pending) return;
    const saved = persist();
    // A failed timer save must remain eligible for a blur/navigation retry.
    pending = !saved;
    if (saved) persistedValue = currentValue;
    report(saved, announceSuccess);
  }

  let currentValue = initialValue;

  return {
    input(value: string) {
      currentValue = value;
      update(value);
      if (timer !== null) cancel(timer);
      timer = null;
      pending = value !== persistedValue;
      if (pending) timer = schedule(() => save(true), delay);
    },
    flush: () => save(true),
    flushSilently: () => save(false),
  };
}
