import {
  MESSAGE_AGENT_STOP,
  MESSAGE_BRIDGE_READ_PDF,
  MESSAGE_READ_VIDEO_TRANSCRIPT,
  STORAGE_BRIDGE_LOG,
  STORAGE_BRIDGE_OPENED_TABS,
  STORAGE_BRIDGE_PAUSED_TABS,
  SUMMARY_PAGE_TEXT_MAX_CHARS,
} from '@/config/constants';
import {
  actionResult,
  AgentAction,
  AgentActionKind,
  AgentStep,
  elementLabel,
  formatSnapshot,
  needsApproval,
  PageElement,
  PageSnapshot,
  parseAgentReply,
} from '@/lib/browserAgent';
import { showAgentOverlay } from '@/lib/browserAgentPage';
import { askInPage } from '@/lib/bridgePage';
import { MAIN_TEXT_EXCLUDE, readPageContent } from '@/lib/mainText';
import type { PageRead } from '@/lib/tabText';
import { transcriptText, videoKey, type VideoTranscript } from '@/lib/videoTranscript';
import { activityOf, execute, screenshot, settle, snapshotOf } from '@/services/background/browserAgentHandler';
import { recoverTabContentScripts } from '@/services/background/contentScriptRecovery';
import { debugLog } from '@/logs';
import { i18n } from '#i18n';

// Claude Code's way into Shizue, built like Claude in Chrome's: Chrome starts the native host
// (scripts/shizue-bridge), which passes on what Claude Code's MCP server asks, and Shizue reads and
// works the tab with the browser agent's own hands. Only a build with the nativeMessaging
// permission has it (`pnpm build:bridge`). Codex and any other agent that runs a stdio MCP server
// come in the same way; the page's pill and cards name the one at work, by what it calls itself.
//
// Claude Code reaches only the tabs in a tab group named "Shizue": the ones it opened, which open
// there in the background, and the ones the user dragged in. While it works a tab, the browser
// agent's border and pill show there, and the pill's Stop shuts it out of that tab until the user
// lets it back in from the settings, where what it did is listed. Claude Code asks the user about
// its tool calls, and a click or Enter that may send, delete or pay asks again on the page itself,
// since a user who always allows `act` would otherwise allow those too. A password or card field
// stays out of reach as it does for the agent.

type BridgeArgs = Record<string, unknown> & { tabId?: number };
type BridgeResult = { text: string; image?: { data: string; mimeType: string } };
// A call from the host: `agent` is the name the MCP server got from its client.
type BridgeCall = { id: string; tool: string; args?: BridgeArgs; agent?: unknown };
type SharedTab = chrome.tabs.Tab & { id: number };

// What the settings list (components/Setting/BridgeSettings.tsx).
export type BridgeLogEntry = {
  at: number;
  tool: string;
  tabId?: number;
  host?: string;
  // What it acted on, or looked for.
  target?: string;
  ok: boolean;
  // Why it failed, or 'declined' or 'paused'.
  note?: string;
  // The agent that called, as the page's pill names it.
  agent?: string;
};

const HOST_NAME = 'net.shizue.bridge';
const GROUP_TITLE = 'Shizue';
const KINDS: AgentActionKind[] = [
  'click',
  'type',
  'select',
  'press',
  'hover',
  'scroll',
  'navigate',
  'back',
  'wait',
  'open_tab',
];
// A connection that lasted this long is worth making again; one that ended at once has no host.
const WORTH_RECONNECTING_MS = 5000;
const RECONNECT_AFTER_MS = 5000;
const LOG_LIMIT = 100;
// The pill goes once the agent has left the tab alone this long.
const OVERLAY_IDLE_MS = 8000;
// The page's own question goes unanswered after this, and counts as declined. With the action's
// own wait it stays inside the MCP server's 60 s for one call.
const CONFIRM_TIMEOUT_MS = 40_000;
const FIND_LIMIT = 20;

const NOT_SHARED =
  'That tab is not shared with you. Only tabs in the tab group named "Shizue" are: ask the user to drag the tab into that group, or open the page with act open_tab.';
const PAUSED =
  "The user stopped you in this tab with the Stop button on the page. Don't go on here: ask the user what to do. They can let you back in from Shizue's settings.";
const MAX_AGENT_NAME = 40;

// The page as last read, by tab: what an action's number points at.
const pages = new Map<number, PageSnapshot>();
// The tab the agent worked last, for a call that names none.
let lastTabId: number | undefined;

const bridgeBuild = () => chrome.runtime.getManifest().permissions?.includes('nativeMessaging') ?? false;

const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? '').hostname || undefined;
  } catch {
    return undefined;
  }
};

const sessionList = async <T>(key: string) =>
  ((await chrome.storage.session.get(key))[key] as T[] | undefined) ?? [];

const pausedTabs = () => sessionList<number>(STORAGE_BRIDGE_PAUSED_TABS);
const openedTabs = () => sessionList<number>(STORAGE_BRIDGE_OPENED_TABS);

// Changes to the stored tab lists, one after another, so calls running together don't drop each
// other's.
let listWrites: Promise<unknown> = Promise.resolve();
const changeList = (key: string, change: (ids: number[]) => number[]) =>
  (listWrites = listWrites.then(async () => {
    const ids = await sessionList<number>(key);
    const next = change(ids);
    if (next.length !== ids.length || next.some((id, index) => id !== ids[index])) {
      await chrome.storage.session.set({ [key]: next });
    }
  }).catch(() => {}));

// The log, kept here while the worker runs and in session storage for the settings to show. The
// settings clear it there. Each entry builds on the one before, even when calls run together.
let log: Promise<BridgeLogEntry[]> | null = null;
const record = async (entry: Omit<BridgeLogEntry, 'at'>) => {
  log = (log ?? sessionList<BridgeLogEntry>(STORAGE_BRIDGE_LOG)).then((entries) =>
    [...entries, { at: Date.now(), ...entry }].slice(-LOG_LIMIT)
  );
  await chrome.storage.session.set({ [STORAGE_BRIDGE_LOG]: await log }).catch(() => {});
};

/* Which tabs */

const shizueGroups = async () =>
  new Set((await chrome.tabGroups.query({ title: GROUP_TITLE })).map((group) => group.id));

const sharedTabs = async () => {
  const [groups, tabs] = await Promise.all([shizueGroups(), chrome.tabs.query({})]);
  return tabs.filter((tab): tab is SharedTab => tab.id !== undefined && !tab.incognito && groups.has(tab.groupId));
};

const sharedTab = async (tabId: number) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab?.id === undefined) throw new Error('There is no tab with that id. Use list_tabs.');
  if (tab.incognito || !(await shizueGroups()).has(tab.groupId)) throw new Error(NOT_SHARED);
  return tab as SharedTab;
};

// The tab a call names; or else the one worked last (its numbers are the ones Claude Code has), the
// shared tab on screen, or the only one.
const tabOf = async ({ tabId }: BridgeArgs) => {
  if (typeof tabId === 'number') return sharedTab(tabId);
  if (tabId !== undefined && tabId !== null) throw new Error('tabId must be a number from list_tabs.');
  const shared = await sharedTabs();
  const [onScreen] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  for (const id of [lastTabId, onScreen?.id, shared.length === 1 ? shared[0].id : undefined]) {
    const tab = shared.find((candidate) => candidate.id === id);
    if (tab) return tab;
  }
  throw new Error(
    shared.length ? 'Say which tab: give a tabId from list_tabs.' : `No tab is shared with you yet. ${NOT_SHARED}`
  );
};

/* What the user sees */

const overlayTimers = new Map<number, ReturnType<typeof setTimeout>>();

// The browser agent's pill, in the browser's language: the panel, which has the user's own pick,
// may not be open.
const overlayState = (waitingNow: boolean, agent: string) => ({
  working: fill('bridge.overlayWorking', { agent }),
  waiting: fill('bridge.overlayWaiting', { agent }),
  stop: i18n.t('agent.overlayStop'),
  stopAction: MESSAGE_AGENT_STOP,
  waitingNow,
});

const injectOverlay = (tabId: number, state: ReturnType<typeof overlayState> | null) =>
  chrome.scripting
    .executeScript({ target: { tabId, frameIds: [0] }, func: showAgentOverlay, args: [state] })
    .catch(() => {});

// Again on every call, since a new page has none.
const showOverlay = async (tabId: number, agent: string, waitingNow = false) => {
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.delete(tabId);
  await injectOverlay(tabId, overlayState(waitingNow, agent));
};

const hideOverlay = (tabId: number) => {
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.delete(tabId);
  void injectOverlay(tabId, null);
};

const hideOverlaySoon = (tabId: number) => {
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.set(
    tabId,
    setTimeout(() => hideOverlay(tabId), OVERLAY_IDLE_MS)
  );
};

// The Stop button on the pill (messageHandlers.ts handleAgentStop, which also stops Shizue's own
// agent there): the agent is shut out of the tab until the user lets it back in from the
// settings, or the tab closes.
export const pauseBridgeInTab = async (tabId: number | undefined) => {
  if (tabId === undefined || !bridgeBuild()) return;
  await changeList(STORAGE_BRIDGE_PAUSED_TABS, (paused) => (paused.includes(tabId) ? paused : [...paused, tabId]));
  hideOverlay(tabId);
};

// The panel's step strings take {{name}}, where #i18n's own substitution would leave braces
// around the value; the string is read as it is and filled here.
type FillKey =
  | 'agent.step.typeSubmit'
  | 'agent.step.type'
  | 'agent.step.select'
  | 'agent.step.click'
  | 'agent.step.press'
  | 'agent.step.pressOn'
  | 'bridge.overlayWorking'
  | 'bridge.overlayWaiting'
  | 'bridge.confirmTitle';
const fill = (key: FillKey, values: Record<string, string>) =>
  (i18n.t as (key: FillKey) => string)(key).replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '');

// The name the agent gave itself (scripts/shizue-bridge/protocol.mjs agentName), or a plain one.
const agentLabel = (name: unknown) => {
  const clean = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f\s]+/g, ' ').trim() : '';
  return clean ? clean.slice(0, MAX_AGENT_NAME) : i18n.t('bridge.agentFallback');
};

const stepText = (action: AgentAction, element: PageElement | undefined) => {
  const values = {
    target: elementLabel(element) ?? '',
    text: action.text ?? '',
    key: action.key === ' ' ? 'Space' : action.key ?? '',
  };
  if (action.kind === 'type' && action.submit) return fill('agent.step.typeSubmit', values);
  if (action.kind === 'type') return fill('agent.step.type', values);
  if (action.kind === 'select') return fill('agent.step.select', values);
  if (action.kind === 'press') return fill(element ? 'agent.step.pressOn' : 'agent.step.press', values);
  return fill('agent.step.click', values);
};

// The user's own Allow on the page, brought to the front for it. Leaving the page counts as Decline.
const confirmInPage = async (
  tabId: number,
  action: AgentAction,
  element: PageElement | undefined,
  agent: string
) => {
  const shown = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  // Its window may be behind the one the user is in.
  if (shown?.windowId !== undefined) await chrome.windows.update(shown.windowId, { focused: true }).catch(() => {});
  await showOverlay(tabId, agent, true);
  const [injection] = await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [0] },
      func: askInPage,
      args: [
        {
          title: fill('bridge.confirmTitle', { agent }),
          action: stepText(action, element),
          hint: i18n.t('agent.approvalHint'),
          allow: i18n.t('agent.allow'),
          deny: i18n.t('agent.deny'),
          timeoutMs: CONFIRM_TIMEOUT_MS,
        },
      ],
    })
    .catch(() => []);
  // Stopped while the card was up: the answer no longer counts.
  if ((await pausedTabs()).includes(tabId)) return false;
  await showOverlay(tabId, agent);
  return injection?.result === true;
};

// One call on a shared tab: refused where the user stopped the agent, shown with the pill while it
// runs, and logged.
const onTab = async (
  tool: string,
  args: BridgeArgs,
  agent: string,
  work: (tab: SharedTab) => Promise<{ result: BridgeResult; target?: string; ok?: boolean; note?: string }>
): Promise<BridgeResult> => {
  const tab = await tabOf(args);
  const entry = { tool, tabId: tab.id, host: hostOf(tab.url), agent };
  if ((await pausedTabs()).includes(tab.id)) {
    await record({ ...entry, ok: false, note: 'paused' });
    throw new Error(PAUSED);
  }
  lastTabId = tab.id;
  await showOverlay(tab.id, agent);
  try {
    const { result, target, ok = true, note } = await work(tab);
    await record({ ...entry, target, ok, note });
    return result;
  } catch (error) {
    await record({ ...entry, ok: false, note: (error as Error).message.slice(0, 160) });
    throw error;
  } finally {
    hideOverlaySoon(tab.id);
  }
};

/* Reading */

// Each read numbers the controls afresh, and actions go by the latest read.
const read = async (tabId: number) => {
  const page = await snapshotOf(tabId);
  if (!page) throw new Error('This page cannot be read (a browser page or a site Shizue may not access).');
  pages.set(tabId, page);
  return page;
};

const pageText = (tabId: number, page: PageSnapshot) => `Tab: ${tabId}\n${formatSnapshot(page)}`;

// The page after an action, which was done even when the page can't be read now.
const pageAfter = async (tabId: number) => {
  const page = await read(tabId).catch(() => null);
  return page ? `The page now:\n${pageText(tabId, page)}` : 'The page cannot be read now (a browser page or a site Shizue may not access).';
};

const elementSummary = (element: PageElement) =>
  [
    `[${element.ref}] ${element.role || element.tag}`,
    element.name ? JSON.stringify(element.name.slice(0, 80)) : '',
    element.value ? `value=${JSON.stringify(element.value.slice(0, 60))}` : '',
    element.href ? `→ ${element.href.slice(0, 100)}` : '',
    element.secret ? '(sensitive field: never type here)' : '',
    element.below ? '(below the screen)' : '',
    element.frameId !== undefined ? '(in a frame)' : '',
  ]
    .filter(Boolean)
    .join(' ');

// The captions a YouTube or Netflix tab's content script reads (lib/tabText.ts does the same for
// the panel).
const readVideoTranscript = async (tabId: number): Promise<VideoTranscript | null> => {
  const send = (): Promise<VideoTranscript | null> =>
    chrome.tabs.sendMessage(tabId, { action: MESSAGE_READ_VIDEO_TRANSCRIPT }, { frameId: 0 });
  try {
    return await send();
  } catch {
    // A tab opened before the extension was updated or reloaded has no content script yet.
    return (await recoverTabContentScripts(tabId)) ? send().catch(() => null) : null;
  }
};

// pdf.js needs a worker, which a service worker can't start, so a PDF is read in an offscreen page
// (entrypoints/offscreen-pdf), one at a time, and the page closed after.
let pdfReads: Promise<unknown> = Promise.resolve();
const readPdf = (url: string, title: string) => {
  const reading = pdfReads.then(async (): Promise<PageRead> => {
    await chrome.offscreen
      .createDocument({
        url: 'offscreen-pdf.html',
        reasons: [chrome.offscreen.Reason.WORKERS],
        justification: 'Reads the text of a PDF tab an agent asked for.',
      })
      .catch(() => {});
    try {
      return (await chrome.runtime.sendMessage({ action: MESSAGE_BRIDGE_READ_PDF, url, title })) ?? { error: 'unreadable' };
    } catch {
      return { error: 'unreadable' };
    } finally {
      await chrome.offscreen.closeDocument().catch(() => {});
    }
  });
  pdfReads = reading.catch(() => {});
  return reading;
};

// What a summary or an attached tab reads in the panel: a video's captions, a PDF's text, or the
// page's main content without its menus and sidebars.
const textOf = async (tab: SharedTab) => {
  if (videoKey(tab.url) !== null) {
    const transcript = await readVideoTranscript(tab.id);
    if (transcript?.captions) return `Title: ${transcript.title}\nURL: ${tab.url}\n\n${transcriptText(transcript)}`;
  }
  const [injection] = await chrome.scripting
    .executeScript({ target: { tabId: tab.id }, func: readPageContent, args: [MAIN_TEXT_EXCLUDE] })
    .catch(() => []);
  const page = injection?.result;
  if (!page) throw new Error('This page cannot be read (a browser page or a site Shizue may not access).');
  if (page.pdf) {
    const pdf = await readPdf(page.url, page.title);
    if ('error' in pdf) throw new Error('This PDF has no text to read (a scanned PDF), or it could not be fetched.');
    return `Title: ${page.title}\nURL: ${page.url}\n\n${pdf.page.text}`;
  }
  return `Title: ${page.title}\nURL: ${page.url}\n\n${page.text}`;
};

/* Acting */

// The same hands as the browser agent's loop, for one action.
const doAction = async (
  tabId: number,
  action: AgentAction,
  element: PageElement | undefined,
  agent: string
): Promise<AgentStep> => {
  const step: AgentStep = { id: crypto.randomUUID(), action, status: 'running' };
  if (action.ref !== undefined && !element) return { ...step, status: 'failed', error: 'not_found' };
  if (action.kind === 'type' && element?.secret) return { ...step, status: 'failed', error: 'secret_field' };
  if (needsApproval(action, element, false) && !(await confirmInPage(tabId, action, element, agent))) {
    return { ...step, status: 'denied' };
  }
  // The user may have stopped the agent here since the call came in.
  if ((await pausedTabs()).includes(tabId)) return { ...step, status: 'denied' };
  const frameId = element?.frameId ?? 0;
  await activityOf(tabId, frameId, true);
  Object.assign(step, await execute(tabId, action, element));
  await settle(tabId, frameId, action.kind, new AbortController().signal);
  return step;
};

// In the background, in the Shizue group (made in the user's window if there is none), so the
// user's own tab stays in front.
const openTab = async (url: string, withPage: boolean, agent: string): Promise<BridgeResult> => {
  const windows = (await chrome.windows.getAll({ windowTypes: ['normal'] })).filter((window) => !window.incognito);
  const group = (await chrome.tabGroups.query({ title: GROUP_TITLE })).find((candidate) =>
    windows.some((window) => window.id === candidate.windowId)
  );
  const windowId = group?.windowId ?? windows.find((window) => window.focused)?.id ?? windows[0]?.id;
  const tab =
    windowId === undefined
      ? (await chrome.windows.create({ url, focused: false })).tabs?.[0]
      : await chrome.tabs.create({ url, windowId, active: false });
  if (tab?.id === undefined) throw new Error('The tab could not be opened.');
  const tabId = tab.id;
  const groupId = await chrome.tabs.group({
    tabIds: [tabId],
    ...(group ? { groupId: group.id } : { createProperties: { windowId: tab.windowId } }),
  });
  if (!group) await chrome.tabGroups.update(groupId, { title: GROUP_TITLE, color: 'cyan' });
  await changeList(STORAGE_BRIDGE_OPENED_TABS, (opened) => [...opened, tabId]);
  lastTabId = tabId;
  await settle(tabId, 0, 'navigate', new AbortController().signal);
  await showOverlay(tabId, agent);
  hideOverlaySoon(tabId);
  const opened = await chrome.tabs.get(tabId).catch(() => tab);
  await record({ tool: 'act', tabId, host: hostOf(opened.url ?? url), target: 'open_tab', ok: true, agent });
  const done = `Result: done. Opened tab ${tabId} (${JSON.stringify(opened.title ?? '')}) in the Shizue group, behind the user's tab.`;
  return { text: withPage ? `${done}\n\n${await pageAfter(tabId)}` : done };
};

const act = (args: BridgeArgs, agent: string) => {
  const reply = parseAgentReply(JSON.stringify({ ...args, action: args.kind }));
  if (!reply || !KINDS.includes(reply.action.kind)) {
    throw new Error('That is not an action this can do, or a field it needs is missing.');
  }
  const { action } = reply;
  const withPage = args.include_snapshot === true;
  if (action.kind === 'open_tab') return openTab(action.url!, withPage, agent);
  return onTab('act', args, agent, async (tab) => {
    const tabId = tab.id;
    const page = pages.get(tabId);
    if (action.ref !== undefined && !page) throw new Error('Read the page first: its numbers come from read_page or find.');
    const element = action.ref !== undefined ? page?.elements.find((candidate) => candidate.ref === action.ref) : undefined;
    const step = await doAction(tabId, action, element, agent);
    const now = await chrome.tabs.get(tabId).catch(() => null);
    const label = elementLabel(element) ?? action.url ?? action.key ?? action.direction;
    const target = `${action.kind}${label ? ` ‘${label}’` : ''}`;
    const lines = [actionResult(step)];
    if (step.status === 'done') {
      if (now?.url !== tab.url) {
        lines.push(`The tab is now at ${now?.url} (${JSON.stringify(now?.title ?? '')}), so the old numbers are gone.`);
      } else if (now?.title !== tab.title) {
        lines.push(`The page's title is now ${JSON.stringify(now?.title ?? '')}.`);
      }
      if (!withPage) lines.push('To see what changed, read_page, find, or pass include_snapshot.');
    }
    // A failed action comes back with the page, to go on from.
    const showPage = withPage || step.status === 'failed';
    return {
      result: {
        text: showPage ? `${lines.join(' ')}\n\n${await pageAfter(tabId)}` : lines.join(' '),
      },
      target,
      ok: step.status === 'done',
      note: step.status === 'denied' ? 'declined' : step.error,
    };
  });
};

const tools: Record<string, (args: BridgeArgs, agent: string) => Promise<BridgeResult>> = {
  list_tabs: async (_args, agent) => {
    const shared = (await sharedTabs()).filter((tab) => /^https?:/.test(tab.url ?? ''));
    const paused = await pausedTabs();
    await record({ tool: 'list_tabs', ok: true, agent });
    if (!shared.length) return { text: `No tab is shared with you yet. ${NOT_SHARED}` };
    return {
      text: JSON.stringify(
        shared.map(({ id, title, url, active }) => ({ id, title, url, active, ...(paused.includes(id) ? { stopped: true } : {}) }))
      ),
    };
  },

  read_page: (args, agent) =>
    onTab('read_page', args, agent, async (tab) => ({ result: { text: pageText(tab.id, await read(tab.id)) } })),

  find: (args, agent) =>
    onTab('find', args, agent, async (tab) => {
      const query = typeof args.query === 'string' ? args.query.trim() : '';
      if (!query) throw new Error('find needs a query: words on the control, such as "Send".');
      const words = query.toLowerCase().split(/\s+/);
      const page = await read(tab.id);
      const found = page.elements.filter((element) => {
        const text = [element.name, element.value, element.role, element.tag, element.type, element.href]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return words.every((word) => text.includes(word));
      });
      const more = found.length > FIND_LIMIT ? `\n…and ${found.length - FIND_LIMIT} more; say more in the query.` : '';
      const text = found.length
        ? `Tab: ${tab.id}. Controls matching ${JSON.stringify(query)}, numbered by this read (earlier numbers no longer hold):\n${found
            .slice(0, FIND_LIMIT)
            .map(elementSummary)
            .join('\n')}${more}`
        : `Tab: ${tab.id}. Nothing on the page matches ${JSON.stringify(query)}. Try other words, scroll, or read_page.`;
      return { result: { text }, target: query };
    }),

  get_text: (args, agent) =>
    onTab('get_text', args, agent, async (tab) => {
      const text = await textOf(tab);
      const cut = text.length > SUMMARY_PAGE_TEXT_MAX_CHARS;
      return {
        result: {
          text: `Tab: ${tab.id}\n${text.slice(0, SUMMARY_PAGE_TEXT_MAX_CHARS)}${cut ? `\n(cut at ${SUMMARY_PAGE_TEXT_MAX_CHARS} characters)` : ''}`,
        },
      };
    }),

  act,

  screenshot: (args, agent) =>
    onTab('screenshot', args, agent, async (tab) => {
      // Numbers the controls the screenshot marks.
      await read(tab.id);
      const shot = await screenshot(tab.id);
      if (!shot) {
        throw new Error(
          'Only the tab showing in its window can be captured. switch_tab brings this one forward, which changes what the user sees in that window.'
        );
      }
      return {
        result: {
          text: `Tab: ${tab.id}. ${shot.width}x${shot.height} px, its controls marked with their numbers.`,
          image: { data: shot.dataUrl.split(',')[1], mimeType: 'image/jpeg' },
        },
      };
    }),

  switch_tab: (args, agent) => {
    if (typeof args.tabId !== 'number') throw new Error('switch_tab needs a tabId from list_tabs.');
    return onTab('switch_tab', args, agent, async (tab) => {
      await chrome.tabs.update(tab.id, { active: true });
      return { result: { text: `Result: done. Tab ${tab.id} is now the one showing in its window.` } };
    });
  },

  close_tab: (args, agent) => {
    if (typeof args.tabId !== 'number') throw new Error('close_tab needs a tabId from list_tabs.');
    return onTab('close_tab', args, agent, async (tab) => {
      if (!(await openedTabs()).includes(tab.id)) {
        throw new Error('You may close only the tabs you opened. Ask the user to close this one.');
      }
      await chrome.tabs.remove(tab.id);
      return { result: { text: `Result: done. Tab ${tab.id} is closed.` } };
    });
  },
};

const forgetTab = async (tabId: number) => {
  pages.delete(tabId);
  clearTimeout(overlayTimers.get(tabId));
  overlayTimers.delete(tabId);
  await changeList(STORAGE_BRIDGE_OPENED_TABS, (opened) => opened.filter((id) => id !== tabId));
  await changeList(STORAGE_BRIDGE_PAUSED_TABS, (paused) => paused.filter((id) => id !== tabId));
};

const connect = () => {
  const started = Date.now();
  const port = chrome.runtime.connectNative(HOST_NAME);
  const answer = (message: object) => {
    try {
      port.postMessage(message);
    } catch {
      // The host went away; whoever asked hears that from their socket.
    }
  };
  port.onMessage.addListener(async ({ id, tool, args, agent }: BridgeCall) => {
    try {
      if (!Object.hasOwn(tools, tool)) throw new Error(`Unknown tool: ${tool}`);
      answer({ id, result: await tools[tool](args ?? {}, agentLabel(agent)) });
    } catch (error) {
      answer({ id, error: (error as Error).message });
    }
  });
  port.onDisconnect.addListener(() => {
    debugLog('Native bridge disconnected:', chrome.runtime.lastError?.message);
    if (Date.now() - started > WORTH_RECONNECTING_MS) setTimeout(connect, RECONNECT_AFTER_MS);
  });
};

export const nativeBridgeListeners = () => {
  if (!bridgeBuild()) return;
  // Starts the worker with the browser; the open port then keeps it awake.
  chrome.runtime.onStartup.addListener(() => {});
  chrome.tabs.onRemoved.addListener((tabId) => void forgetTab(tabId));
  // The settings clearing the log.
  chrome.storage.session.onChanged.addListener((changes) => {
    if (STORAGE_BRIDGE_LOG in changes) log = Promise.resolve(changes[STORAGE_BRIDGE_LOG].newValue ?? []);
  });
  connect();
};
