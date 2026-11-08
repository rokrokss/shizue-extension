// The browser agent's pill (lib/browserAgentPage.ts showAgentOverlay) and the bridge's approval
// card (lib/bridgePage.ts askInPage) keep their clicks from the page, but a page listening for
// clicks on the window can stop them before they reach them, and then Stop, Allow and Decline do
// nothing. This listener is there before any of the page's scripts, so it hears each click first
// and hands theirs on to them. On a page with neither it only looks.
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  main(ctx) {
    ctx.addEventListener(
      window,
      'click',
      (event) => {
        const globals = globalThis as {
          __shizueAgentPillPress?: (event: MouseEvent) => boolean;
          __shizueBridgeCardPress?: (event: MouseEvent) => boolean;
        };
        if (globals.__shizueBridgeCardPress?.(event) || globals.__shizueAgentPillPress?.(event)) {
          event.stopImmediatePropagation();
        }
      },
      { capture: true }
    );
  },
});
