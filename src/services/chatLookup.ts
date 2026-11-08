import { MESSAGE_HISTORY_SEARCH_TERMS, MESSAGE_PICK_OPEN_TABS } from '@/config/constants';
import {
  fallbackSearchTerms,
  MAX_CHAT_FINDS,
  rankHistoryHits,
  snippetAround,
  tabCandidates,
  tabSite,
  type ChatFind,
  type HistoryHit,
  type HistorySearchTerms,
  type PastFinds,
} from '@/lib/chatLookup';
import { db, loadThread, searchThreads, type ThreadSearchHit } from '@/lib/indexDB';
import { readTabPage, readVideoTab, type PageText } from '@/lib/tabText';
import { videoKey } from '@/lib/videoTranscript';

// What the chat box looks up before a question goes out (lib/chatLookup.ts), in the side panel.
// The model calls run in the background (services/background/chatLookupHandler.ts).

const DAY_MS = 24 * 60 * 60 * 1000;
// Chrome keeps about this much history.
const HISTORY_DAYS = 90;
// A match with no more than this beside the term says nothing about it.
const BARE_MATCH_EXTRA = 10;

// Find in open tabs: the open tabs the chat model picks for the question by their titles and sites,
// read as attached tabs are, a short page included since the model picked it; one that can't be
// read is left out.
export const findOpenTabPages = async (
  question: string,
  skipUrls: string[],
  max: number
): Promise<PageText[]> => {
  const candidates = tabCandidates(await chrome.tabs.query({}), skipUrls);
  if (candidates.length === 0 || max <= 0) return [];
  const picked: unknown = await chrome.runtime
    .sendMessage({
      action: MESSAGE_PICK_OPEN_TABS,
      question,
      tabs: candidates.map((tab) => ({ title: tab.title, site: tabSite(tab.url) })),
      max,
    })
    .catch(() => []);
  const tabs = (Array.isArray(picked) ? picked : []).flatMap((index) =>
    typeof index === 'number' && candidates[index] ? [candidates[index]] : []
  );
  const reads = await Promise.all(
    tabs.map((tab) => (videoKey(tab.url) !== null ? readVideoTab(tab.id) : readTabPage(tab.id, true)))
  );
  return reads.flatMap((read) => ('page' in read ? [read.page] : []));
};

// Whether the user let Shizue read the browsing history (an optional permission, asked for when
// they turn the search on). Safari has no history API.
export const historyAllowed = async () => {
  if (typeof chrome.history?.search !== 'function') return false;
  return chrome.permissions.contains({ permissions: ['history'] }).catch(() => false);
};

// Asked for from the Tools menu's click, before anything else is awaited, so the click still
// counts as the user's gesture.
export const requestHistoryPermission = () =>
  chrome.permissions.request({ permissions: ['history'] }).catch(() => false);

const searchHistory = async (
  { queries, days }: HistorySearchTerms,
  now: number
): Promise<HistoryHit[]> => {
  if (queries.length === 0 || !(await historyAllowed())) return [];
  const startTime = now - (days || HISTORY_DAYS) * DAY_MS;
  const perQuery = await Promise.all(
    queries.map((text) =>
      chrome.history.search({ text, startTime, maxResults: 50 }).catch(() => [])
    )
  );
  return rankHistoryHits(
    perQuery.map((items) =>
      items.map((item) => ({
        url: item.url ?? '',
        title: item.title ?? '',
        lastVisitTime: item.lastVisitTime ?? 0,
      }))
    )
  );
};

// What a past chat's card quotes. The first match is often a selection action on the term itself
// (explain, X-ray), whose shown text is just the term; the chat's answer then says what it is.
const chatSnippet = async (threadId: string, { text, index }: ThreadSearchHit, query: string) => {
  if (text.replace(/\s+/g, ' ').trim().length <= query.length + BARE_MATCH_EXTRA) {
    const needle = query.toLowerCase();
    const answer = (await loadThread(threadId)).find(
      (m) => m.role === 'ai' && m.content.toLowerCase().includes(needle)
    );
    if (answer) return snippetAround(answer.content, answer.content.toLowerCase().indexOf(needle));
  }
  return snippetAround(text, index);
};

// Earlier chats whose questions or answers contain a search term: the ones more terms found first,
// then the latest. The chat the question is asked in is left out.
const searchChats = async (
  { queries, days }: HistorySearchTerms,
  now: number,
  currentThreadId: string | undefined
): Promise<ChatFind[]> => {
  const since = days ? now - days * DAY_MS : 0;
  const found = new Map<string, { hit: ThreadSearchHit; query: string; score: number }>();
  for (const query of queries) {
    for (const [threadId, hit] of await searchThreads(query)) {
      if (threadId === currentThreadId) continue;
      const known = found.get(threadId);
      if (known) known.score += 1;
      else found.set(threadId, { hit, query, score: 1 });
    }
  }
  const threads = await db.threads.bulkGet([...found.keys()]);
  const kept = threads
    .flatMap((thread) => (thread && thread.updatedAt >= since ? [thread] : []))
    .sort((a, b) => found.get(b.id)!.score - found.get(a.id)!.score || b.updatedAt - a.updatedAt)
    .slice(0, MAX_CHAT_FINDS);
  return Promise.all(
    kept.map(async (thread) => {
      const { hit, query } = found.get(thread.id)!;
      return {
        threadId: thread.id,
        title: thread.title,
        at: thread.updatedAt,
        snippet: await chatSnippet(thread.id, hit, query),
      };
    })
  );
};

// Search past chats and history: the chat model turns the question into search terms (it sees only
// the question), and the search itself runs here, on this computer.
export const searchPast = async (
  question: string,
  currentThreadId: string | undefined
): Promise<PastFinds> => {
  const now = Date.now();
  const asked: HistorySearchTerms | null = await chrome.runtime
    .sendMessage({
      action: MESSAGE_HISTORY_SEARCH_TERMS,
      question,
      today: new Date(now).toDateString(),
    })
    .catch(() => null);
  const terms = asked?.queries?.length ? asked : fallbackSearchTerms(question);
  const [pages, chats] = await Promise.all([
    searchHistory(terms, now).catch(() => []),
    searchChats(terms, now, currentThreadId).catch(() => []),
  ]);
  return { pages, chats };
};
