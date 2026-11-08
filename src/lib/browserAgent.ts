// The browser agent (services/background/browserAgentHandler.ts): the chat model works the user's
// tab one action at a time. Each turn it reads the page (browserAgentPage.ts) as its visible text
// and numbered elements, and answers with one action as JSON. An action that sends, deletes, pays
// or can't be undone waits for the user's go-ahead in the panel; a password or card field is
// never typed in. Pure, for the background, the panel and the tests.

export type AgentActionKind =
  | 'click'
  | 'type'
  | 'select'
  | 'scroll'
  | 'navigate'
  | 'back'
  | 'wait'
  | 'finish'
  // A question to the user, who answers in the chat box.
  | 'ask'
  // A screenshot of the tab, its controls marked with their numbers, for models that see images.
  | 'look'
  // A click at a point of the last screenshot, for what has no number.
  | 'click_at'
  | 'open_tab'
  | 'switch_tab'
  // A tool the site offers through WebMCP (PageSnapshot.tools).
  | 'tool'
  // A key ("key") on control [ref] or on what has focus: Escape closes a popup, arrows move in a list.
  | 'press'
  // The pointer over control [ref], for a menu that opens on hover.
  | 'hover'
  // An image from the chat into file field [ref] (or the drop zone it is), by its number ("file").
  | 'upload'
  // The user's turn: they sign in, pass a CAPTCHA or fill in what the agent never types, then hand
  // back. "text" says what to do.
  | 'handoff'
  // The user points at what "text" names by clicking it on the page; it gets a number.
  | 'point'
  // Before the work: what the agent will do and on which sites ("sites"), approved once.
  | 'plan'
  // Not the model's: what the user said while the agent worked, shown among the steps.
  | 'steer';

export type AgentAction = {
  kind: AgentActionKind;
  ref?: number;
  // What to type, the option to pick, the answer to the user (finish), the question (ask) or what
  // the user said (steer).
  text?: string;
  url?: string;
  direction?: 'up' | 'down';
  // Press Enter after typing.
  submit?: boolean;
  // click_at: the point in the screenshot, in its pixels.
  x?: number;
  y?: number;
  // switch_tab: the tab's number in the list of the agent's tabs.
  tab?: number;
  // tool: the tool's name, and its input as its schema asks.
  name?: string;
  input?: Record<string, unknown>;
  // press: the key, as KeyboardEvent.key names it ("Escape", "Enter", "ArrowDown").
  key?: string;
  // upload: the image's number among those the user gave with the task.
  file?: number;
  // plan: the sites it will work on, by host.
  sites?: string[];
};

// `then`: more actions on the same page, done in order after `action` until one fails, needs the
// user's go-ahead or the page changes. `tip`: with finish, how this site does something it had to
// search for, offered to the user to keep for next time.
export type AgentReply = { thought: string; action: AgentAction; sensitive: boolean; then: AgentAction[]; tip?: string };

export type PageElement = {
  ref: number;
  tag: string;
  role?: string;
  name: string;
  type?: string;
  value?: string;
  // A dropdown's choices.
  options?: string[];
  href?: string;
  checked?: boolean;
  disabled?: boolean;
  // A search box: what is typed and submitted there only searches.
  search?: boolean;
  // A password, card number or one-time code field.
  secret?: boolean;
  // Below the part of the page on screen.
  below?: boolean;
  // In one of the page's frames (PageSnapshot.frames): the frame, and the element's number there.
  frameId?: number;
  frameRef?: number;
  // What the user clicked when the agent asked them to point (point).
  picked?: boolean;
};

// A tool the page registered with WebMCP (document.modelContext), in one of its frames.
export type WebMcpTool = {
  name: string;
  description: string;
  // Its input's JSON schema, as a string.
  schema: string;
  // The site says it only reads, or that it has consequences (which need the user's go-ahead).
  readOnly?: boolean;
  consequential?: boolean;
  frameId: number;
};

// A tab the agent works in: the one it started in, and those it opened.
export type AgentTab = { number: number; title: string; url: string; current: boolean };

export type PageSnapshot = {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  scroll: { y: number; height: number; viewport: number };
  // The page's frames with something in them, their elements after the page's own.
  frames?: { frameId: number; url: string; text: string }[];
  // A CAPTCHA's frame is on the page, left out for the user to solve.
  challenge?: boolean;
  tools?: WebMcpTool[];
  tabs?: AgentTab[];
};

export type AgentStepStatus = 'running' | 'done' | 'failed' | 'awaiting' | 'denied';

export type AgentStepError =
  | 'not_found'
  | 'secret_field'
  | 'not_select'
  | 'no_option'
  | 'bad_url'
  | 'unreachable'
  // look, click_at: the tab isn't the one on screen, or there is no screenshot to point in.
  | 'not_visible'
  | 'no_screenshot'
  | 'no_tab'
  | 'no_tool'
  // It was done the same way on the same page twice already.
  | 'repeated'
  // upload: no image by that number, or no file field there.
  | 'no_file'
  // wait: the text it waited for didn't show.
  | 'timed_out'
  | 'failed';

// One action as the panel shows it.
export type AgentStep = {
  id: string;
  action: AgentAction;
  // The element acted on, as the page names it.
  target?: string;
  thought?: string;
  status: AgentStepStatus;
  // It waits, or waited, for the user's go-ahead.
  approval?: boolean;
  // It would have waited for the go-ahead, but the user turned asking off for the question.
  autoApproved?: boolean;
  error?: AgentStepError;
  // ask: the user's answer.
  reply?: string;
  // The go-ahead it waits for is to work on this site, new to the run.
  site?: string;
  // The site the user allowed for good on this step's card.
  alwaysAllowed?: string;
  // How long it took, in ms: the model's answer (with its retries), the action, the wait for the
  // page, and reading the page after. Kept for looking into a slow run; the panel doesn't show it.
  timing?: { model: number; act?: number; settle?: number; read?: number };
};

// looping: it kept doing the same thing on a page that didn't change. unanswered: its question
// waited too long. not_handed_back: the user's turn (handoff, point) waited too long.
export type AgentOutcome =
  | 'finished'
  | 'stopped'
  | 'max_steps'
  | 'unavailable'
  | 'failed'
  | 'looping'
  | 'unanswered'
  | 'not_handed_back';

// A browser agent answer's record, kept with the message. tabId: the tab it worked in behind the
// user's (STORAGE_AGENT_BACKGROUND). tip: what it offered to keep for the site, and what the user did.
export type AgentRun = {
  host?: string;
  steps: AgentStep[];
  outcome?: AgentOutcome;
  tabId?: number;
  tip?: { host: string; text: string; state?: 'saved' | 'dismissed' };
};

// What the agent's pill on the page says, in the panel's language.
// waiting: for the go-ahead; asking: for the answer to its question; handoff and point: the
// user's turn, ended with `resume`; group: the tab group of a run behind the user's tab.
export type AgentLabels = {
  working: string;
  waiting: string;
  asking: string;
  stop: string;
  handoff?: string;
  point?: string;
  resume?: string;
  group?: string;
};

// Site tips the user kept (STORAGE_AGENT_SITE_TIPS), by site, a few each.
export type AgentSiteTips = Record<string, string[]>;
export const MAX_SITE_TIPS = 5;
const MAX_TIP = 200;

// A site as the agent's permissions and tips know it: the host without "www.".
export const siteOf = (address: string) => {
  try {
    return new URL(address).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// The site's tips with a new one, the oldest going past MAX_SITE_TIPS.
export const withSiteTip = (tips: AgentSiteTips, site: string, tip: string): AgentSiteTips => {
  const text = tip.trim().slice(0, MAX_TIP);
  const kept = (tips[site] ?? []).filter((old) => old !== text);
  return { ...tips, [site]: [...kept, text].slice(-MAX_SITE_TIPS) };
};

export const BROWSER_AGENT_MAX_STEPS = 100;

// What the page has done since an action, in ms. sinceChange is null while it hasn't changed.
export type PageActivity = { elapsed: number; sinceChange: number | null; busy: boolean };

// Whether the page can be read again after an action. One that changed and went quiet has answered.
// One that shows no change may still be fetching, so it gets the time actions always got. A spinner
// is waited for, and one that keeps moving (a ticker) or never stops spinning is read anyway.
export const pageSettled = (kind: AgentActionKind, { elapsed, sinceChange, busy }: PageActivity) => {
  const unchanged = kind === 'scroll' ? 500 : kind === 'wait' ? 2000 : 700;
  // A search box fetches its suggestions a moment after the box itself changed.
  if (kind === 'type' && elapsed < unchanged) return false;
  // A page that just loaded mostly came with what it shows; what moves on it after is its ads.
  if (elapsed >= (kind === 'navigate' ? 700 : Math.max(unchanged, 1000))) return true;
  if (busy) return false;
  return sinceChange === null ? elapsed >= unchanged : sinceChange >= 300;
};

// With browser control off, the chat model starts its answer with this line when the user asked
// it to act in their tab (prompts.ts). The background takes it off and the panel offers to turn
// browser control on and ask again.
export const BROWSER_CONTROL_MARK = '[[browser-control]]';

// Takes the mark off the start of a streamed answer. Only text that could still be the mark is
// held back; flush() gives it back when the answer ends there.
export const browserControlMarkSplitter = () => {
  let head: string | null = '';
  let afterMark = false;
  return {
    push(delta: string): { text: string; marked: boolean } {
      if (head === null) {
        // The line break after the mark.
        if (afterMark) {
          delta = delta.trimStart();
          if (delta) afterMark = false;
        }
        return { text: delta, marked: false };
      }
      head += delta;
      const start = head.trimStart();
      if (start.length < BROWSER_CONTROL_MARK.length && BROWSER_CONTROL_MARK.startsWith(start)) {
        return { text: '', marked: false };
      }
      const text = head;
      head = null;
      if (!start.startsWith(BROWSER_CONTROL_MARK)) return { text, marked: false };
      const rest = start.slice(BROWSER_CONTROL_MARK.length).trimStart();
      afterMark = !rest;
      return { text: rest, marked: true };
    },
    flush() {
      const text = head ?? '';
      head = null;
      return text;
    },
  };
};

const MAX_ELEMENTS = 160;
const MAX_NAME = 80;
const MAX_FRAME_ELEMENTS = 40;
const MAX_FRAME_TEXT = 1500;

const MAX_TOOLS = 20;
const MAX_SCHEMA = 600;

// What the model may answer with ('steer' is the user's).
const KINDS: AgentActionKind[] = [
  'click',
  'type',
  'select',
  'scroll',
  'navigate',
  'back',
  'wait',
  'finish',
  'ask',
  'look',
  'click_at',
  'open_tab',
  'switch_tab',
  'tool',
  'press',
  'hover',
  'upload',
  'handoff',
  'point',
  'plan',
];

// What may follow an action in `then`: what works on the same page by its numbers.
const BATCHABLE: AgentActionKind[] = ['click', 'type', 'select', 'press', 'hover', 'scroll'];
export const MAX_BATCH = 5;

// Keys the agent may press, as KeyboardEvent.key names them.
const KEYS = [
  'Enter',
  'Escape',
  'Tab',
  'Backspace',
  'Delete',
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'PageDown',
  'PageUp',
  'Home',
  'End',
  ' ',
];
const keyOf = (value: string) => {
  const wanted = value.trim().toLowerCase();
  if (wanted === 'space' || value === ' ') return ' ';
  if (wanted === 'esc') return 'Escape';
  if (wanted === 'return') return 'Enter';
  return KEYS.find((key) => key.toLowerCase() === wanted || key.toLowerCase() === `arrow${wanted}`);
};

// A web address as the model wrote it, made whole; anything but http(s) is refused.
export const agentUrl = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
};

// One action of the model's JSON, its fields read with `field`; null when it isn't a whole one.
const actionFrom = (kind: string, field: (name: string) => unknown): AgentAction | null => {
  if (!KINDS.includes(kind as AgentActionKind)) return null;
  const action: AgentAction = { kind: kind as AgentActionKind };
  const ref = Number(field('ref'));
  if (field('ref') !== undefined && field('ref') !== null && Number.isInteger(ref) && ref >= 0) action.ref = ref;
  const text = field('text');
  if (typeof text === 'string') action.text = text;
  const url = field('url');
  if (typeof url === 'string') action.url = url;
  const direction = field('direction');
  action.direction = direction === 'up' ? 'up' : 'down';
  if (field('submit') === true) action.submit = true;

  for (const axis of ['x', 'y'] as const) {
    const value = Number(field(axis));
    if (field(axis) !== undefined && Number.isFinite(value)) action[axis] = Math.round(value);
  }
  const tab = Number(field('tab'));
  if (Number.isInteger(tab) && tab >= 1) action.tab = tab;
  const name = field('name');
  if (typeof name === 'string' && name.trim()) action.name = name.trim();
  const input = field('input');
  if (input && typeof input === 'object' && !Array.isArray(input)) action.input = input as Record<string, unknown>;
  else if (typeof input === 'string' && input.trim()) {
    try {
      const parsedInput = JSON.parse(input);
      if (parsedInput && typeof parsedInput === 'object' && !Array.isArray(parsedInput)) action.input = parsedInput;
    } catch {
      return null;
    }
  }
  const key = field('key');
  if (typeof key === 'string') action.key = keyOf(key);
  const file = Number(field('file'));
  if (Number.isInteger(file) && file >= 1) action.file = file;
  const sites = field('sites');
  if (Array.isArray(sites)) {
    action.sites = [
      ...new Set(sites.filter((site): site is string => typeof site === 'string').map((site) => siteOf(agentUrl(site) ?? ''))),
    ]
      .filter(Boolean)
      .slice(0, 10);
  }

  if (['click', 'type', 'select', 'hover', 'upload'].includes(kind) && action.ref === undefined) return null;
  if ((kind === 'type' || kind === 'select') && action.text === undefined) return null;
  if (kind === 'navigate' || kind === 'open_tab') {
    const whole = agentUrl(action.url ?? action.text ?? '');
    if (!whole) return null;
    action.url = whole;
  }
  if (['ask', 'handoff', 'point', 'plan'].includes(kind) && !action.text?.trim()) return null;
  if (kind === 'click_at' && (action.x === undefined || action.y === undefined)) return null;
  if (kind === 'switch_tab' && action.tab === undefined) return null;
  if (kind === 'tool' && !action.name) return null;
  if (kind === 'press' && !action.key) return null;
  if (kind === 'upload' && action.file === undefined) return null;
  if (kind === 'tool') action.input ??= {};
  if (['finish', 'ask', 'handoff', 'point', 'plan'].includes(kind)) action.text = (action.text ?? '').trim();
  if (kind === 'wait') {
    // What to wait for, if anything.
    if (action.text?.trim()) action.text = action.text.trim();
    else delete action.text;
  }
  if (kind !== 'click_at') {
    delete action.x;
    delete action.y;
  }
  if (kind !== 'switch_tab') delete action.tab;
  if (kind !== 'tool') {
    delete action.name;
    delete action.input;
  }
  if (kind !== 'scroll') delete action.direction;
  if (kind !== 'press') delete action.key;
  if (kind !== 'upload') delete action.file;
  if (kind === 'plan') action.sites ??= [];
  else delete action.sites;
  return action;
};

const kindOf = (fields: Record<string, unknown>) => String(fields.type ?? fields.kind ?? fields.action ?? '').toLowerCase();

// The model's JSON, fenced or not, with its action flat or nested; null when it isn't one.
export const parseAgentReply = (answer: string): AgentReply | null => {
  const json = answer.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const nested = parsed.action && typeof parsed.action === 'object' ? (parsed.action as Record<string, unknown>) : null;
  const field = (name: string) => (nested && name in nested ? nested[name] : parsed[name]);
  const kind = nested ? kindOf(nested) : String(parsed.action ?? '').toLowerCase();
  const action = actionFrom(kind, field);
  if (!action) return null;

  // The actions after it on the same page, up to the first that isn't whole or can't follow.
  const then: AgentAction[] = [];
  if (BATCHABLE.includes(action.kind) && Array.isArray(parsed.then)) {
    for (const item of parsed.then.slice(0, MAX_BATCH - 1)) {
      if (!item || typeof item !== 'object') break;
      const fields = item as Record<string, unknown>;
      const next = actionFrom(kindOf(fields), (name) => fields[name]);
      if (!next || !BATCHABLE.includes(next.kind)) break;
      then.push(next);
    }
  }
  const thought = typeof parsed.thought === 'string' ? parsed.thought.trim() : '';
  const tip = action.kind === 'finish' && typeof parsed.tip === 'string' ? parsed.tip.trim().slice(0, MAX_TIP) : '';
  return {
    thought,
    action,
    sensitive: parsed.sensitive === true || field('sensitive') === true,
    then,
    ...(tip ? { tip } : {}),
  };
};

// Words of buttons that send, delete, pay or commit, in the languages Shizue speaks. Latin and
// Cyrillic words stand alone; Korean, Japanese, Chinese and Thai ones may be part of a word.
const COMMIT_WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[
    'send',
    'submit',
    'delete',
    'remove',
    'pay',
    'pay now',
    'purchase',
    'buy',
    'buy now',
    'order',
    'place order',
    'checkout',
    'check out',
    'confirm',
    'post',
    'publish',
    'tweet',
    'reply',
    'transfer',
    'subscribe',
    'unsubscribe',
    'book now',
    'reserve',
    'donate',
    'discard',
    'erase',
    'trash',
    'deactivate',
    'sign up',
    'enviar',
    'eliminar',
    'borrar',
    'comprar',
    'pagar',
    'publicar',
    'confirmar',
    'envoyer',
    'supprimer',
    'acheter',
    'payer',
    'commander',
    'publier',
    'confirmer',
    'senden',
    'löschen',
    'kaufen',
    'bezahlen',
    'bestellen',
    'veröffentlichen',
    'bestätigen',
    'invia',
    'elimina',
    'acquista',
    'paga',
    'conferma',
    'отправить',
    'удалить',
    'купить',
    'оплатить',
    'заказать',
    'опубликовать',
    'подтвердить',
    'gönder',
    'sil',
    'satın al',
    'öde',
    'gửi',
    'xóa',
    'mua',
    'thanh toán',
  ].join('|')})(?![\\p{L}\\p{N}])|보내|전송|제출|삭제|지우기|제거|결제|구매|구입|주문|송금|이체|게시|등록|올리기|탈퇴|해지|예약|신청|후원|기부|확인|送信|削除|購入|注文|支払|決済|投稿|確定|予約|发送|發送|提交|删除|刪除|购买|購買|支付|付款|下单|下單|发布|發布|确认|確認|ส่ง|ลบ|ซื้อ|ชำระ`,
  'iu'
);

export const looksCommitting = (label: string) => COMMIT_WORDS.test(label);

// Whether an action waits for the user's go-ahead: the model says it can't be undone, a button
// reads like one that sends, deletes or pays, or typed text is submitted anywhere but a search box.
// A site's own tool waits when the site says it has consequences, or, saying neither that nor
// that it only reads, when its name reads like one that sends, deletes or pays.
export const needsApproval = (
  action: AgentAction,
  element: PageElement | undefined,
  sensitive: boolean,
  tool?: WebMcpTool
) => {
  if (['scroll', 'wait', 'finish', 'ask', 'look', 'switch_tab', 'steer', 'hover', 'handoff', 'point', 'plan'].includes(action.kind)) {
    return false;
  }
  if (sensitive) return true;
  // The user's image goes to the site.
  if (action.kind === 'upload') return true;
  if (action.kind === 'click') return looksCommitting(`${element?.name ?? ''} ${element?.value ?? ''}`);
  if (action.kind === 'type') return Boolean(action.submit) && !element?.search;
  // Enter in a field submits it, and on a button presses it.
  if (action.kind === 'press') {
    if (action.key !== 'Enter' && action.key !== ' ') return false;
    if (element?.search) return false;
    return action.key === 'Enter' || looksCommitting(`${element?.name ?? ''} ${element?.value ?? ''}`);
  }
  if (action.kind === 'tool') {
    if (tool?.consequential) return true;
    return !tool?.readOnly && looksCommitting(`${tool?.name.replace(/[_-]+/g, ' ') ?? ''} ${action.name ?? ''}`);
  }
  return false;
};

// The same action on the same page: a page that changed (scrolled, loaded more, typed into) makes
// it another.
export const actionSignature = (action: AgentAction, snapshot: PageSnapshot) =>
  JSON.stringify([
    action.kind,
    action.ref,
    action.text,
    action.url,
    action.x,
    action.y,
    action.tab,
    action.name,
    action.input,
    action.key,
    snapshot.url,
    snapshot.scroll.y,
    snapshot.text.length,
    snapshot.elements.map((element) => `${element.name}=${element.value ?? ''}`).join('|'),
  ]);

// How many times the agent tried this already, among its last few actions.
export const REPEAT_WINDOW = 6;
export const timesTried = (signatures: string[], signature: string) =>
  signatures.slice(-REPEAT_WINDOW).filter((tried) => tried === signature).length;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// An element as the panel names it in a step: its label, or what kind of control it is.
export const elementLabel = (element: PageElement | undefined) =>
  element ? clip(element.name.trim() || element.value?.trim() || element.role || element.tag, 60) : undefined;

const elementLine = (element: PageElement) => {
  const kind = element.role || (element.tag === 'input' ? `input${element.type ? ` type=${element.type}` : ''}` : element.tag);
  const parts = [`[${element.ref}] ${kind}`];
  if (element.name) parts.push(JSON.stringify(clip(element.name, MAX_NAME)));
  if (element.value !== undefined && element.value !== '') parts.push(`value=${JSON.stringify(clip(element.value, 60))}`);
  if (element.options?.length) parts.push(`options: ${element.options.map((option) => JSON.stringify(clip(option, 40))).join(', ')}`);
  if (element.checked !== undefined) parts.push(element.checked ? 'checked' : 'unchecked');
  if (element.disabled) parts.push('disabled');
  if (element.secret) parts.push('(sensitive field: never type here)');
  if (element.picked) parts.push('(the user pointed at this)');
  if (element.href) parts.push(`→ ${clip(element.href, 100)}`);
  return parts.join(' ');
};

// A CAPTCHA's frame (reCAPTCHA, hCaptcha, Turnstile, Arkose): the agent never works it.
export const isChallengeFrame = (address: string) => {
  try {
    const { hostname, pathname } = new URL(address);
    const under = (domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);
    return (
      ((under('google.com') || under('recaptcha.net')) && pathname.startsWith('/recaptcha/')) ||
      under('hcaptcha.com') ||
      hostname === 'challenges.cloudflare.com' ||
      under('arkoselabs.com') ||
      under('funcaptcha.com')
    );
  } catch {
    return false;
  }
};

// The page with what its frames hold: their elements numbered after the page's, each keeping its
// frame and its number there. A CAPTCHA's frame is left out, and only noted.
export const withFrames = (page: PageSnapshot, frames: { frameId: number; snapshot: PageSnapshot }[]): PageSnapshot => {
  const elements = [...page.elements];
  let next = elements.reduce((max, element) => Math.max(max, element.ref), 0) + 1;
  const kept: NonNullable<PageSnapshot['frames']> = [];
  let challenge = false;
  for (const { frameId, snapshot } of frames) {
    if (isChallengeFrame(snapshot.url)) {
      challenge = true;
      continue;
    }
    if (!snapshot.elements.length && !snapshot.text.trim()) continue;
    kept.push({ frameId, url: snapshot.url, text: snapshot.text });
    for (const element of snapshot.elements.slice(0, MAX_FRAME_ELEMENTS)) {
      elements.push({ ...element, ref: next++, frameId, frameRef: element.ref });
    }
  }
  return { ...page, elements, ...(kept.length ? { frames: kept } : {}), ...(challenge ? { challenge } : {}) };
};

// Where a frame comes from: none for one written into the page (srcdoc, data:), whose address can be long.
const hostOf = (address: string) => {
  try {
    return new URL(address).host;
  } catch {
    return '';
  }
};

// The page as the model reads it each turn.
export const formatSnapshot = (snapshot: PageSnapshot) => {
  const { y, height, viewport } = snapshot.scroll;
  const scrollable = height > viewport + 4;
  const position = scrollable
    ? `${Math.round((y / Math.max(1, height - viewport)) * 100)}% down${y + viewport < height - 4 ? ', more below' : ', at the end'}`
    : 'the whole page is on screen';
  const own = snapshot.elements.filter((element) => element.frameId === undefined);
  const shown = own.filter((element) => !element.below).slice(0, MAX_ELEMENTS);
  const below = own.filter((element) => element.below).slice(0, Math.max(0, MAX_ELEMENTS - shown.length));
  const frames = (snapshot.frames ?? []).flatMap((frame) => {
    const text = clip(frame.text.trim(), MAX_FRAME_TEXT);
    const elements = snapshot.elements.filter((element) => element.frameId === frame.frameId);
    const host = hostOf(frame.url);
    return ['', host ? `In a frame from ${host}:` : 'In a frame:', ...(text ? [text] : []), ...elements.map(elementLine)];
  });
  const tools = (snapshot.tools ?? []).slice(0, MAX_TOOLS);
  const tabs = snapshot.tabs ?? [];
  return [
    `URL: ${snapshot.url}`,
    `Title: ${snapshot.title}`,
    `Scroll: ${position}`,
    ...(tabs.length > 1
      ? [
          `Your tabs: ${tabs
            .map((tab) => `(${tab.number}) ${hostOf(tab.url)} — ${clip(tab.title, 60)}${tab.current ? ' [this one]' : ''}`)
            .join('; ')}`,
        ]
      : []),
    '',
    '===visible text===',
    snapshot.text.trim() || '(none)',
    '===end of visible text===',
    '',
    'Elements on screen:',
    ...(shown.length ? shown.map(elementLine) : ['(none)']),
    ...(below.length ? ['', 'Elements further down:', ...below.map(elementLine)] : []),
    ...frames,
    ...(tools.length
      ? [
          '',
          'Tools this site offers (WebMCP), called with the "tool" action:',
          ...tools.map(
            (tool) =>
              `- ${tool.name}${tool.readOnly ? ' (only reads)' : ''}: ${clip(tool.description.replace(/\s+/g, ' '), 200)} input schema: ${clip(tool.schema, MAX_SCHEMA)}`
          ),
        ]
      : []),
    ...(snapshot.challenge ? ['', 'A CAPTCHA is on this page, in a frame: only the user can solve it.'] : []),
  ].join('\n');
};

// What the model is told after an action.
export const actionResult = (step: AgentStep) => {
  if (step.status === 'denied' && step.site) {
    return `Result: not done. The user did not allow working on ${step.site}. Do not act on that site; go back or finish and tell the user what is left.`;
  }
  if (step.status === 'denied' && step.action.kind === 'plan') {
    return 'Result: the user did not approve the plan. Finish, and say what you would need to do it differently.';
  }
  if (step.status === 'denied' && step.action.kind === 'point') {
    return 'Result: the user did not point at anything. Try another way, or finish and tell the user where you are stuck.';
  }
  if (step.status === 'denied') return 'Result: the user declined this action. Do not try it again; finish and tell the user what is left for them to do.';
  if (step.status === 'failed') {
    switch (step.error) {
      case 'not_found':
        return 'Result: failed, that element is no longer on the page. Read the new page state below.';
      case 'secret_field':
        return 'Result: refused. Never type into password, card or code fields; finish and ask the user to fill that in.';
      case 'not_select':
        return 'Result: failed, that element is not a dropdown. Click it instead.';
      case 'no_option':
        return 'Result: failed, the dropdown has no such option.';
      case 'bad_url':
        return 'Result: refused, only http and https addresses can be opened.';
      case 'unreachable':
        return 'Result: failed, this page cannot be controlled (a browser page or a site Shizue may not access).';
      case 'not_visible':
        return 'Result: failed, this tab is not the one on screen now, so it cannot be seen. Work from the text.';
      case 'no_screenshot':
        return 'Result: failed, there is no screenshot to point in. Look first.';
      case 'no_tab':
        return 'Result: failed, there is no tab with that number.';
      case 'no_tool':
        return 'Result: failed, the site offers no tool by that name now.';
      case 'repeated':
        return 'Result: not done. You already did exactly this twice on this same page, and it did not change. Do something different, or finish and tell the user where you are stuck.';
      case 'no_file':
        return 'Result: failed, there is no image with that number, or no file field there to put it in.';
      case 'timed_out':
        return 'Result: the text you waited for did not show within 10 seconds.';
      default:
        return 'Result: failed. Try another way.';
    }
  }
  switch (step.action.kind) {
    case 'plan':
      return 'Result: the user approved the plan. Go ahead.';
    case 'handoff':
      return 'Result: the user did their part and handed back. Check the page below and carry on.';
    case 'point':
      return 'Result: the user pointed at the element marked "(the user pointed at this)" below.';
    case 'wait':
      return step.action.text ? 'Result: the text showed.' : 'Result: done.';
    default:
      return 'Result: done.';
  }
};
