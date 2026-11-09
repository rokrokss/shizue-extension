// What the chat looks up on its own before a question goes out (services/chatLookup.ts): open tabs
// that may answer it (Tools → Find in open tabs), and past chats and browsing history (Tools →
// Search past chats and history), which the user sees and allows before any of it reaches the model.

import { isWebStorePage } from '@/lib/webStore';

// Sites that say more about the user than a question needs: banking, payments and brokers, health,
// and mail. The lookups pass them over; attaching one by hand still works.
const SENSITIVE_HOSTS = [
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'icloud.com',
  'paypal.com',
  'wise.com',
  'venmo.com',
  'revolut.com',
  'dashboard.stripe.com',
  'toss.im',
  'kakaopay.com',
  'pay.naver.com',
  'payco.com',
  'kbstar.com',
  'shinhan.com',
  'kebhana.com',
  'ibk.co.kr',
  'nonghyup.com',
  'kfcc.co.kr',
  'kiwoom.com',
  'miraeasset.com',
  'samsungpop.com',
  'mufg.jp',
  'smbc.co.jp',
  'hira.or.kr',
  'nhis.or.kr',
];
// Matched in each word of the host (split at dots and dashes): kakaobank.com, mychart.example.org.
const SENSITIVE_HOST_WORD =
  /bank|securities|brokerage|health|hospital|clinic|medical|patient|pharmacy|mychart/;
// The first word of a mail site's host: mail.google.com, webmail.example.com.
const MAIL_HOST_WORD = /^(?:mail|webmail)$/;
const SENSITIVE_TITLE =
  /\b(?:bank|banking|inbox|hospital|clinic|patient)\b|은행|뱅킹|증권|받은\s?편지함|메일함|병원|의원|진료|처방|銀行|証券|受信トレイ|病院|診療|处方|医院/i;

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return '';
  }
};

export const isSensitivePage = (url: string, title = '') => {
  const host = hostOf(url);
  if (SENSITIVE_HOSTS.some((site) => host === site || host.endsWith(`.${site}`))) return true;
  const words = host.split(/[.-]/);
  if (MAIL_HOST_WORD.test(words[0] ?? '')) return true;
  if (words.some((word) => SENSITIVE_HOST_WORD.test(word))) return true;
  return SENSITIVE_TITLE.test(title);
};

// An address without its fragment, so a page scrolled to a heading is the same page.
export const pageAddress = (url: string) => url.replace(/#.*$/, '');

// ---- Find in open tabs ----

export interface TabLike {
  id?: number;
  title?: string;
  url?: string;
  incognito?: boolean;
  discarded?: boolean;
  lastAccessed?: number;
}

export interface TabCandidate {
  id: number;
  title: string;
  url: string;
}

// At most this many tabs go to the model, the latest used first.
export const MAX_TAB_CANDIDATES = 40;

// The web tabs the model may pick from: not private, not unloaded (they would have to load again
// to be read), not Chrome Web Store pages (never readable), not sensitive, and not pages the chat
// already has.
export const tabCandidates = (tabs: TabLike[], skipUrls: string[]): TabCandidate[] => {
  const skip = new Set(skipUrls.map(pageAddress));
  const seen = new Set<string>();
  return tabs
    .filter(
      (tab) =>
        tab.id !== undefined &&
        /^https?:/.test(tab.url ?? '') &&
        !tab.incognito &&
        !tab.discarded &&
        !isWebStorePage(tab.url) &&
        !skip.has(pageAddress(tab.url!)) &&
        !isSensitivePage(tab.url!, tab.title)
    )
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))
    .filter((tab) => {
      const address = pageAddress(tab.url!);
      if (seen.has(address)) return false;
      seen.add(address);
      return true;
    })
    .slice(0, MAX_TAB_CANDIDATES)
    .map((tab) => ({ id: tab.id!, title: tab.title ?? '', url: tab.url! }));
};

// What the model sees of a tab: its site and path, without the query, which may hold tokens.
export const tabSite = (url: string) => {
  try {
    const { hostname, pathname } = new URL(url);
    const path = pathname === '/' ? '' : pathname;
    return (hostname + path).slice(0, 80);
  } catch {
    return '';
  }
};

export const OPEN_TABS_JSON_SCHEMA = {
  type: 'object',
  properties: { tabs: { type: 'array', items: { type: 'integer' } } },
  required: ['tabs'],
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
  } catch {
    return null;
  }
};

// The picked tabs as indexes into the `count` candidates the prompt numbered from 1, in the model's
// order, each once, at most `max`.
export const parseOpenTabPicks = (text: string, count: number, max: number): number[] => {
  const tabs = (parseJson(text) as { tabs?: unknown } | null)?.tabs;
  if (!Array.isArray(tabs)) return [];
  const picked: number[] = [];
  for (const n of tabs) {
    const index = typeof n === 'number' ? n - 1 : Number.parseInt(String(n), 10) - 1;
    if (Number.isInteger(index) && index >= 0 && index < count && !picked.includes(index)) {
      picked.push(index);
    }
  }
  return picked.slice(0, max);
};

// ---- Search past chats and history ----

export const HISTORY_SEARCH_JSON_SCHEMA = {
  type: 'object',
  properties: {
    queries: { type: 'array', items: { type: 'string' } },
    days: { type: 'integer' },
  },
  required: ['queries', 'days'],
};

export interface HistorySearchTerms {
  queries: string[];
  // How far back to look; 0 when the question names no time.
  days: number;
}

export const MAX_SEARCH_QUERIES = 4;

export const parseHistorySearchTerms = (text: string): HistorySearchTerms | null => {
  const json = parseJson(text) as { queries?: unknown; days?: unknown } | null;
  if (!json || !Array.isArray(json.queries)) return null;
  const queries = [
    ...new Set(
      json.queries
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.replace(/\s+/g, ' ').trim())
        .filter((q) => q.length > 0 && q.length <= 60)
    ),
  ].slice(0, MAX_SEARCH_QUERIES);
  const days =
    typeof json.days === 'number' && Number.isFinite(json.days) ? Math.round(json.days) : 0;
  return { queries, days: Math.min(365, Math.max(0, days)) };
};

// When the model can't say: the question's longest words, which a title search may still match.
export const fallbackSearchTerms = (question: string): HistorySearchTerms => ({
  queries: [
    ...new Set(
      question.split(/[\s.,!?;:()"'「」『』、。？！]+/u).filter((word) => word.length >= 2)
    ),
  ]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_SEARCH_QUERIES),
  days: 0,
});

export interface HistoryHit {
  url: string;
  title: string;
  lastVisitTime: number;
}

export interface ChatFind {
  threadId: string;
  title: string;
  at: number;
  // The matching message around the match.
  snippet: string;
}

export interface PastFinds {
  pages: HistoryHit[];
  chats: ChatFind[];
}

export const MAX_HISTORY_PAGES = 10;
export const MAX_CHAT_FINDS = 5;

// The visited pages found with each search term, together: pages more terms found first, then
// the latest visited. Sensitive and non-web pages are left out.
export const rankHistoryHits = (
  perQuery: HistoryHit[][],
  limit = MAX_HISTORY_PAGES
): HistoryHit[] => {
  const merged = new Map<string, HistoryHit & { score: number }>();
  for (const hits of perQuery) {
    const counted = new Set<string>();
    for (const hit of hits) {
      if (!/^https?:/.test(hit.url) || isSensitivePage(hit.url, hit.title)) continue;
      const address = pageAddress(hit.url);
      if (counted.has(address)) continue;
      counted.add(address);
      const known = merged.get(address);
      if (known) {
        known.score += 1;
        known.lastVisitTime = Math.max(known.lastVisitTime, hit.lastVisitTime);
      } else {
        merged.set(address, { ...hit, score: 1 });
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score || b.lastVisitTime - a.lastVisitTime)
    .slice(0, limit)
    .map(({ score, ...hit }) => hit);
};

// Up to `room` characters of `text` around the match at `index`.
export const snippetAround = (text: string, index: number, room = 300) => {
  const flat = text.replace(/\s+/g, ' ');
  if (flat.length <= room) return flat;
  // Where the match is once the spaces before it are squeezed too.
  const at = text.slice(0, index).replace(/\s+/g, ' ').length;
  const start = Math.max(0, Math.min(at - Math.floor(room / 3), flat.length - room));
  const before = start > 0 ? '…' : '';
  const after = start + room < flat.length ? '…' : '';
  return before + flat.slice(start, start + room) + after;
};

const dayOf = (time: number) => {
  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

// A past chat's link in an answer, which opens that chat in the panel
// (components/Chat/MarkdownMessage.tsx).
export const chatLink = (threadId: string) => `#chat=${threadId}`;
export const CHAT_LINK_PATTERN = /^#chat=([\w-]+)$/;

// A visited page's address without what may sign in or grant access (reset and magic links,
// tokens, keys, shared-doc keys) and without its fragment; the rest of its query names the page.
const SECRET_PARAM =
  /token|^key$|api_?key|access|code|auth|sess|sig|secret|pass|otp|ticket|nonce|state|email|login|reset|magic|cred/i;
export const historyAddress = (url: string) => {
  try {
    const address = new URL(url);
    for (const name of [...address.searchParams.keys()]) {
      if (SECRET_PARAM.test(name)) address.searchParams.delete(name);
    }
    address.hash = '';
    return address.href;
  } catch {
    return url;
  }
};

// The finds as one attachment's text, each with the link the answer can point to it with.
export const pastFindsText = (finds: PastFinds) => {
  const escape = (title: string) => title.replace(/[[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const pages = finds.pages.map((page) => {
    const address = historyAddress(page.url);
    return `- [${escape(page.title) || address}](${address}) (last visited ${dayOf(page.lastVisitTime)})`;
  });
  const chats = finds.chats.map(
    (chat) =>
      `- [${escape(chat.title)}](${chatLink(chat.threadId)}) (${dayOf(chat.at)}): ${chat.snippet}`
  );
  return [
    ...(pages.length ? ["Pages from the user's browsing history:", ...pages] : []),
    ...(pages.length && chats.length ? [''] : []),
    ...(chats.length
      ? ["The user's earlier chats with you, with the part that matched:", ...chats]
      : []),
  ].join('\n');
};
