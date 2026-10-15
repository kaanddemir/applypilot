import assert from "node:assert/strict";
import test from "node:test";

test("notification integration keeps browser timer receivers, renders, and dismisses", async () => {
  const originalSchedule = globalThis.setTimeout;
  const originalCancel = globalThis.clearTimeout;
  const timers = new Map();
  let nextTimer = 0;
  const children = [];
  const center = {
    querySelectorAll() { return children.slice(); },
    querySelector(selector) {
      const id = /data-notification-id="(\d+)"/.exec(selector)?.[1];
      return children.find((child) => child.dataset.notificationId === id) || null;
    },
    appendChild(child) {
      const index = children.indexOf(child);
      if (index >= 0) children.splice(index, 1);
      children.push(child);
    },
  };
  globalThis.document = {
    getElementById(id) { return id === "notificationCenter" ? center : null; },
    createElement() {
      const nodes = new Map();
      const toast = {
        dataset: {}, className: "", attributes: {},
        set innerHTML(_value) {
          for (const name of [".notification-icon", ".notification-message", ".notification-detail", ".notification-close"]) {
            nodes.set(name, { innerHTML: "", textContent: "", hidden: false, addEventListener(_type, callback) { this.click = callback; } });
          }
        },
        querySelector(selector) { return nodes.get(selector) || null; },
        setAttribute(name, value) { this.attributes[name] = value; },
        remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); },
      };
      return toast;
    },
  };
  globalThis.setTimeout = function (callback, delay) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    const id = ++nextTimer;
    timers.set(id, { callback, delay });
    return id;
  };
  globalThis.clearTimeout = function (id) {
    if (this !== globalThis) throw new TypeError("Illegal invocation");
    timers.delete(id);
  };

  try {
    const { notify } = await import("../frontend/.test-dist/notifications.js");
    const { statusFeedback, applicationSaveFeedback, deletionFeedback } = await import("../frontend/.test-dist/operation-notifications.js");
    statusFeedback(true, "Interview");
    applicationSaveFeedback(true, false);
    deletionFeedback(true, 1);
    notify.warning("Check the file.");
    await Promise.resolve();
    assert.deepEqual(children.map((toast) => toast.querySelector(".notification-message").textContent), [
      "Moved to Interview.", "Application added.", "Application deleted.", "Check the file.",
    ]);
    assert.deepEqual([...timers.values()].map((timer) => timer.delay), [5000, 4000, 4000, 7000]);

    const id = statusFeedback(false, "Offer");
    assert.equal(id, undefined);
    await Promise.resolve();
    assert.equal(children.some((toast) => toast.querySelector(".notification-message").textContent === "Changes could not be saved."), true);
    assert.equal(children.find((toast) => toast.querySelector(".notification-message").textContent === "Changes could not be saved.").attributes.role, "alert");

    const infoTimer = [...timers.values()].find((timer) => timer.delay === 5000);
    infoTimer.callback();
    await Promise.resolve();
    assert.equal(children.some((toast) => toast.querySelector(".notification-message").textContent === "Moved to Interview."), false);
    assert.equal(children.some((toast) => toast.querySelector(".notification-message").textContent === "Changes could not be saved."), true);
  } finally {
    globalThis.setTimeout = originalSchedule;
    globalThis.clearTimeout = originalCancel;
    delete globalThis.document;
  }
});
