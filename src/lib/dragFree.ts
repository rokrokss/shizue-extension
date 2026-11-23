// Drag free (the toggle's button, services/background/messageHandlers.ts): lifts a page's blocks on
// selecting and dragging text, the context menu, and copy and paste, in every frame of the tab
// until it loads another page.

// User-origin CSS (chrome.scripting.insertCSS with origin 'USER') beats the page's own !important
// and adds nothing to the page's DOM or cascade layers. `auto` on every element follows the parent,
// so text becomes selectable again and form fields stay as they were.
export const DRAG_FREE_CSS =
  '*, *::before, *::after { -webkit-user-select: auto !important; user-select: auto !important; }';

// Injected into each frame's isolated world by chrome.scripting.executeScript, so it can use
// nothing from outside itself. Listeners that run first at the window's capture phase stop the
// page's own from running, and the browser's default action goes ahead. Shizue's own listeners for
// these events are on the window too, added at the page's load, so they still run before these.
export function setDragFreeInFrame(active: boolean) {
  const scope = globalThis as typeof globalThis & { __shizueDragFree?: AbortController };
  scope.__shizueDragFree?.abort();
  delete scope.__shizueDragFree;
  if (!active) return;
  const controller = new AbortController();
  scope.__shizueDragFree = controller;
  const options = { capture: true, signal: controller.signal };
  const stop = (event: Event) => event.stopImmediatePropagation();
  for (const type of ['contextmenu', 'selectstart', 'dragstart', 'copy', 'cut', 'paste']) {
    window.addEventListener(type, stop, options);
  }
  // Pages also cancel the copy, cut, paste and select-all keys themselves.
  window.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        // Autofill sends keydown events without a key.
        ['c', 'x', 'v', 'a'].includes((event.key ?? '').toLowerCase())
      ) {
        event.stopImmediatePropagation();
      }
    },
    options
  );
}
