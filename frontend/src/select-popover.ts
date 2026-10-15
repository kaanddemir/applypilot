import { bindMenu, closeMenus } from "./menu.js";

export type SelectOption = { value: string; label: string };

export function selectPopoverMarkup(id: string, label: string, options: SelectOption[], value: string): string {
  const selected = options.find((option) => option.value === value) || options[0];
  return '<div class="select-popover-wrap">' +
    '<button class="select select-popover-trigger" id="' + id + '" type="button" aria-label="' + label + '">' +
      '<span>' + selected.label + '</span>' +
    '</button>' +
    '<div class="select-popover" id="' + id + 'Listbox" role="listbox" aria-label="' + label + '">' +
      options.map((option) => '<button type="button" role="option" data-value="' + option.value + '" aria-selected="' + (option.value === selected.value) + '">' + option.label + '</button>').join("") +
    '</div></div>';
}

export function bindSelectPopover(
  trigger: HTMLElement | null,
  listbox: HTMLElement | null,
  onChange: (value: string) => void,
): void {
  if (!trigger || !listbox) return;
  bindMenu(trigger, listbox);
  trigger.setAttribute("aria-haspopup", "listbox");
  const options = () => Array.from(listbox.querySelectorAll<HTMLElement>('[role="option"]'));
  const selectedIndex = () => Math.max(0, options().findIndex((option) => option.getAttribute("aria-selected") === "true"));
  let typeahead = "";
  let typeaheadTimer = 0;
  const choose = (option: HTMLElement) => {
    options().forEach((item) => item.setAttribute("aria-selected", String(item === option)));
    const label = option.textContent || "";
    const display = trigger.querySelector("span");
    if (display) display.textContent = label;
    closeMenus();
    trigger.focus();
    onChange(option.dataset.value || "");
  };
  listbox.addEventListener("click", (event) => {
    const option = (event.target as Element).closest<HTMLElement>('[role="option"]');
    if (option) choose(option);
  });
  trigger.addEventListener("keydown", (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End", "Enter", " "].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (!listbox.classList.contains("open")) trigger.click();
    const items = options();
    const target = event.key === "Home" ? items[0]
      : event.key === "End" || event.key === "ArrowUp" ? items.at(-1) : items[selectedIndex()];
    target?.focus();
  });
  listbox.addEventListener("keydown", (event) => {
    const items = options();
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(items[current]);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    }
  });
  const handleTypeahead = (event: KeyboardEvent) => {
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.key === " ") return;
    window.clearTimeout(typeaheadTimer);
    typeahead += event.key.toLocaleLowerCase();
    typeaheadTimer = window.setTimeout(() => { typeahead = ""; }, 600);
    const match = options().find((option) => (option.textContent || "").trim().toLocaleLowerCase().startsWith(typeahead));
    if (!match) return;
    event.preventDefault();
    if (listbox.classList.contains("open")) match.focus();
    else choose(match);
  };
  trigger.addEventListener("keydown", handleTypeahead);
  listbox.addEventListener("keydown", handleTypeahead);
}
