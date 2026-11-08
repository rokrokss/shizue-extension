// The browser agent's pill (lib/browserAgentPage.ts showAgentOverlay) keeps its clicks from the
// page, but a page listening for clicks on the window can stop them before they reach it, and then
// its Stop does nothing. This listener is there before any of the page's scripts, so it hears each
// click first and hands the pill's on to it. On a page with no pill it only looks.
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    ctx.addEventListener(
      window,
      'click',
      (event) => {
        const globals = globalThis as { __shizueAgentPillPress?: (event: MouseEvent) => boolean };
        if (globals.__shizueAgentPillPress?.(event)) event.stopImmediatePropagation();
      },
      { capture: true }
    );
  },
});
