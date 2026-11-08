// The Claude Code bridge's own piece of the page (services/background/nativeBridge.ts): a card that
// asks the user before an action that may send, delete or pay. It runs in the page on its own
// (chrome.scripting.executeScript), so it uses nothing outside itself, and it answers with the
// user's choice: true for Allow, false for Decline, no answer in time, or the card going away.

export function askInPage(state: {
  title: string;
  action: string;
  hint: string;
  allow: string;
  deny: string;
  timeoutMs: number;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('data-shizue-agent', '');
    Object.assign(host.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'none',
    });
    // Closed, so the page's scripts can't reach the buttons; and only a real click counts, so they
    // can't press them with an event of their own either.
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      /* The page's own !important rules can't hide or move the card: the shadow's win. */
      :host { display: block !important; opacity: 1 !important; visibility: visible !important; transform: none !important; filter: none !important; clip-path: none !important; }
      .card { position: fixed; top: 60px; left: 50%; transform: translateX(-50%); box-sizing: border-box; width: min(360px, calc(100vw - 32px)); padding: 14px 16px; border-radius: 14px; background: rgba(17, 17, 17, 0.94); color: #fff; font: 400 13px/1.45 system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; pointer-events: auto; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.3); border: 1px solid rgba(245, 177, 76, 0.7); }
      .title { font-weight: 600; font-size: 14px; }
      .action { margin-top: 6px; word-break: break-word; }
      .hint { margin-top: 4px; color: rgba(255, 255, 255, 0.65); font-size: 12px; }
      .buttons { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      button { all: unset; cursor: pointer; padding: 7px 14px; border-radius: 9999px; background: rgba(255, 255, 255, 0.12); font-weight: 600; }
      button.allow { background: #f5b14c; color: #111; }
      button:hover { filter: brightness(1.15); }
      button:focus-visible { outline: 2px solid #32ccbc; outline-offset: 2px; }
    `;
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('role', 'alertdialog');
    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = state.title;
    const action = document.createElement('div');
    action.className = 'action';
    action.textContent = state.action;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = state.hint;
    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const deny = document.createElement('button');
    deny.type = 'button';
    deny.textContent = state.deny;
    const allow = document.createElement('button');
    allow.type = 'button';
    allow.className = 'allow';
    allow.textContent = state.allow;
    buttons.append(deny, allow);
    card.append(title, action, hint, buttons);
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'keydown']) {
      card.addEventListener(type, (event) => event.stopPropagation());
    }
    shadow.append(style, card);
    document.documentElement.append(host);

    // Allow counts only once the card has been on screen a moment and nothing covers it, so a page
    // can't slip it under the user's click on something of its own. A browser without visibility
    // tracking leaves isVisible undefined.
    const shownAt = performance.now();
    let unobstructed = false;
    const watcher = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1] as IntersectionObserverEntry & { isVisible?: boolean };
        unobstructed = last.isVisible ?? last.isIntersecting;
      },
      { threshold: 1, trackVisibility: true, delay: 100 } as IntersectionObserverInit
    );
    watcher.observe(card);
    const finish = (answer: boolean) => {
      clearTimeout(timer);
      watcher.disconnect();
      host.remove();
      resolve(answer);
    };
    const timer = setTimeout(() => finish(false), state.timeoutMs);
    allow.addEventListener('click', (event) => {
      if (event.isTrusted && unobstructed && performance.now() - shownAt > 600) finish(true);
    });
    deny.addEventListener('click', (event) => {
      if (event.isTrusted) finish(false);
    });
  });
}
