import { STORAGE_CHAT_DRAFTS } from '@/config/constants';
import { readStorage, setStorage } from '@/lib/storageBackend';

// What the user typed in a chat box and hasn't sent, per chat, so closing the panel, going to the
// memos or switching chats doesn't lose it (components/Chat/ChatInput.tsx). Kept in
// chrome.storage.local, so a draft also outlives the browser closing.

export interface ChatDraft {
  text: string;
  // When it was last typed.
  at: number;
}

export type ChatDrafts = Record<string, ChatDraft>;

// The draft of a chat not started yet.
export const NEW_CHAT_DRAFT = 'new';

// A draft nobody came back to in a week is dropped, and only the latest few are kept.
export const DRAFT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_LIMIT = 20;

const isFresh = (draft: ChatDraft | undefined, now: number) =>
  !!draft && typeof draft.text === 'string' && now - draft.at < DRAFT_KEEP_MS;

export const draftKeyOf = (threadId: string | undefined) => threadId ?? NEW_CHAT_DRAFT;

// The drafts with `key`'s text set, or taken out when it is blank, and stale ones dropped.
export const withDraft = (
  drafts: ChatDrafts,
  key: string,
  text: string,
  now: number
): ChatDrafts => {
  const next: ChatDrafts = { ...drafts };
  if (text.trim()) next[key] = { text, at: now };
  else delete next[key];
  const kept = Object.entries(next)
    .filter(([, draft]) => isFresh(draft, now))
    .sort(([, a], [, b]) => b.at - a.at)
    .slice(0, DRAFT_LIMIT);
  return Object.fromEntries(kept);
};

export const draftTextOf = (drafts: ChatDrafts | undefined, key: string, now: number) => {
  const draft = drafts?.[key];
  return draft && isFresh(draft, now) ? draft.text : '';
};

// The drafts as last read or written here, kept current with the other windows' panels, so a save
// starts at once: one made as the panel closes can't wait for a read that never comes back.
let drafts: ChatDrafts | null = null;
let listening = false;
const loadDrafts = async () => {
  if (!listening) {
    listening = true;
    chrome.storage.onChanged.addListener((changes, area) => {
      const change = area === 'local' ? changes[STORAGE_CHAT_DRAFTS] : undefined;
      if (change) drafts = (change.newValue as ChatDrafts | undefined) ?? {};
    });
  }
  drafts ??= (await readStorage<ChatDrafts>(STORAGE_CHAT_DRAFTS)) ?? {};
  return drafts;
};

export const loadChatDraft = async (key: string) =>
  draftTextOf(await loadDrafts(), key, Date.now());

// Two panels (one per window) may write at once; the later write wins, which at worst loses the
// other window's last keystrokes.
export const saveChatDraft = (key: string, text: string) => {
  const save = (current: ChatDrafts) => {
    if (!text.trim() && !current[key]) return;
    drafts = withDraft(current, key, text, Date.now());
    void setStorage(STORAGE_CHAT_DRAFTS, drafts);
  };
  if (drafts) save(drafts);
  else void loadDrafts().then(save);
};
