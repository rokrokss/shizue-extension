import { pageAddress, type TabLike } from '@/lib/chatLookup';

// Continue cards in a new chat's greeting (components/Chat/ChatGreeting.tsx): recent chats whose
// pages are still open in tabs, to pick up with those tabs attached again. Made from the chats and
// tabs alone, without asking a model.

export const CONTINUE_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_CONTINUE_CARDS = 3;

export interface RecentChat {
  threadId: string;
  title: string;
  updatedAt: number;
  // The pages the chat attached or summarized.
  urls: string[];
}

export interface ContinueCard {
  threadId: string;
  title: string;
  // Its pages' open tabs, the latest used first.
  tabIds: number[];
}

export const continueCards = (
  chats: RecentChat[],
  tabs: TabLike[],
  now: number,
  maxTabs: number
): ContinueCard[] => {
  const openTabs = tabs
    .filter((tab) => tab.id !== undefined && /^https?:/.test(tab.url ?? '') && !tab.incognito)
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0));
  return chats
    .filter((chat) => now - chat.updatedAt < CONTINUE_DAYS_MS && chat.title.trim())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .flatMap((chat) => {
      const addresses = new Set(chat.urls.filter(Boolean).map(pageAddress));
      const seen = new Set<string>();
      const tabIds = openTabs
        .filter((tab) => {
          const address = pageAddress(tab.url!);
          if (!addresses.has(address) || seen.has(address)) return false;
          seen.add(address);
          return true;
        })
        .map((tab) => tab.id!)
        .slice(0, maxTabs);
      return tabIds.length > 0 ? [{ threadId: chat.threadId, title: chat.title, tabIds }] : [];
    })
    .slice(0, MAX_CONTINUE_CARDS);
};
