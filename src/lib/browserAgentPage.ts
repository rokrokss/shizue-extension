import type { AgentAction, AgentStepError, PageElement, PageSnapshot, WebMcpTool } from '@/lib/browserAgent';

// What the browser agent (lib/browserAgent.ts) runs in its tab, each function injected on its own
// with chrome.scripting.executeScript, so none uses anything outside itself. They share the
// page's elements through a global of the extension's isolated world, which lasts until the
// page is left: a snapshot numbers them, and an action finds its element by that number. The
// snapshot runs in each of the page's frames too, and an action in the frame its element is in.
// The WebMCP functions alone run in the page's own world, where its tools are registered.

type AgentGlobals = {
  __shizueAgentRefs?: Map<number, Element>;
  __shizueAgentOverlay?: {
    host: HTMLElement;
    dot: HTMLElement;
    label: HTMLElement;
    button: HTMLElement;
    resume: HTMLElement;
  };
  __shizueAgentRing?: (element: Element | null) => void;
  // A click on the pill, from the listener that hears it before the page can stop it
  // (entrypoints/agent-pill.content.ts); true when it pressed one of the pill's buttons.
  __shizueAgentPillPress?: (event: MouseEvent) => boolean;
  __shizueAgentMarks?: HTMLElement;
  __shizueAgentWatch?: { changedAt: number | null; acted?: Element; busyBefore: Set<Element>; stop: () => void };
  // What the user clicked when asked to point (pickElement), whether the agent was told so, and
  // how a pick waiting now ends.
  __shizueAgentPicked?: Element;
  __shizueAgentPickedTold?: boolean;
  __shizueAgentPickEnd?: (picked: boolean) => void;
};

// When this frame's page last changed, and whether it shows it is still working. Only text coming
// and going outside the element acted on counts: attributes, a button's own label and ripple and
// injected styles are how a page reacts before its answer comes. `begin`, before an action, starts
// over. A call that finds no watch is on a new document, which has just changed. A watch ends by
// itself, so it doesn't stay after the run.
// A spinner on screen before the action isn't its answer on the way, and often isn't a spinner: a
// class named "loading" stays on many a page.
export function pageActivity(begin: boolean): { changedAt: number | null; busy: boolean; newDocument: boolean } {
  const globals = globalThis as unknown as AgentGlobals;
  const spinners = () =>
    [
      ...document.querySelectorAll(
        '[aria-busy="true"], [role="progressbar"], [class*="spinner" i], [class*="skeleton" i], [class*="loading" i]'
      ),
    ].filter((element) => element.checkVisibility?.({ opacityProperty: true, visibilityProperty: true }) ?? true);
  const newDocument = !globals.__shizueAgentWatch;
  if (begin || newDocument) {
    globals.__shizueAgentWatch?.stop();
    const bringsText = (node: Node) =>
      node.nodeName !== 'SCRIPT' && node.nodeName !== 'STYLE' && Boolean(node.textContent?.trim());
    const observer = new MutationObserver((records) => {
      const changed = records.some(
        (record) =>
          !watch.acted?.contains(record.target) &&
          (record.type === 'characterData' || [...record.addedNodes, ...record.removedNodes].some(bringsText))
      );
      if (changed) watch.changedAt = Date.now();
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true });
    const timer = setTimeout(() => watch.stop(), 15_000);
    const watch: NonNullable<AgentGlobals['__shizueAgentWatch']> = {
      changedAt: begin ? null : Date.now(),
      busyBefore: new Set(begin ? spinners() : []),
      stop: () => {
        clearTimeout(timer);
        observer.disconnect();
        globals.__shizueAgentWatch = undefined;
      },
    };
    globals.__shizueAgentWatch = watch;
  }
  const { changedAt, busyBefore } = globals.__shizueAgentWatch!;
  return { changedAt, busy: spinners().some((element) => !busyBefore.has(element)), newDocument };
}

// The page as the agent reads it: the text on screen, and the controls on screen and a little
// below, numbered. Inputs give their value, except passwords and card fields.
export function snapshotPage(maxText: number): PageSnapshot {
  const globals = globalThis as unknown as AgentGlobals;
  const refs = new Map<number, Element>();
  globals.__shizueAgentRefs = refs;
  const viewport = window.innerHeight;
  const width = window.innerWidth;
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const SELECTOR = [
    'a[href]',
    'button',
    'input:not([type=hidden])',
    'textarea',
    'select',
    'summary',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[onclick]',
    ...[
      'button',
      'link',
      'checkbox',
      'radio',
      'tab',
      'menuitem',
      'menuitemcheckbox',
      'menuitemradio',
      'option',
      'switch',
      'combobox',
      'textbox',
      'searchbox',
      'slider',
    ].map((role) => `[role="${role}"]`),
  ].join(',');
  const SKIP_TEXT = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG']);
  // Shizue's own buttons and menus on the page.
  const ours = (element: Element) => /^shizue/i.test(element.tagName) || /^shizue/i.test(element.id);

  const visible = (element: Element) => {
    const checkVisibility = (element as HTMLElement).checkVisibility;
    return checkVisibility ? checkVisibility.call(element, { opacityProperty: true, visibilityProperty: true }) : true;
  };

  const nameOf = (element: Element): string => {
    const aria = clean(element.getAttribute('aria-label'));
    if (aria) return aria;
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const root = element.getRootNode() as Document | ShadowRoot;
      const text = clean(labelledBy.split(/\s+/).map((id) => root.getElementById?.(id)?.textContent ?? '').join(' '));
      if (text) return text;
    }
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
      // A label that wraps its control has the control's own text in it too: a dropdown's choices.
      const wrapping = element.labels?.[0];
      let label = clean(wrapping?.innerText);
      if (wrapping?.contains(element)) {
        const copy = wrapping.cloneNode(true) as HTMLElement;
        copy.querySelectorAll('select, textarea').forEach((control) => control.remove());
        label = clean(copy.textContent);
      }
      if (label) return label;
      if (element instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(element.type)) return clean(element.value);
      if (!(element instanceof HTMLSelectElement) && element.placeholder) return clean(element.placeholder);
    }
    const text = clean((element as HTMLElement).innerText);
    if (text) return text.slice(0, 160);
    const title = clean(element.getAttribute('title'));
    if (title) return title;
    const image = element.querySelector('img[alt]');
    if (image) return clean(image.getAttribute('alt'));
    const svgTitle = element.querySelector('svg title');
    if (svgTitle) return clean(svgTitle.textContent);
    return clean(element.getAttribute('name') ?? element.getAttribute('data-testid'));
  };

  const isSecret = (element: Element) => {
    if (!(element instanceof HTMLInputElement)) return false;
    const autocomplete = element.autocomplete.toLowerCase();
    const id = `${element.name} ${element.id}`.toLowerCase();
    return (
      element.type === 'password' ||
      /(^|\s)(cc-|one-time-code|current-password|new-password)/.test(autocomplete) ||
      /card.?num|cvc|cvv|ccnum|security.?code|ssn|주민/.test(id)
    );
  };

  const isSearch = (element: Element) => {
    const role = element.getAttribute('role');
    if ((element instanceof HTMLInputElement && element.type === 'search') || role === 'searchbox') return true;
    const hints = ['name', 'id', 'placeholder', 'aria-label', 'title'].map((name) => element.getAttribute(name) ?? '').join(' ');
    return (
      element.closest('form[role="search"], [role="search"]') !== null ||
      element.getAttribute('name') === 'q' ||
      /search|query|검색|検索|搜索|搜尋|buscar|recherche|suche|cerca|поиск/i.test(hints)
    );
  };

  const hrefOf = (element: Element) => {
    if (!(element instanceof HTMLAnchorElement) || !element.href) return undefined;
    try {
      const url = new URL(element.href);
      if (url.protocol === 'javascript:') return undefined;
      return url.origin === location.origin ? `${url.pathname}${url.search}` : url.href;
    } catch {
      return undefined;
    }
  };

  const onScreen: PageElement[] = [];
  const below: PageElement[] = [];
  const seen = new Set<Element>();
  let next = 1;
  const consider = (element: Element) => {
    if (seen.has(element)) return;
    seen.add(element);
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1 || rect.right < 0 || rect.left > width) return;
    if (rect.bottom < 0 || rect.top > viewport * 3) return;
    if (!visible(element)) return;
    const tag = element.tagName.toLowerCase();
    const secret = isSecret(element);
    const found: PageElement = { ref: next, tag, name: nameOf(element) };
    const role = element.getAttribute('role');
    if (role) found.role = role;
    if (element instanceof HTMLInputElement) {
      found.type = element.type;
      if (element.type === 'checkbox' || element.type === 'radio') found.checked = element.checked;
      else if (!secret && element.value) found.value = element.value.slice(0, 200);
    } else if (element instanceof HTMLTextAreaElement) {
      if (element.value) found.value = element.value.slice(0, 200);
    } else if (element instanceof HTMLSelectElement) {
      found.value = clean(element.selectedOptions[0]?.text);
      found.options = Array.from(element.options, (option) => clean(option.text)).filter(Boolean).slice(0, 25);
    }
    const ariaChecked = element.getAttribute('aria-checked') ?? element.getAttribute('aria-pressed');
    if (found.checked === undefined && (ariaChecked === 'true' || ariaChecked === 'false')) found.checked = ariaChecked === 'true';
    if ((element as HTMLButtonElement).disabled || element.getAttribute('aria-disabled') === 'true') found.disabled = true;
    if (secret) found.secret = true;
    if ((tag === 'input' || tag === 'textarea' || role === 'searchbox' || role === 'combobox') && isSearch(element)) found.search = true;
    const href = hrefOf(element);
    if (href) found.href = href;
    if (rect.top >= viewport) found.below = true;
    refs.set(next, element);
    next++;
    (found.below ? below : onScreen).push(found);
  };

  const visit = (root: Document | ShadowRoot) => {
    root.querySelectorAll(SELECTOR).forEach(consider);
    root.querySelectorAll('*').forEach((element) => {
      if (element.shadowRoot && !ours(element)) visit(element.shadowRoot);
    });
  };
  visit(document);
  // What the user pointed at: the control it is part of, or itself when it is in none.
  const picked = globals.__shizueAgentPicked;
  if (picked?.isConnected) {
    const numbered = new Map([...refs].map(([ref, element]) => [element, ref]));
    let control: Element | null = picked;
    for (let up = 0; control && !numbered.has(control) && up < 6; up++) control = control.parentElement;
    if (!control || !numbered.has(control)) {
      consider(picked);
      control = picked;
    }
    const ref = [...refs].find(([, element]) => element === control)?.[0];
    const found = [...onScreen, ...below].find((candidate) => candidate.ref === ref);
    // Told once, in the page read right after the user's turn; it keeps its number after that.
    if (found && !globals.__shizueAgentPickedTold) found.picked = true;
    globals.__shizueAgentPickedTold = true;
  }

  // The text on screen, a line for each element it is in.
  const parts: string[] = [];
  let total = 0;
  let lastParent: Element | null = null;
  const shown = new Map<Element, boolean>();
  const isShown = (element: Element) => {
    let value = shown.get(element);
    if (value === undefined) {
      const rect = element.getBoundingClientRect();
      value =
        rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < viewport && rect.right > 0 && rect.left < width && visible(element);
      shown.set(element, value);
    }
    return value;
  };
  const walk = (root: Node) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (SKIP_TEXT.has((node as Element).tagName.toUpperCase()) || ours(node as Element))
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT,
    });
    for (let node = walker.nextNode(); node && total < maxText; node = walker.nextNode()) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const shadow = (node as Element).shadowRoot;
        if (shadow) walk(shadow);
        continue;
      }
      const text = clean(node.textContent);
      const parent = node.parentElement;
      if (!text || !parent || !isShown(parent)) continue;
      parts.push(parts.length === 0 ? text : parent === lastParent ? ` ${text}` : `\n${text}`);
      lastParent = parent;
      total += text.length + 1;
    }
  };
  if (document.body) walk(document.body);

  const scroller = document.scrollingElement ?? document.documentElement;
  return {
    url: location.href,
    title: document.title,
    text: parts.join('').slice(0, maxText),
    elements: [...onScreen, ...below],
    scroll: { y: Math.round(scroller.scrollTop), height: Math.round(scroller.scrollHeight), viewport },
  };
}

// One action on an element of the last snapshot, shown with a ring around it first. `files`:
// upload's image, as a data URL.
export async function performAction(
  action: AgentAction,
  files?: { name: string; dataUrl: string }[]
): Promise<{ ok: boolean; error?: AgentStepError }> {
  const globals = globalThis as unknown as AgentGlobals;
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  const instant = 'instant' as ScrollBehavior;
  const scrollsItself = (box: Element) =>
    box.scrollHeight > box.clientHeight + 4 && /(auto|scroll|overlay)/.test(getComputedStyle(box).overflowY);

  if (action.kind === 'scroll') {
    const amount = Math.round(window.innerHeight * 0.8) * (action.direction === 'up' ? -1 : 1);
    if (action.ref !== undefined) {
      // A list or box of its own: the element, or the box it scrolls in.
      let box: Element | null = globals.__shizueAgentRefs?.get(action.ref) ?? null;
      if (!box?.isConnected) return { ok: false, error: 'not_found' };
      while (box && !scrollsItself(box)) box = box.parentElement;
      if (box) {
        const height = Math.round(Math.min(box.clientHeight, window.innerHeight) * 0.8);
        box.scrollBy({ top: action.direction === 'up' ? -height : height, behavior: instant });
        return { ok: true };
      }
    }
    const scroller = document.scrollingElement ?? document.documentElement;
    const before = scroller.scrollTop;
    window.scrollBy({ top: amount, behavior: instant });
    if (Math.abs(scroller.scrollTop - before) < 2) {
      // The page scrolls in a box of its own: the one under the middle of the screen.
      let box = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
      while (box && !scrollsItself(box)) box = box.parentElement;
      box?.scrollBy({ top: amount, behavior: instant });
    }
    return { ok: true };
  }

  // A key with nothing named presses on what has focus, as a person's would.
  if (action.kind === 'press' && action.ref === undefined) {
    const target = (document.activeElement ?? document.body ?? document.documentElement) as HTMLElement;
    if (globals.__shizueAgentWatch) Object.assign(globals.__shizueAgentWatch, { changedAt: null, acted: undefined });
    const key = action.key ?? '';
    const init = { key, code: key === ' ' ? 'Space' : key, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    return { ok: true };
  }

  const element = action.ref !== undefined ? globals.__shizueAgentRefs?.get(action.ref) : undefined;
  if (!element || !element.isConnected) return { ok: false, error: 'not_found' };
  const html = element as HTMLElement;
  html.scrollIntoView?.({ block: 'center', inline: 'nearest', behavior: instant });
  globals.__shizueAgentRing?.(element);
  await sleep(150);
  // What the page does from here on is its answer.
  if (globals.__shizueAgentWatch) Object.assign(globals.__shizueAgentWatch, { changedAt: null, acted: element });

  if (action.kind === 'click') {
    const rect = element.getBoundingClientRect();
    const at = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
    };
    const pointer = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    element.dispatchEvent(new PointerEvent('pointerover', pointer));
    element.dispatchEvent(new MouseEvent('mouseover', at));
    element.dispatchEvent(new PointerEvent('pointerdown', pointer));
    element.dispatchEvent(new MouseEvent('mousedown', at));
    html.focus?.({ preventScroll: true });
    element.dispatchEvent(new PointerEvent('pointerup', pointer));
    element.dispatchEvent(new MouseEvent('mouseup', at));
    html.click();
    return { ok: true };
  }

  if (action.kind === 'type') {
    if (element instanceof HTMLInputElement) {
      const autocomplete = element.autocomplete.toLowerCase();
      if (element.type === 'password' || /(^|\s)(cc-|one-time-code|current-password|new-password)/.test(autocomplete)) {
        return { ok: false, error: 'secret_field' };
      }
    }
    const text = action.text ?? '';
    html.focus?.({ preventScroll: true });
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      // The prototype's setter, so a framework's own value tracking sees the change.
      const prototype = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, text);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (html.isContentEditable) {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges();
      selection?.addRange(range);
      // Editors follow the input events this sends; setting the text would bypass them.
      if (!document.execCommand('insertText', false, text)) html.textContent = text;
    } else {
      return { ok: false, error: 'failed' };
    }
    if (action.submit) {
      const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      const handled = !element.dispatchEvent(new KeyboardEvent('keydown', key as KeyboardEventInit));
      element.dispatchEvent(new KeyboardEvent('keypress', key as KeyboardEventInit));
      element.dispatchEvent(new KeyboardEvent('keyup', key as KeyboardEventInit));
      // An Enter the page doesn't take submits the field's form, as a real one would.
      if (!handled && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
    }
    return { ok: true };
  }

  if (action.kind === 'hover') {
    // Pointer events only: a menu its script opens shows, while one made with CSS :hover may not.
    const rect = element.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, composed: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    const pointer = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true };
    element.dispatchEvent(new PointerEvent('pointerover', pointer));
    element.dispatchEvent(new PointerEvent('pointerenter', { ...pointer, bubbles: false }));
    element.dispatchEvent(new MouseEvent('mouseover', at));
    element.dispatchEvent(new MouseEvent('mouseenter', { ...at, bubbles: false }));
    element.dispatchEvent(new PointerEvent('pointermove', pointer));
    element.dispatchEvent(new MouseEvent('mousemove', at));
    return { ok: true };
  }

  if (action.kind === 'press') {
    html.focus?.({ preventScroll: true });
    const key = action.key ?? '';
    const init = {
      key,
      code: key === ' ' ? 'Space' : key,
      keyCode: { Enter: 13, Escape: 27, Tab: 9, ' ': 32 }[key] ?? 0,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    const handled = !element.dispatchEvent(new KeyboardEvent('keydown', init as KeyboardEventInit));
    element.dispatchEvent(new KeyboardEvent('keyup', init as KeyboardEventInit));
    // What a real key does when the page leaves it be: Enter submits a field's form and presses a
    // button or link, as the space bar does a button.
    if (!handled && key === 'Enter') {
      if (element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
      else if (element instanceof HTMLButtonElement || element instanceof HTMLAnchorElement) html.click();
    } else if (!handled && key === ' ' && element instanceof HTMLButtonElement) {
      html.click();
    }
    return { ok: true };
  }

  if (action.kind === 'upload') {
    if (!files?.length) return { ok: false, error: 'no_file' };
    const toFile = ({ name, dataUrl }: { name: string; dataUrl: string }) => {
      const [head, data = ''] = dataUrl.split(',');
      const type = head.match(/^data:([^;]+)/)?.[1] ?? 'application/octet-stream';
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], name, { type });
    };
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(toFile(file));
    // The file field itself, the one its label is for or holds, or the only one on the page; a
    // site's own upload box is often a styled button over a hidden field.
    const fileInput = (candidate: Element | null | undefined) =>
      candidate instanceof HTMLInputElement && candidate.type === 'file' ? candidate : null;
    const allFields = [...document.querySelectorAll('input[type=file]')];
    const field =
      fileInput(element) ??
      fileInput(element instanceof HTMLLabelElement ? element.control : null) ??
      fileInput(element.querySelector('input[type=file]')) ??
      fileInput(element.closest('label')?.querySelector('input[type=file]')) ??
      fileInput(element.parentElement?.querySelector('input[type=file]')) ??
      (allFields.length === 1 ? fileInput(allFields[0]) : null);
    if (field) {
      field.files = transfer.files;
      field.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true };
    }
    // A drop zone takes the files as dropped ones.
    for (const type of ['dragenter', 'dragover', 'drop']) {
      element.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: transfer }));
    }
    return { ok: true };
  }

  if (action.kind === 'select') {
    if (!(element instanceof HTMLSelectElement)) return { ok: false, error: 'not_select' };
    const wanted = (action.text ?? '').trim().toLowerCase();
    const options = Array.from(element.options);
    const option =
      options.find((o) => o.value.toLowerCase() === wanted || o.text.trim().toLowerCase() === wanted) ??
      options.find((o) => wanted && o.text.toLowerCase().includes(wanted));
    if (!option) return { ok: false, error: 'no_option' };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter ? setter.call(element, option.value) : (element.value = option.value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true };
  }

  return { ok: false, error: 'failed' };
}

// Waits until `text` shows on the page, or `ms` pass.
export async function waitForText(text: string, ms: number): Promise<boolean> {
  const wanted = text.replace(/\s+/g, ' ').trim().toLowerCase();
  const shows = () => (document.body?.innerText ?? '').replace(/\s+/g, ' ').toLowerCase().includes(wanted);
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (shows()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return shows();
}

// The user's turn to point: what the pointer is over gets the ring, and a click picks it without
// reaching the page (only a real one: the page can't pick for them). Escape or `cancelPick` ends it
// with nothing. The pick is kept for the next snapshot, which numbers it.
export function pickElement(): Promise<boolean> {
  const globals = globalThis as unknown as AgentGlobals;
  globals.__shizueAgentPickEnd?.(false);
  globals.__shizueAgentPicked = undefined;
  return new Promise((resolve) => {
    const ours = (event: Event) => event.composedPath().some((node) => node instanceof Element && node.hasAttribute('data-shizue-agent'));
    const target = (event: Event) => event.composedPath()[0] as Element | undefined;
    const over = (event: Event) => {
      if (!ours(event)) globals.__shizueAgentRing?.(target(event) ?? null);
    };
    const swallow = (event: Event) => {
      if (!event.isTrusted || ours(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const click = (event: Event) => {
      if (!event.isTrusted || ours(event)) return;
      swallow(event);
      const picked = target(event);
      if (picked instanceof Element) {
        globals.__shizueAgentPicked = picked;
        globals.__shizueAgentPickedTold = false;
      }
      end(Boolean(picked));
    };
    const key = (event: KeyboardEvent) => {
      if (event.isTrusted && event.key === 'Escape') end(false);
    };
    const swallowed = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'dblclick', 'auxclick'];
    const end = (picked: boolean) => {
      window.removeEventListener('pointerover', over, true);
      for (const type of swallowed) window.removeEventListener(type, swallow, true);
      window.removeEventListener('click', click, true);
      window.removeEventListener('keydown', key, true);
      document.documentElement.style.cursor = '';
      globals.__shizueAgentPickEnd = undefined;
      resolve(picked);
    };
    window.addEventListener('pointerover', over, true);
    for (const type of swallowed) window.addEventListener(type, swallow, true);
    window.addEventListener('click', click, true);
    window.addEventListener('keydown', key, true);
    document.documentElement.style.cursor = 'crosshair';
    globals.__shizueAgentPickEnd = end;
  });
}

export function cancelPick() {
  (globalThis as unknown as AgentGlobals).__shizueAgentPickEnd?.(false);
}

// Before a screenshot: each numbered control on screen gets a badge with its number, and the
// agent's own frame and pill step aside. `false` puts things back. Gives the viewport's size in CSS
// pixels, which the screenshot is scaled to.
export function markElements(on: boolean): { width: number; height: number } {
  const globals = globalThis as unknown as AgentGlobals;
  globals.__shizueAgentMarks?.remove();
  globals.__shizueAgentMarks = undefined;
  // Taken out of the page and put back: no style of its own may hide it (showAgentOverlay).
  const overlay = globals.__shizueAgentOverlay?.host;
  if (overlay && on) overlay.remove();
  else if (overlay && !overlay.isConnected) document.documentElement.append(overlay);
  const size = { width: window.innerWidth, height: window.innerHeight };
  if (!on) return size;
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483647', pointerEvents: 'none' });
  const shadow = host.attachShadow({ mode: 'closed' });
  for (const [ref, element] of globals.__shizueAgentRefs ?? []) {
    if (!element.isConnected) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.bottom < 0 || rect.top > size.height || rect.right < 0 || rect.left > size.width) continue;
    const box = document.createElement('div');
    Object.assign(box.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      outline: '2px solid rgba(255, 0, 110, 0.9)',
      boxSizing: 'border-box',
    });
    const badge = document.createElement('div');
    badge.textContent = String(ref);
    Object.assign(badge.style, {
      position: 'fixed',
      left: `${Math.max(0, rect.left)}px`,
      top: `${Math.max(0, rect.top - 14)}px`,
      padding: '0 3px',
      background: 'rgba(255, 0, 110, 0.95)',
      color: '#fff',
      font: '700 11px/14px system-ui, sans-serif',
      borderRadius: '3px',
    });
    shadow.append(box, badge);
  }
  document.documentElement.append(host);
  globals.__shizueAgentMarks = host;
  return size;
}

// A click at a point of the viewport, on whatever is there, as a pointer would.
export async function clickAt(point: { x: number; y: number }): Promise<{ ok: boolean; error?: AgentStepError }> {
  const globals = globalThis as unknown as AgentGlobals;
  const element = document.elementFromPoint(point.x, point.y);
  if (!element) return { ok: false, error: 'not_found' };
  globals.__shizueAgentRing?.(element);
  await new Promise((resolve) => setTimeout(resolve, 150));
  // What the page does from here on is its answer.
  if (globals.__shizueAgentWatch) Object.assign(globals.__shizueAgentWatch, { changedAt: null, acted: element });
  const at = { bubbles: true, cancelable: true, composed: true, clientX: point.x, clientY: point.y, button: 0 };
  const pointer = { ...at, pointerId: 1, pointerType: 'mouse', isPrimary: true };
  element.dispatchEvent(new PointerEvent('pointerover', pointer));
  element.dispatchEvent(new MouseEvent('mouseover', at));
  element.dispatchEvent(new PointerEvent('pointerdown', pointer));
  element.dispatchEvent(new MouseEvent('mousedown', at));
  (element as HTMLElement).focus?.({ preventScroll: true });
  element.dispatchEvent(new PointerEvent('pointerup', pointer));
  element.dispatchEvent(new MouseEvent('mouseup', at));
  element.dispatchEvent(new MouseEvent('click', at));
  return { ok: true };
}

// The tools this frame's page registered with WebMCP (the page's world). The page's own, not its
// frames': each frame answers for itself.
export async function readWebMcpTools(): Promise<Omit<WebMcpTool, 'frameId'>[]> {
  try {
    const context = (document as any).modelContext ?? (navigator as any).modelContext;
    if (typeof context?.getTools !== 'function') return [];
    const tools: any[] = (await context.getTools()) ?? [];
    return tools
      .filter((tool) => typeof tool?.name === 'string' && (!tool.window || tool.window === window))
      .map((tool) => ({
        name: tool.name,
        description: typeof tool.description === 'string' ? tool.description : '',
        schema:
          typeof tool.inputSchema === 'string' ? tool.inputSchema : JSON.stringify(tool.inputSchema ?? { type: 'object' }),
        ...(tool.annotations?.readOnlyHint === true ? { readOnly: true } : {}),
        ...(tool.annotations?.consequentialHint === true ? { consequential: true } : {}),
      }));
  } catch {
    return [];
  }
}

// Calls a WebMCP tool of this frame (the page's world) with its input as JSON, and gives back what
// it returned as text. Nothing back usually means the tool moved the page on.
export async function runWebMcpTool(name: string, input: string): Promise<{ ok: boolean; output?: string; error?: string }> {
  try {
    const context = (document as any).modelContext ?? (navigator as any).modelContext;
    const tools: any[] = (await context?.getTools?.()) ?? [];
    const tool = tools.find((candidate) => candidate?.name === name && (!candidate.window || candidate.window === window));
    if (!tool) return { ok: false, error: 'no_tool' };
    let result: unknown;
    try {
      result = await context.executeTool(tool, JSON.parse(input));
    } catch (error) {
      // Builds of the origin trial took the input as JSON text.
      if (!String((error as Error)?.message ?? '').startsWith('Failed to parse input')) throw error;
      result = await context.executeTool(tool, input);
    }
    if (result === null || result === undefined) return { ok: true, output: '(nothing returned; the page may have changed)' };
    if (typeof result === 'string') return { ok: true, output: result };
    try {
      return { ok: true, output: JSON.stringify(result) };
    } catch {
      return { ok: true, output: String(result) };
    }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error).slice(0, 300) };
  }
}

// While the agent works the tab: a soft frame around the page, a pill at the top saying so with a
// button to stop (it sends `labels.stopAction`), and the ring an action draws around its element.
// On the user's turn the pill says what to do and gets a button to hand back (`resume` sends
// `resumeAction`, for a real click only). `null` takes it all away.
export function showAgentOverlay(
  state: {
    working: string;
    waiting: string;
    stop: string;
    stopAction: string;
    waitingNow: boolean;
    resume?: string;
    resumeAction?: string;
  } | null
) {
  const globals = globalThis as unknown as AgentGlobals;
  if (!state) {
    globals.__shizueAgentPickEnd?.(false);
    globals.__shizueAgentPicked = undefined;
    globals.__shizueAgentOverlay?.host.remove();
    globals.__shizueAgentOverlay = undefined;
    globals.__shizueAgentRing = undefined;
    globals.__shizueAgentPillPress = undefined;
    return;
  }
  let overlay = globals.__shizueAgentOverlay;
  if (!overlay || !overlay.host.isConnected) {
    const host = document.createElement('div');
    host.setAttribute('data-shizue-agent', '');
    Object.assign(host.style, { position: 'fixed', inset: '0', zIndex: '2147483646', pointerEvents: 'none' });
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = `
      :host { all: initial; }
      /* The page's own !important rules can't hide the frame and its stop button: the shadow's win. */
      :host { display: block !important; opacity: 1 !important; visibility: visible !important; transform: none !important; filter: none !important; clip-path: none !important; }
      .frame { position: fixed; inset: 0; pointer-events: none; box-shadow: inset 0 0 0 2px rgba(50, 204, 188, 0.85), inset 0 0 28px rgba(50, 204, 188, 0.28); animation: breathe 2.4s ease-in-out infinite; }
      .pill { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 10px; box-sizing: border-box; height: 36px; padding: 0 5px 0 14px; border-radius: 9999px; background: rgba(17, 17, 17, 0.88); color: #fff; font: 500 13px/1 system-ui, -apple-system, 'Apple SD Gothic Neo', 'Noto Sans KR', sans-serif; white-space: nowrap; pointer-events: auto; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25); backdrop-filter: blur(8px); animation: drop 240ms ease-out both; }
      .dot { width: 8px; height: 8px; border-radius: 50%; background: #32ccbc; color: rgba(50, 204, 188, 0.6); animation: pulse 1.6s ease-out infinite; flex: none; }
      .dot.waiting { background: #f5b14c; color: rgba(245, 177, 76, 0.6); }
      .label { overflow: hidden; text-overflow: ellipsis; max-width: min(60vw, 520px); }
      .resume { background: #32ccbc; color: #111; }
      .resume:hover { background: #5edccf; }
      .resume[hidden] { display: none; }
      button { all: unset; cursor: pointer; padding: 7px 12px; border-radius: 9999px; background: rgba(255, 255, 255, 0.12); font-weight: 600; transition: background 150ms ease; }
      button:hover { background: rgba(255, 255, 255, 0.22); }
      button:focus-visible { outline: 2px solid #32ccbc; outline-offset: 2px; }
      .ring { position: fixed; border-radius: 8px; pointer-events: none; opacity: 0; box-shadow: 0 0 0 2px #32ccbc, 0 0 0 6px rgba(50, 204, 188, 0.25); transition: opacity 200ms ease, left 180ms ease, top 180ms ease, width 180ms ease, height 180ms ease; }
      .ring.on { opacity: 1; }
      @keyframes breathe { 0%, 100% { opacity: 0.65; } 50% { opacity: 1; } }
      @keyframes drop { from { opacity: 0; transform: translate(-50%, -6px); } to { opacity: 1; transform: translate(-50%, 0); } }
      @keyframes pulse { 0% { box-shadow: 0 0 0 0 currentColor; } 70%, 100% { box-shadow: 0 0 0 6px transparent; } }
      @media (prefers-reduced-motion: reduce) { .frame, .pill, .dot { animation: none; } .ring { transition: none; } }
    `;
    const frame = document.createElement('div');
    frame.className = 'frame';
    const ring = document.createElement('div');
    ring.className = 'ring';
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.setAttribute('role', 'status');
    const dot = document.createElement('span');
    const label = document.createElement('span');
    label.className = 'label';
    const resume = document.createElement('button');
    resume.type = 'button';
    resume.className = 'resume';
    resume.hidden = true;
    const button = document.createElement('button');
    button.type = 'button';
    for (const type of ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
      pill.addEventListener(type, (event) => event.stopPropagation());
    }
    pill.append(dot, label, resume, button);
    shadow.append(style, frame, ring, pill);
    document.documentElement.append(host);
    overlay = { host, dot, label, button, resume };
    globals.__shizueAgentOverlay = overlay;
    let fade: ReturnType<typeof setTimeout> | undefined;
    globals.__shizueAgentRing = (element) => {
      clearTimeout(fade);
      if (!element) return ring.classList.remove('on');
      const rect = element.getBoundingClientRect();
      Object.assign(ring.style, {
        left: `${rect.left - 4}px`,
        top: `${rect.top - 4}px`,
        width: `${rect.width + 8}px`,
        height: `${rect.height + 8}px`,
      });
      ring.classList.add('on');
      fade = setTimeout(() => ring.classList.remove('on'), 1400);
    };
  }
  const stopAction = state.stopAction;
  const stop = () => void chrome.runtime.sendMessage({ action: stopAction }).catch(() => {});
  overlay.button.onclick = (event) => {
    event.preventDefault();
    stop();
  };
  const resumeAction = state.resumeAction;
  const resume = (event: MouseEvent) => {
    if (event.isTrusted && resumeAction) void chrome.runtime.sendMessage({ action: resumeAction }).catch(() => {});
  };
  overlay.resume.onclick = (event) => {
    event.preventDefault();
    resume(event);
  };
  // The same buttons, for a click the page would stop on its way down to them. Outside the closed
  // shadow the click's target is the host; where it landed says which button it was.
  const shown = overlay;
  globals.__shizueAgentPillPress = (event) => {
    if (event.target !== shown.host || globals.__shizueAgentOverlay !== shown) return false;
    const under = (element: HTMLElement) => {
      if (element.hidden) return false;
      const rect = element.getBoundingClientRect();
      return (
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom
      );
    };
    if (under(shown.button)) stop();
    else if (under(shown.resume)) resume(event);
    else return false;
    return true;
  };
  overlay.resume.hidden = !(state.waitingNow && state.resume && resumeAction);
  overlay.resume.textContent = state.resume ?? '';
  overlay.dot.className = state.waitingNow ? 'dot waiting' : 'dot';
  overlay.label.textContent = state.waitingNow ? state.waiting : state.working;
  overlay.label.title = overlay.label.textContent;
  overlay.button.textContent = state.stop;
}
