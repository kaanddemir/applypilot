// The application renders controls dynamically from trusted templates. These
// shared control members keep delegated/query-selected handlers type-safe.
interface Element {
  readonly dataset: DOMStringMap;
  value: string;
  checked: boolean;
  disabled: boolean;
  focus(options?: FocusOptions): void;
}

interface EventTarget {
  value: string;
  checked: boolean;
  files: FileList | null;
}
