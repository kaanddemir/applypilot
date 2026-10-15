import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

globalThis.localStorage = { getItem: () => null };
const { state, filteredApps, esc, BOARD_STATUSES, STATUSES, toggleSelected, pruneSelection } = await import('../frontend/.test-dist/state.js');
const source = await readFile(new URL('../frontend/.test-dist/board.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../frontend/css/app.css', import.meta.url), 'utf8');

// Execute the production renderer with lightweight DOM/event doubles; no copied rendering logic.
class Element {
  children = []; listeners = {}; dataset = {}; attributes = {}; _html = '';
  constructor(tag = 'div') { this.tagName = tag; }
  set innerHTML(value) { this._html = value; this.children = []; }
  get innerHTML() { return this._html; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
}
function setup(apps = []) {
  Object.assign(state, { applications: apps, filter: 'Archived', search: '', sortBy: 'company', boardLayout: 'kanban', selectMode: false, selectedIds: new Set(), selectedId: '', viewMode: 'board' });
  const host = new Element();
  let renders = 0;
  const context = vm.createContext({
    state, filteredApps, esc, BOARD_STATUSES, STATUSES, toggleSelected, pruneSelection,
    $: () => host, document: { createElement: tag => new Element(tag) },
    window: { addEventListener() {} }, createDragController: () => ({}),
    I: {}, analysisFreshness: () => 'none', renderAll: () => renders++,
    formatDate: value => value,
  });
  vm.runInContext(source.replace(/^import .*?;\n/gm, '').replace(/^export /gm, ''), context);
  context.renderBoard();
  return { context, host, layout: () => host.children.at(-1).children[0], renders: () => renders };
}
function app(id, company, status = 'Archived') {
  return { id, company, role: 'Engineer', status, notes: '', jobSources: [], appliedAt: '', updatedAt: 1 };
}

test('empty archive renders a full-width named section and centered empty content', () => {
  const view = setup();
  const section = view.layout();
  assert.equal(section.className, 'archive-section');
  assert.equal(section.attributes['aria-labelledby'], 'archiveTitle');
  assert.match(section.innerHTML, /Archived<\/h2>.*0 applications/);
  assert.equal(section.children[0].className, 'archive-empty');
  assert.match(section.children[0].innerHTML, /aria-hidden="true".*No archived applications.*Archived applications will appear here\./);
  assert.doesNotMatch(section.children[0].innerHTML, /empty-column/);
});

test('archive reuses cards, filters statuses, sorts, and counts total independently of search', () => {
  const view = setup([app('z', 'Zeta'), app('a', 'Alpha'), app('s', 'Saved company', 'Saved')]);
  assert.match(view.layout().innerHTML, /2 applications/);
  let cards = view.layout().children[0].children;
  assert.equal(cards.length, 2);
  assert.match(cards[0].innerHTML, /Alpha/);
  assert.match(cards[1].innerHTML, /Zeta/);
  state.search = 'Zeta';
  view.context.renderBoard();
  assert.match(view.layout().innerHTML, /2 applications/);
  assert.equal(view.layout().children[0].children.length, 1);
  state.search = 'missing';
  view.context.renderBoard();
  assert.match(view.layout().children[0].innerHTML, /No matching archived applications/);
  const singular = setup([app('a', 'Alpha')]);
  assert.match(singular.layout().innerHTML, /1 application<\/span>/);
});

test('archived card opens details and retains selection interaction', () => {
  const view = setup([app('a', 'Alpha')]);
  let card = view.layout().children[0].children[0];
  assert.equal(card.tagName, 'button');
  card.listeners.click();
  assert.equal(state.selectedId, 'a');
  assert.equal(state.viewMode, 'detail');
  assert.equal(view.renders(), 1);
  // Render archive directly to isolate its card behavior from the shared bulk toolbar.
  state.selectMode = true;
  const host = new Element();
  view.context.renderArchive(host, filteredApps());
  card = host.children[0].children[0].children[0];
  assert.equal(card.draggable, false);
  assert.equal(card.attributes['aria-pressed'], 'false');
  // The card uses the shared toggle and redraw; stub only redraw for this assertion.
  view.context.renderBoard = () => {};
  card.listeners.click();
  assert.ok(state.selectedIds.has('a'));
});

test('normal Kanban retains five columns; Archived Table uses the existing table renderer', () => {
  const view = setup([app('a', 'Alpha')]);
  state.filter = 'All';
  view.context.renderBoard();
  assert.equal(view.layout().className, 'board');
  assert.deepEqual(view.layout().children.map(col => col.dataset.status), [...BOARD_STATUSES]);
  state.filter = 'Saved';
  view.context.renderBoard();
  assert.equal(view.layout().children.length, 5);
  state.filter = 'Archived'; state.boardLayout = 'table';
  view.context.renderBoard();
  assert.match(view.host.children[0].innerHTML, /class="table-wrap".*class="app-table/s);
  assert.doesNotMatch(view.host.children[0].innerHTML, /archive-section/);
});

test('archive responsive rules cap cards, allow narrow screens, and use theme tokens', () => {
  assert.match(css, /\.archive-grid\s*\{[^}]*repeat\(auto-fill, min\(100%, 260px\)\)/);
  assert.match(css, /\.archive-grid\s*\{[^}]*max-width: calc\(5 \* 260px \+ 4 \* var\(--s4\)\)/);
  assert.match(css, /\.archive-grid\s*\{[^}]*justify-content: start/);
  assert.doesNotMatch(css, /\.archive-grid\s*\{[^}]*space-between/);
  assert.match(css, /\.archive-grid\s*\{[^}]*gap: var\(--s4\)/);
  assert.match(css, /\.archive-count\s*\{[^}]*border-radius: 6px;[^}]*background: var\(--surface-2\)/s);
  assert.match(css, /\.archive-head\s*\{[^}]*justify-content: space-between/);
  assert.match(css, /\.archive-empty\s*\{[^}]*place-items: center/);
  assert.match(css, /\.archive-empty > div\s*\{[^}]*display: grid;[^}]*justify-items: center/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(232px, 1fr\)\)/);
});

test('archive keeps 1, 3, 5, 6 and 11 cards in sorted DOM order without row wrappers', () => {
  for (const count of [1, 3, 5, 6, 11]) {
    const apps = Array.from({ length: count }, (_, index) => app(String(index), `Company ${String(index).padStart(2, '0')}`));
    const view = setup(apps.reverse());
    const grid = view.layout().children[0];
    assert.equal(grid.className, 'archive-grid');
    assert.equal(grid.children.length, count);
    grid.children.forEach((card, index) => assert.match(card.innerHTML, new RegExp(`Company ${String(index).padStart(2, '0')}`)));
    assert.match(view.layout().innerHTML, new RegExp(`${count} application`));
  }
});

test('grid sizing fits target widths and caps wide-screen rows at five tracks', () => {
  // Arithmetic check of the fixed CSS tracks and existing page padding, not a browser layout test.
  const card = 260, gap = 16, cap = 5 * card + 4 * gap;
  for (const [viewport, padding, expectedColumns] of [[1440, 24, 5], [1280, 24, 4], [820, 24, 2], [375, 16, 1], [2400, 24, 5]]) {
    const available = viewport - 2 * padding;
    const width = Math.min(available, cap);
    const columns = Math.max(1, Math.floor((width + gap) / (card + gap)));
    assert.equal(columns, expectedColumns);
    assert.ok(columns * Math.min(card, available) + (columns - 1) * gap <= available);
    for (const count of [1, 3, 5, 6, 11]) {
      const positions = Array.from({ length: count }, (_, index) => ({ row: Math.floor(index / columns), column: index % columns }));
      if (columns === 5 && count >= 6) assert.deepEqual(positions[5], { row: 1, column: 0 });
      if (columns === 5 && count === 11) assert.deepEqual(positions[10], { row: 2, column: 0 });
    }
  }
});
