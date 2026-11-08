import {
  MESSAGE_AGENT_RESUME,
  MESSAGE_AGENT_STOP,
  STORAGE_AGENT_ALLOWED_SITES,
  STORAGE_AGENT_BACKGROUND,
  STORAGE_AGENT_SITE_TIPS,
} from '@/config/constants';
import type { Language } from '@/hooks/language';
import {
  actionResult,
  actionSignature,
  AgentAction,
  AgentActionKind,
  AgentLabels,
  AgentOutcome,
  AgentRun,
  AgentSiteTips,
  AgentStep,
  AgentTab,
  BROWSER_AGENT_MAX_STEPS,
  elementLabel,
  formatSnapshot,
  needsApproval,
  PageElement,
  pageSettled,
  PageSnapshot,
  parseAgentReply,
  siteOf,
  timesTried,
  WebMcpTool,
  withFrames,
} from '@/lib/browserAgent';
import {
  cancelPick,
  clickAt,
  markElements,
  pageActivity,
  performAction,
  pickElement,
  readWebMcpTools,
  runWebMcpTool,
  showAgentOverlay,
  snapshotPage,
  waitForText,
} from '@/lib/browserAgentPage';
import { formatImageForProvider } from '@/lib/imageFormatHelper';
import { db } from '@/lib/indexDB';
import { BASE_REASONING_EFFORTS, chunkParts, effortWithin } from '@/lib/reasoning';
import { getModelInstance, isLocalModel, ModelOptions, ModelPreset } from '@/lib/models';
import { BROWSER_AGENT_JSON_SCHEMA, getBrowserAgentPrompt } from '@/lib/prompts';
import { trackTokenUsage } from '@/lib/tokenUsageTracker';
import { debugLog, errorLog } from '@/logs';
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';

// The browser agent's loop (lib/browserAgent.ts) for one answer: read the tab, ask the chat model
// for an action, wait for the user's go-ahead when it commits to something, do it, and read the
// tab again, until the model finishes. The panel follows the run through the answer's port as
// `{agent: AgentRun}`, and answers an approval card back over the same port.

// The page's text the model reads each turn; older pages are cut to their address.
const PAGE_TEXT_CHARS = 5000;
const LEFT_OUT = '(page details left out)';
const SETTLE_TIMEOUT_MS = 10_000;
const SETTLE_POLL_MS = 100;

// An approval card's answer: 'always' allows a site for good.
type Approval = boolean | 'always';
const approvals = new Map<string, (approved: Approval) => void>();
const runs = new Map<number, AbortController>();
// The user's turn in a tab (handoff): the step the pill's hand-back button ends.
const turns = new Map<number, string>();
// A question waits this long for the user's answer.
const ASK_TIMEOUT_MS = 5 * 60_000;
// The user's turn (handoff, point) waits this long: signing in can take a while.
const TURN_TIMEOUT_MS = 10 * 60_000;
// wait with a text waits this long for it.
const WAIT_FOR_TEXT_MS = 10_000;
// What acts on the page it is on, and so needs the user's leave on a site new to the run.
const ACTS_ON_PAGE: AgentActionKind[] = ['click', 'type', 'select', 'press', 'hover', 'upload', 'click_at', 'tool'];
// Screenshots are at most this wide, in pixels, to keep their tokens down.
const SHOT_WIDTH = 1280;
const TOOL_OUTPUT_CHARS = 4000;

// What the user typed while a run worked, by the answer's port: the next turn reads it, and a
// question waiting takes it as its answer.
type Steering = { said: string[]; wake?: () => void };
const steering = new Map<chrome.runtime.Port, Steering>();

// Text the user sent from the chat box while the agent works on this port's answer.
export const steerAgent = (port: chrome.runtime.Port, text: string) => {
  const run = steering.get(port);
  if (!run || !text.trim()) return;
  run.said.push(text.trim());
  run.wake?.();
};

// The panel's answer to an approval card, or to the user's turn (true hands back).
export const answerAgentApproval = (stepId: string, approved: Approval) => {
  approvals.get(stepId)?.(approved);
  approvals.delete(stepId);
};

// The stop button on the agent's pill in the page, or the panel's "take over".
export const stopAgentInTab = (tabId: number | undefined) => {
  if (tabId !== undefined) runs.get(tabId)?.abort();
};

// The hand-back button on the agent's pill, on the user's turn.
export const resumeAgentInTab = (tabId: number | undefined) => {
  const stepId = tabId === undefined ? undefined : turns.get(tabId);
  if (stepId) answerAgentApproval(stepId, true);
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    });
  });

// The tab the user is looking at, beside the panel.
export const activeWebTab = async () => {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id !== undefined && /^https?:/.test(tab.url ?? '') ? (tab as chrome.tabs.Tab & { id: number }) : null;
};

// The tools the page and its frames registered with WebMCP; none on most pages, and in Firefox.
const webMcpToolsOf = async (tabId: number): Promise<WebMcpTool[]> => {
  try {
    const injections = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      func: readWebMcpTools,
    });
    const seen = new Set<string>();
    return injections
      .sort((a, b) => a.frameId - b.frameId)
      .flatMap((injection) =>
        ((injection.result as Omit<WebMcpTool, 'frameId'>[] | undefined) ?? []).map((tool) => ({
          ...tool,
          frameId: injection.frameId,
        }))
      )
      .filter((tool) => !seen.has(tool.name) && (seen.add(tool.name), true));
  } catch {
    return [];
  }
};

// The page and its frames (a form or a document embedded from elsewhere), read together, with the
// tools the site offers.
export const snapshotOf = async (tabId: number): Promise<PageSnapshot | null> => {
  const read = (target: chrome.scripting.InjectionTarget) =>
    chrome.scripting.executeScript({ target, func: snapshotPage, args: [PAGE_TEXT_CHARS] });
  try {
    // A frame that can't be read leaves the page itself.
    const [injections, tools] = await Promise.all([
      read({ tabId, allFrames: true }).catch(() => read({ tabId, frameIds: [0] })),
      webMcpToolsOf(tabId),
    ]);
    const page = injections.find((injection) => injection.frameId === 0)?.result as PageSnapshot | undefined;
    if (!page) return null;
    const frames = injections
      .filter((injection) => injection.frameId !== 0 && injection.result)
      .sort((a, b) => a.frameId - b.frameId)
      .map((injection) => ({ frameId: injection.frameId, snapshot: injection.result as PageSnapshot }));
    return { ...withFrames(page, frames), ...(tools.length ? { tools } : {}) };
  } catch (error) {
    debugLog('Browser agent: snapshot failed', error);
    return null;
  }
};

const toDataUrl = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type};base64,${btoa(binary)}`;
};

// The tab on screen as a JPEG, its controls marked with their numbers, at most SHOT_WIDTH wide.
// `scale` turns the image's pixels back into the page's. Only the tab showing can be captured.
export const screenshot = async (tabId: number): Promise<{ dataUrl: string; scale: number; width: number; height: number } | null> => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (!tab?.active || tab.windowId === undefined) return null;
  const mark = async (on: boolean) =>
    (await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: markElements, args: [on] }))[0]
      ?.result as { width: number; height: number } | undefined;
  try {
    const viewport = await mark(true);
    if (!viewport) return null;
    const captured = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: 70 });
    await mark(false);
    // The user may have moved to another tab meanwhile, and that one isn't the agent's to see.
    const [showing] = await chrome.tabs.query({ active: true, windowId: tab.windowId });
    if (showing?.id !== tabId) return null;
    const scale = Math.min(1, SHOT_WIDTH / viewport.width);
    const width = Math.round(viewport.width * scale);
    const height = Math.round(viewport.height * scale);
    const bitmap = await createImageBitmap(await (await fetch(captured)).blob());
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
    const dataUrl = await toDataUrl(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 }));
    return { dataUrl, scale, width, height };
  } catch (error) {
    debugLog('Browser agent: screenshot failed', error);
    await mark(false).catch(() => undefined);
    return null;
  }
};

// `handBack`: the user's turn, which the pill's button ends.
const overlay = async (tabId: number, labels: AgentLabels | undefined, waitingNow: boolean | null, handBack = false) => {
  if (!labels && waitingNow !== null) return;
  await chrome.scripting
    .executeScript({
      target: { tabId, frameIds: [0] },
      func: showAgentOverlay,
      args: [
        waitingNow === null || !labels
          ? null
          : {
              working: labels.working,
              waiting: labels.waiting,
              stop: labels.stop,
              stopAction: MESSAGE_AGENT_STOP,
              waitingNow,
              ...(handBack && labels.resume ? { resume: labels.resume, resumeAction: MESSAGE_AGENT_RESUME } : {}),
            },
      ],
    })
    .catch(() => {});
};

// A run behind the user's tab keeps its tabs in a group of their own, when the user granted tab
// groups (an optional permission, asked for when they turned that on).
const groupTab = async (tabId: number, groupId: number | undefined, title: string | undefined) => {
  if (!chrome.tabGroups) return undefined;
  try {
    const group = await chrome.tabs.group({ tabIds: [tabId], ...(groupId !== undefined ? { groupId } : {}) });
    if (groupId === undefined) await chrome.tabGroups.update(group, { title: title ?? 'Shizue', color: 'cyan' });
    return group;
  } catch (error) {
    debugLog('Browser agent: grouping its tab failed', error);
    return groupId;
  }
};

// Names for the user's images, by their type.
const imageName = (dataUrl: string, number: number) => {
  const type = dataUrl.match(/^data:image\/([a-z0-9.+-]+)/i)?.[1]?.toLowerCase() ?? 'png';
  return `image-${number}.${type === 'jpeg' ? 'jpg' : type.replace(/\+.*$/, '')}`;
};

export const activityOf = async (tabId: number, frameId: number, begin: boolean) => {
  const [injection] = await chrome.scripting
    .executeScript({ target: { tabId, frameIds: [frameId] }, func: pageActivity, args: [begin] })
    .catch(() => []);
  return injection?.result as ReturnType<typeof pageActivity> | undefined;
};

// Until the tab has loaded what the action started, if anything, and the frame acted in has
// answered (pageSettled). A frame that can't be asked counts as one that shows no change.
export const settle = async (tabId: number, frameId: number, kind: AgentActionKind, signal: AbortSignal) => {
  let since = Date.now();
  const until = since + SETTLE_TIMEOUT_MS;
  while (!signal.aborted && Date.now() < until) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return;
    if (tab.status === 'complete') {
      const activity = await activityOf(tabId, frameId, false);
      // The action took it to a new page, whose time starts now.
      if (activity?.newDocument) {
        since = Date.now();
        kind = 'navigate';
      }
      const now = Date.now();
      const changedAt = activity?.changedAt ?? null;
      const sinceChange = changedAt === null ? null : now - changedAt;
      if (pageSettled(kind, { elapsed: now - since, sinceChange, busy: activity?.busy ?? false })) return;
    } else {
      since = Date.now();
    }
    await sleep(SETTLE_POLL_MS, signal);
  }
};

// The action, in the frame its element is in. Tabs, screenshots and the site's tools are the
// loop's own (runBrowserAgent).
export const execute = async (
  tabId: number,
  action: AgentAction,
  element: PageElement | undefined,
  files?: { name: string; dataUrl: string }[]
): Promise<Pick<AgentStep, 'status' | 'error'>> => {
  try {
    if (action.kind === 'navigate') {
      await chrome.tabs.update(tabId, { url: action.url! });
      return { status: 'done' };
    }
    if (action.kind === 'back') {
      // Chrome finds nothing to go back to when the page was left without the user's gesture, as
      // after the agent's own clicks. The page's history still goes there.
      await chrome.tabs
        .goBack(tabId)
        .catch(() => chrome.scripting.executeScript({ target: { tabId }, func: () => history.back() }));
      return { status: 'done' };
    }
    // The time is settle's, which ends it early if the page answers.
    if (action.kind === 'wait') return { status: 'done' };
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [element?.frameId ?? 0] },
      func: performAction,
      args: [element?.frameRef !== undefined ? { ...action, ref: element.frameRef } : action, files ?? []],
    });
    const result = injection?.result as { ok: boolean; error?: AgentStep['error'] } | undefined;
    if (!result) return { status: 'failed', error: 'failed' };
    return result.ok ? { status: 'done' } : { status: 'failed', error: result.error ?? 'failed' };
  } catch (error) {
    debugLog('Browser agent: action failed', error);
    // A frame that went away since the page was read.
    return { status: 'failed', error: element?.frameId ? 'not_found' : 'unreachable' };
  }
};

const SHOT_LEFT_OUT = '(screenshot left out)';

// The conversation the model reads: earlier pages keep only their address, and earlier
// screenshots go, so the request doesn't grow with every turn.
const forgetOlderPages = (messages: BaseMessage[]) => {
  for (const message of messages) {
    if (!(message instanceof HumanMessage) || typeof message.content === 'string') continue;
    if (message.content.every((part) => part.type === 'text')) continue;
    const text = message.content
      .map((part) => (part.type === 'text' ? (part as { text: string }).text : ''))
      .join('\n');
    message.content = `${text}\n${SHOT_LEFT_OUT}`;
  }
  const pageTurns = messages.filter((m) => m instanceof HumanMessage && typeof m.content === 'string' && m.content.includes('\nURL: '));
  for (const turn of pageTurns.slice(0, -1)) {
    const text = turn.content as string;
    if (text.endsWith(LEFT_OUT)) continue;
    const start = text.indexOf('\nURL: ');
    const end = text.indexOf('\n', start + 1);
    turn.content = `${text.slice(0, start)}\n${text.slice(start + 1, end === -1 ? undefined : end)} ${LEFT_OUT}`;
  }
};

const askModel = async (
  modelPreset: ModelPreset,
  messages: BaseMessage[],
  signal: AbortSignal,
  reasoningEffort?: ModelOptions['reasoningEffort']
) => {
  const local = isLocalModel(modelPreset.modelName);
  // Each step is one small choice, made up to 100 times: High at most. A model that thinks first
  // gets the room the chat gives its thinking (lib/models.ts); the JSON alone fits in 4000.
  const effort = reasoningEffort && effortWithin(reasoningEffort, BASE_REASONING_EFFORTS);
  const thinks = effort !== undefined && effort !== 'low';
  const llm = getModelInstance({
    temperature: 0.2,
    ...(thinks ? {} : { maxTokens: 4000 }),
    streaming: local,
    reasoningEffort: effort,
    modelPreset,
    jsonSchema: BROWSER_AGENT_JSON_SCHEMA,
  });
  let response: AIMessage | AIMessageChunk | undefined;
  if (local) {
    for await (const chunk of await llm.stream(messages, { signal })) {
      response = response ? (response as AIMessageChunk).concat(chunk) : chunk;
    }
  } else {
    response = await llm.invoke(messages, { signal });
  }
  if (!response) return '';
  await trackTokenUsage(modelPreset, response);
  // Without the thinking a model may send along (Gemini's thoughts are text too), whose braces
  // would spoil the JSON.
  return chunkParts(response).text;
};

// The latest turn is the user's (the page now); what the user adds goes with it, since providers
// want the turns to alternate. It goes before the page, which forgetOlderPages cuts from older
// turns, so the model still has it later.
const PAGE_START = /(?<=^|\n)The page now:\n/;
const addToLastTurn = (messages: BaseMessage[], text: string) => {
  const withText = (content: string) => {
    const at = content.search(PAGE_START);
    return at === -1 ? `${content}\n\n${text}` : `${content.slice(0, at)}${text}\n\n${content.slice(at)}`;
  };
  const last = messages[messages.length - 1];
  if (!(last instanceof HumanMessage)) {
    messages.push(new HumanMessage(text));
  } else if (typeof last.content === 'string') {
    last.content = withText(last.content);
  } else {
    const page = last.content.findIndex((part) => part.type === 'text' && PAGE_START.test((part as { text: string }).text));
    last.content =
      page === -1
        ? [...last.content, { type: 'text', text }]
        : last.content.map((part, index) =>
            index === page ? { ...part, text: withText((part as { text: string }).text) } : part
          );
  }
};

// The user's next words from the chat box, or null once `ms` pass or the run stops. The worker is
// kept awake meanwhile: Chrome stops one 30 s after its last extension call.
const nextSaid = (run: Steering, ms: number, signal: AbortSignal) =>
  new Promise<string | null>((resolve) => {
    if (run.said.length) return resolve(run.said.shift()!);
    const awake = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
    const timer = setTimeout(() => finish(null), ms);
    const finish = (text: string | null) => {
      clearTimeout(timer);
      clearInterval(awake);
      run.wake = undefined;
      resolve(text);
    };
    run.wake = () => finish(run.said.shift() ?? null);
    signal.addEventListener('abort', () => finish(null), { once: true });
  });

export async function runBrowserAgent({
  messageId,
  task,
  images = [],
  history,
  lang,
  labels,
  autoApprove,
  reasoningEffort,
  modelPreset,
  canSee,
  port,
  signal: panelSignal,
}: {
  messageId: string;
  task: string;
  // The images the user gave with the task, as data URLs, which it may upload.
  images?: string[];
  // The chat before the task, as the model reads it.
  history: BaseMessage[];
  lang: Language;
  labels?: AgentLabels;
  // Act without the approval card (a password or card field is still refused).
  autoApprove?: boolean;
  reasoningEffort?: ModelOptions['reasoningEffort'];
  modelPreset: ModelPreset;
  // The model reads images, so it may look at the tab.
  canSee: boolean;
  port: chrome.runtime.Port;
  signal: AbortSignal;
}) {
  const run: AgentRun = { steps: [] };
  const publish = () => {
    try {
      port.postMessage({ agent: run });
    } catch {
      // The panel went away; the run stops with its signal.
    }
    db.messages.update(messageId, { agentRun: structuredClone(run) }).catch((err) => {
      errorLog('Failed to save the browser agent run:', err);
    });
  };
  const end = (outcome: AgentOutcome) => {
    run.outcome = outcome;
    publish();
  };

  const userTab = await activeWebTab();
  if (!userTab) return end('unavailable');
  const stored = await chrome.storage.local
    .get([STORAGE_AGENT_ALLOWED_SITES, STORAGE_AGENT_SITE_TIPS, STORAGE_AGENT_BACKGROUND])
    .catch(() => ({}) as Record<string, unknown>);
  // Sites the user allowed for good, and those this run may work on: the one it starts on, and
  // those of its plan or allowed on the way.
  const alwaysAllowed = new Set<string>(
    Array.isArray(stored[STORAGE_AGENT_ALLOWED_SITES]) ? (stored[STORAGE_AGENT_ALLOWED_SITES] as string[]) : []
  );
  const allowed = new Set<string>([siteOf(userTab.url!)]);
  const permitted = (site: string) => !site || allowed.has(site) || alwaysAllowed.has(site);
  const tips = (stored[STORAGE_AGENT_SITE_TIPS] ?? {}) as AgentSiteTips;
  const tipsGiven = new Set<string>();
  // Behind the user's tab: the run works in a copy of it, in the background, so the user keeps
  // theirs. A tab in the background can't be captured, so the run works from the text.
  const behind = stored[STORAGE_AGENT_BACKGROUND] === true;
  const seeing = canSee && !behind;
  let groupId: number | undefined;

  const controller = new AbortController();
  const signal = controller.signal;
  panelSignal.addEventListener('abort', () => controller.abort(), { once: true });
  if (panelSignal.aborted) controller.abort();

  let tabId = userTab.id;
  if (behind) {
    const copy = await chrome.tabs
      .create({ url: userTab.url, active: false, index: userTab.index + 1, windowId: userTab.windowId, openerTabId: userTab.id })
      .catch(() => null);
    if (copy?.id === undefined) return end('unavailable');
    tabId = copy.id;
    run.tabId = tabId;
    groupId = await groupTab(tabId, undefined, labels?.group);
    await settle(tabId, 0, 'navigate', signal);
  }
  run.host = new URL(userTab.url!).host;

  runs.set(tabId, controller);
  const said: Steering = { said: [] };
  steering.set(port, said);
  // The tabs the agent works in, by their number: the first, those it opened, and those a link
  // opened (it follows a link that opens in a new tab there).
  const tabs = [tabId];
  let openedTabId: number | null = null;
  const onCreated = (created: chrome.tabs.Tab) => {
    if (created.openerTabId === tabId && created.id !== undefined) openedTabId = created.id;
  };
  chrome.tabs.onCreated.addListener(onCreated);
  const moveTo = async (next: number) => {
    await overlay(tabId, labels, null);
    runs.delete(tabId);
    tabId = next;
    runs.set(tabId, controller);
    if (!tabs.includes(next)) tabs.push(next);
    if (behind) {
      // The panel's Take over goes to the tab the run is in now.
      run.tabId = next;
      publish();
      groupId = await groupTab(next, groupId, labels?.group);
    }
    await settle(tabId, 0, 'switch_tab', signal);
    const moved = await chrome.tabs.get(tabId).catch(() => null);
    if (moved?.url) run.host = new URL(moved.url).host;
  };
  const tabList = async (): Promise<AgentTab[]> => {
    if (tabs.length < 2) return [];
    const found = await Promise.all(tabs.map((id) => chrome.tabs.get(id).catch(() => null)));
    return found.flatMap((open, index) =>
      open ? [{ number: index + 1, title: open.title ?? '', url: open.url ?? '', current: tabs[index] === tabId }] : []
    );
  };
  const read = async () => {
    const page = await snapshotOf(tabId);
    // The site the panel and its cards name is the one the run is on now, after a link or navigate.
    if (page) run.host = new URL(page.url).host;
    return page && { ...page, tabs: await tabList() };
  };
  // The page as the model reads it, after the tips the user kept for its site the first time
  // there (before the page, which forgetOlderPages cuts from older turns).
  const pageNow = (page: PageSnapshot) => {
    const site = siteOf(page.url);
    const kept = tips[site] ?? [];
    const given = !kept.length || tipsGiven.has(site);
    tipsGiven.add(site);
    const tipLines = given ? '' : `Tips the user kept for ${site}:\n${kept.map((tip) => `- ${tip}`).join('\n')}\n\n`;
    return `${tipLines}The page now:\n${formatSnapshot(page)}`;
  };
  // The last screenshot's scale, for a click at one of its points.
  let shotScale: number | null = null;
  // What was done, by actionSignature, and whether the agent was told it repeats itself.
  const tried: string[] = [];
  let warned = false;

  // Until the user answers a card. The worker is kept awake meanwhile.
  const approval = (step: AgentStep) =>
    new Promise<Approval>((resolve) => {
      const awake = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
      const done = (answer: Approval) => {
        clearInterval(awake);
        approvals.delete(step.id);
        resolve(answer);
      };
      approvals.set(step.id, done);
      if (signal.aborted) return done(false);
      signal.addEventListener('abort', () => done(false), { once: true });
    });
  // The card for a step: it waits, then runs or is declined.
  const askToAllow = async (step: AgentStep) => {
    Object.assign(step, { status: 'awaiting', approval: true });
    publish();
    await overlay(tabId, labels, true);
    const answer = await approval(step);
    if (!signal.aborted) await overlay(tabId, labels, false);
    return answer;
  };
  // The user's turn, until they hand back from the panel or the pill (or `until` settles), type in
  // the chat box (the next turn reads it), or TURN_TIMEOUT_MS pass.
  const userTurn = (step: AgentStep, until?: Promise<boolean>) =>
    new Promise<'back' | 'cancel' | 'said' | 'timeout'>((resolve) => {
      let over = false;
      const awake = setInterval(() => void chrome.runtime.getPlatformInfo(), 20_000);
      const timer = setTimeout(() => done('timeout'), TURN_TIMEOUT_MS);
      const done = (how: 'back' | 'cancel' | 'said' | 'timeout') => {
        if (over) return;
        over = true;
        clearTimeout(timer);
        clearInterval(awake);
        approvals.delete(step.id);
        if (turns.get(tabId) === step.id) turns.delete(tabId);
        said.wake = undefined;
        resolve(how);
      };
      approvals.set(step.id, (answer) => done(answer ? 'back' : 'cancel'));
      turns.set(tabId, step.id);
      if (said.said.length) return done('said');
      said.wake = () => done('said');
      until?.then((ok) => done(ok ? 'back' : 'cancel'));
      signal.addEventListener('abort', () => done('cancel'), { once: true });
    });

  try {
    let snapshot = await read();
    if (!snapshot) return end('unavailable');
    await overlay(tabId, labels, false);
    publish();

    const upload = images.length
      ? `\n\nImages you can upload: ${images.map((image, index) => `(${index + 1}) ${imageName(image, index + 1)}`).join(', ')}`
      : '';
    const messages: BaseMessage[] = [
      new SystemMessage(getBrowserAgentPrompt(lang, seeing, images.length > 0)),
      ...history,
      new HumanMessage(`Task: ${task}${upload}\n\n${pageNow(snapshot)}`),
    ];
    let unreadable = 0;
    let modelMs = 0;
    for (let turn = 0; turn < BROWSER_AGENT_MAX_STEPS; turn++) {
      if (signal.aborted) return end('stopped');
      // What the user typed meanwhile, for this turn on.
      const added = said.said.splice(0);
      for (const text of added) {
        run.steps.push({ id: crypto.randomUUID(), action: { kind: 'steer', text }, status: 'done' });
        addToLastTurn(messages, `The user adds, while you work: ${JSON.stringify(text)}`);
      }
      if (added.length) publish();

      const asked = Date.now();
      const answer = await askModel(modelPreset, messages, signal, reasoningEffort);
      modelMs += Date.now() - asked;
      if (signal.aborted) return end('stopped');
      const reply = parseAgentReply(answer);
      if (!reply) {
        // A reply that isn't the JSON asked for gets two more chances.
        if (++unreadable > 2) return end('failed');
        messages.push(new AIMessage(answer || ' '), new HumanMessage('Answer with only the JSON object described, one action.'));
        continue;
      }
      unreadable = 0;
      messages.push(
        new AIMessage(
          JSON.stringify({
            thought: reply.thought,
            ...reply.action,
            ...(reply.then.length ? { then: reply.then } : {}),
            sensitive: reply.sensitive,
          })
        )
      );

      const { action } = reply;
      if (action.kind === 'finish') {
        const content = action.text ?? '';
        if (content) {
          port.postMessage({ delta: content });
          await db.messages.update(messageId, { content });
        }
        // A tip worth keeping comes from a run that had to look around.
        const site = siteOf(snapshot.url);
        if (reply.tip && site && run.steps.length >= 3 && !(tips[site] ?? []).includes(reply.tip)) {
          run.tip = { host: site, text: reply.tip };
        }
        return end('finished');
      }

      const element = action.ref !== undefined ? snapshot.elements.find((e) => e.ref === action.ref) : undefined;
      const tool = action.kind === 'tool' ? snapshot.tools?.find((t) => t.name === action.name) : undefined;
      const timing: NonNullable<AgentStep['timing']> = { model: modelMs };
      modelMs = 0;
      const step: AgentStep = {
        id: crypto.randomUUID(),
        action,
        target: action.kind === 'tool' ? action.name : elementLabel(element),
        ...(reply.thought ? { thought: reply.thought } : {}),
        status: 'running',
        timing,
      };
      run.steps.push(step);

      // A question: the run waits for the answer from the chat box.
      if (action.kind === 'ask') {
        step.status = 'awaiting';
        publish();
        await overlay(tabId, labels && { ...labels, waiting: labels.asking }, true);
        const answered = await nextSaid(said, ASK_TIMEOUT_MS, signal);
        if (signal.aborted) return end('stopped');
        if (answered === null) {
          step.status = 'denied';
          return end('unanswered');
        }
        Object.assign(step, { status: 'done', reply: answered });
        publish();
        await overlay(tabId, labels, false);
        snapshot = (await read()) ?? snapshot;
        messages.push(new HumanMessage(`The user answers: ${JSON.stringify(answered)}\n\n${pageNow(snapshot)}`));
        continue;
      }

      // The user's turn: they do their part on the page (handoff), or click what the agent couldn't
      // find (point), and the run reads the page again.
      if (action.kind === 'handoff' || action.kind === 'point') {
        step.status = 'awaiting';
        publish();
        if (behind) {
          // The user can only do their part in a tab they see.
          await chrome.tabs.update(tabId, { active: true }).catch(() => null);
        }
        const what = labels?.[action.kind === 'handoff' ? 'handoff' : 'point'];
        const turnLabels = labels && { ...labels, waiting: what ? `${what}: ${action.text}` : action.text! };
        await overlay(tabId, turnLabels, true, action.kind === 'handoff');
        // Signing in loads another page, which drops the pill and its hand-back button; it comes back.
        const reshow = (updated: number, change: chrome.tabs.TabChangeInfo) => {
          if (updated === tabId && change.status === 'complete') void overlay(tabId, turnLabels, true, true);
        };
        if (action.kind === 'handoff') chrome.tabs.onUpdated.addListener(reshow);
        const picking =
          action.kind === 'point'
            ? chrome.scripting
                .executeScript({ target: { tabId, frameIds: [0] }, func: pickElement })
                .then(([injection]) => injection?.result === true)
                .catch(() => false)
            : undefined;
        const how = await userTurn(step, picking);
        chrome.tabs.onUpdated.removeListener(reshow);
        if (picking && how !== 'back') {
          await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: cancelPick }).catch(() => []);
        }
        if (signal.aborted) return end('stopped');
        if (how === 'timeout') {
          step.status = 'denied';
          return end('not_handed_back');
        }
        // What they typed instead goes to the next turn, with the page as it is now.
        Object.assign(step, { status: how === 'cancel' ? 'denied' : 'done' });
        publish();
        await overlay(tabId, labels, false);
        snapshot = (await read()) ?? snapshot;
        messages.push(
          new HumanMessage(
            `${how === 'said' ? 'The user answers in the chat instead.' : actionResult(step)}\n\n${pageNow(snapshot)}`
          )
        );
        continue;
      }

      // The same action on a page that didn't change, a third time: it is told once, then stopped.
      const signature = actionSignature(action, snapshot);
      const repeated = timesTried(tried, signature) >= 2;
      tried.push(signature);
      if (repeated && warned) {
        Object.assign(step, { status: 'failed', error: 'repeated' });
        return end('looping');
      }

      // A site new to the run needs the user's leave, before the agent goes there or acts on it.
      const site =
        action.kind === 'navigate' || action.kind === 'open_tab'
          ? siteOf(action.url!)
          : ACTS_ON_PAGE.includes(action.kind)
            ? siteOf(snapshot.url)
            : '';
      if (repeated) {
        warned = true;
        Object.assign(step, { status: 'failed', error: 'repeated' });
      } else if (action.ref !== undefined && !element) {
        Object.assign(step, { status: 'failed', error: 'not_found' });
      } else if (action.kind === 'type' && element?.secret) {
        Object.assign(step, { status: 'failed', error: 'secret_field' });
      } else if (action.kind === 'tool' && !tool) {
        Object.assign(step, { status: 'failed', error: 'no_tool' });
      } else if (action.kind === 'switch_tab' && !tabs[action.tab! - 1]) {
        Object.assign(step, { status: 'failed', error: 'no_tab' });
      } else if (action.kind === 'click_at' && shotScale === null) {
        Object.assign(step, { status: 'failed', error: 'no_screenshot' });
      } else if ((action.kind === 'look' || action.kind === 'click_at') && !seeing) {
        Object.assign(step, { status: 'failed', error: 'failed' });
      } else if (action.kind === 'upload' && !images[action.file! - 1]) {
        Object.assign(step, { status: 'failed', error: 'no_file' });
      } else {
        if (action.kind === 'plan') {
          // Approved once, its sites need no more asking this run.
          const answer = autoApprove ? true : await askToAllow(step);
          if (signal.aborted) {
            step.status = 'denied';
            return end('stopped');
          }
          if (autoApprove) step.autoApproved = true;
          if (answer) for (const planned of action.sites ?? []) allowed.add(planned);
          step.status = answer ? 'done' : 'denied';
        } else if (!permitted(site)) {
          step.site = site;
          const answer = autoApprove ? true : await askToAllow(step);
          if (signal.aborted) {
            step.status = 'denied';
            return end('stopped');
          }
          if (autoApprove) step.autoApproved = true;
          if (answer === 'always') {
            alwaysAllowed.add(site);
            step.alwaysAllowed = site;
            // Added to the list as it is now, which Settings or another run may have changed.
            const now = await chrome.storage.local.get(STORAGE_AGENT_ALLOWED_SITES).catch(() => ({}) as Record<string, unknown>);
            const kept = Array.isArray(now[STORAGE_AGENT_ALLOWED_SITES]) ? (now[STORAGE_AGENT_ALLOWED_SITES] as string[]) : [];
            await chrome.storage.local
              .set({ [STORAGE_AGENT_ALLOWED_SITES]: [...new Set([...kept, site])] })
              .catch(() => {});
          }
          if (answer) {
            allowed.add(site);
            // The card asked about the site; one for the action itself may follow.
            delete step.site;
          }
          step.status = answer ? 'running' : 'denied';
        }
        if (step.status === 'running' && needsApproval(action, element, reply.sensitive, tool)) {
          // Don't ask covers actions on the page; sending the user's image to a site still asks.
          if (autoApprove && action.kind !== 'upload') {
            step.autoApproved = true;
          } else {
            const answer = await askToAllow(step);
            if (signal.aborted) {
              step.status = 'denied';
              return end('stopped');
            }
            step.status = answer ? 'running' : 'denied';
          }
        }
      }
      publish();

      // What goes to the model with the page: a tool's output, a screenshot.
      let output = '';
      let shot: Awaited<ReturnType<typeof screenshot>> = null;
      // The actions after it on the same page, as many as were done, and why the rest weren't.
      const more: AgentStep[] = [];
      let stoppedBecause = '';
      if (step.status === 'running') {
        openedTabId = null;
        const acting = Date.now();
        const frameId = tool?.frameId ?? element?.frameId ?? 0;
        await activityOf(tabId, frameId, true);
        if (action.kind === 'look') {
          shot = await screenshot(tabId);
          shotScale = shot?.scale ?? shotScale;
          Object.assign(step, shot ? { status: 'done' } : { status: 'failed', error: 'not_visible' });
        } else if (action.kind === 'click_at') {
          const visible = (await chrome.tabs.get(tabId).catch(() => null))?.active;
          const [injection] = visible
            ? await chrome.scripting
                .executeScript({
                  target: { tabId, frameIds: [0] },
                  func: clickAt,
                  args: [{ x: action.x! / shotScale!, y: action.y! / shotScale! }],
                })
                .catch(() => [])
            : [];
          const result = injection?.result as { ok: boolean; error?: AgentStep['error'] } | undefined;
          Object.assign(
            step,
            !visible
              ? { status: 'failed', error: 'not_visible' }
              : result?.ok
                ? { status: 'done' }
                : { status: 'failed', error: result?.error ?? 'failed' }
          );
        } else if (action.kind === 'open_tab') {
          const opened = await chrome.tabs
            .create({ url: action.url!, openerTabId: tabId, active: !behind })
            .catch(() => null);
          if (opened?.id === undefined) {
            Object.assign(step, { status: 'failed', error: 'unreachable' });
          } else {
            openedTabId = null;
            await moveTo(opened.id);
            step.status = 'done';
          }
        } else if (action.kind === 'switch_tab') {
          const next = tabs[action.tab! - 1];
          // Behind the user's tab, it moves without showing the tab.
          const shown = behind
            ? await chrome.tabs.get(next).catch(() => null)
            : await chrome.tabs.update(next, { active: true }).catch(() => null);
          if (!shown) {
            Object.assign(step, { status: 'failed', error: 'no_tab' });
          } else {
            await moveTo(next);
            step.status = 'done';
          }
        } else if (action.kind === 'tool') {
          const [injection] = await chrome.scripting
            .executeScript({
              target: { tabId, frameIds: [tool!.frameId] },
              world: 'MAIN',
              func: runWebMcpTool,
              args: [tool!.name, JSON.stringify(action.input ?? {})],
            })
            .catch(() => []);
          const result = injection?.result as { ok: boolean; output?: string; error?: string } | undefined;
          if (result?.ok) {
            step.status = 'done';
            output = `Tool output:\n${(result.output ?? '').slice(0, TOOL_OUTPUT_CHARS)}`;
          } else {
            Object.assign(step, { status: 'failed', error: result?.error === 'no_tool' ? 'no_tool' : 'failed' });
            if (result?.error && result.error !== 'no_tool') output = `Tool error: ${result.error}`;
          }
        } else if (action.kind === 'wait' && action.text) {
          const [injection] = await chrome.scripting
            .executeScript({ target: { tabId, frameIds: [0] }, func: waitForText, args: [action.text, WAIT_FOR_TEXT_MS] })
            .catch(() => []);
          Object.assign(step, injection?.result === true ? { status: 'done' } : { status: 'failed', error: 'timed_out' });
        } else {
          const files =
            action.kind === 'upload'
              ? [{ name: imageName(images[action.file! - 1], action.file!), dataUrl: images[action.file! - 1] }]
              : undefined;
          Object.assign(step, await execute(tabId, action, element, files));
        }
        publish();
        const settling = Date.now();
        timing.act = settling - acting;
        // Moving to a tab has settled already, and a wait for a text has waited.
        if (!['look', 'open_tab', 'switch_tab'].includes(action.kind) && !(action.kind === 'wait' && action.text)) {
          await settle(tabId, frameId, action.kind, signal);
        }
        if (openedTabId !== null) await moveTo(openedTabId);
        timing.settle = Date.now() - settling;

        // The rest of a batch, on the same page by the same numbers, until one fails, needs the
        // user's go-ahead or the page moves on.
        const onTab = tabId;
        for (const next of reply.then) {
          const last = more[more.length - 1] ?? step;
          const nextElement = next.ref !== undefined ? snapshot.elements.find((e) => e.ref === next.ref) : undefined;
          const now = await chrome.tabs.get(tabId).catch(() => null);
          if (signal.aborted) break;
          if (last.status !== 'done') stoppedBecause = 'the one before failed';
          else if (tabId !== onTab || !now || now.url !== snapshot.url) stoppedBecause = 'the page changed';
          else if (next.ref !== undefined && !nextElement) stoppedBecause = 'its number is not on the page';
          else if (next.kind === 'type' && nextElement?.secret) stoppedBecause = 'it is a sensitive field';
          else if (!permitted(siteOf(snapshot.url))) stoppedBecause = 'the site needs the user’s leave';
          else if (needsApproval(next, nextElement, reply.sensitive) && !autoApprove) stoppedBecause = 'it needs the user’s go-ahead; send it on its own';
          if (stoppedBecause) break;
          const extra: AgentStep = {
            id: crypto.randomUUID(),
            action: next,
            target: elementLabel(nextElement),
            status: 'running',
            ...(needsApproval(next, nextElement, reply.sensitive) ? { autoApproved: true } : {}),
          };
          run.steps.push(extra);
          more.push(extra);
          publish();
          const nextFrame = nextElement?.frameId ?? 0;
          await activityOf(tabId, nextFrame, true);
          Object.assign(extra, await execute(tabId, next, nextElement));
          publish();
          await settle(tabId, nextFrame, next.kind, signal);
          if (openedTabId !== null) await moveTo(openedTabId);
        }
      }
      if (signal.aborted) return end('stopped');

      // A page that is still being replaced has nothing to read for a moment.
      const reading = Date.now();
      snapshot = (await read()) ?? (await sleep(1000, signal), await read());
      timing.read = Date.now() - reading;
      if (!snapshot) return end('unavailable');
      await overlay(tabId, labels, false);
      forgetOlderPages(messages);
      const results = [
        actionResult(step),
        ...more.map(
          (extra, index) =>
            `Then ${index + 2} (${extra.action.kind}${extra.action.ref !== undefined ? ` [${extra.action.ref}]` : ''}): ${actionResult(extra).replace(/^Result: /, '')}`
        ),
        ...(reply.then.length > more.length
          ? [
              `The other ${reply.then.length - more.length} actions in "then" were not done (${
                stoppedBecause || (step.status === 'done' ? 'the run stopped' : 'the first one was not done')
              }). Decide again from the page below.`,
            ]
          : []),
        output,
      ];
      const text = `${results.filter(Boolean).join('\n')}${
        shot ? `\nThe screenshot (${shot.width}x${shot.height} px) is attached.` : ''
      }\n\n${pageNow(snapshot)}`;
      messages.push(
        new HumanMessage(
          shot
            ? {
                content: [
                  { type: 'text', text },
                  formatImageForProvider(shot.dataUrl, modelPreset.modelName, modelPreset.connectionMode),
                ],
              }
            : text
        )
      );
    }
    return end('max_steps');
  } catch (error) {
    if (signal.aborted) return end('stopped');
    throw error;
  } finally {
    chrome.tabs.onCreated.removeListener(onCreated);
    steering.delete(port);
    runs.delete(tabId);
    turns.delete(tabId);
    for (const step of run.steps) approvals.delete(step.id);
    await overlay(tabId, labels, null);
  }
}
