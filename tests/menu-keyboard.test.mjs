import assert from "node:assert/strict";
import test from "node:test";

const documentListeners = new Map();
let current;
globalThis.document = {
  activeElement: null,
  addEventListener(type, listener) { const handlers = documentListeners.get(type) ?? []; handlers.push(listener); documentListeners.set(type, handlers); },
  querySelectorAll() { return current?.menu.classList.contains("open") ? [current.menu] : []; },
  querySelector() { return current?.trigger ?? null; },
  getElementById() { return null; },
};
globalThis.window = { addEventListener() {}, innerWidth: 820, innerHeight: 700, setTimeout, clearTimeout };
const { bindSelectPopover } = await import("../frontend/.test-dist/select-popover.js");

function control(className = "") {
  const classes = new Set(className.split(" "));
  const attributes = new Map();
  const handlers = new Map();
  return {
    dataset: {}, style: {},
    classList: { contains: (name) => classes.has(name), add: (name) => classes.add(name), remove: (name) => classes.delete(name) },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name) ?? null,
    addEventListener(type, handler) { const list = handlers.get(type) ?? []; list.push(handler); handlers.set(type, list); },
    dispatch(type, event) { for (const handler of handlers.get(type) ?? []) handler(event); },
    focus() { document.activeElement = this; },
    getBoundingClientRect() { return { left: 20, right: 220, top: 40, bottom: 80, width: 200, height: 150 }; },
    click() { this.dispatch("click", { detail: 0, stopPropagation() {} }); },
  };
}

function fixture() {
  const trigger = control();
  const menu = control("select-popover");
  menu.id = "test-options";
  const items = ["First", "Selected", "Last"].map((label, index) => {
    const item = control();
    item.textContent = label;
    item.dataset.value = label;
    item.setAttribute("aria-selected", String(index === 1));
    item.closest = () => menu;
    return item;
  });
  menu.querySelectorAll = () => items;
  menu.contains = (element) => items.includes(element);
  trigger.querySelector = () => ({ textContent: "Selected" });
  current = { trigger, menu, items };
  bindSelectPopover(trigger, menu, () => {});
  trigger.focus();
  return current;
}

function key(target, value, shiftKey = false) {
  const event = { key: value, shiftKey, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  target.dispatch("keydown", event);
  if (!event.propagationStopped) {
    for (const handler of documentListeners.get("keydown") ?? []) handler(event);
  }
  return event;
}

test("Home and End open a dropdown at its first and last options", () => {
  const { trigger, items, menu } = fixture();
  key(trigger, "Home");
  assert.equal(menu.classList.contains("open"), true);
  assert.equal(document.activeElement, items[0]);
  key(items[0], "Tab");
  key(trigger, "End");
  assert.equal(document.activeElement, items[2]);
});

test("opening with ArrowDown does not also advance through the document arrow handler", () => {
  const { trigger, items } = fixture();
  key(trigger, "ArrowDown");
  assert.equal(document.activeElement, items[1], "open at the selected option");
  key(items[1], "ArrowDown");
  assert.equal(document.activeElement, items[2], "subsequent arrow presses move once");
});

test("Tab and Shift+Tab restore the trigger before closing the focused menu", () => {
  for (const reverse of [false, true]) {
    const { trigger, menu, items } = fixture();
    trigger.click();
    items[1].focus();
    const event = key(items[1], "Tab", reverse);
    assert.equal(menu.classList.contains("open"), false);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, trigger);
    assert.notEqual(event.defaultPrevented, true, "native Tab navigation can continue from the trigger");
  }
});
