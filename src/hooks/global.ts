import { SelectionActionType, STORAGE_GLOBAL_STATE } from '@/config/constants';
import { atomWithChromeStorage } from '@/lib/atomWithChromeStorage';
import { atom, useAtom } from 'jotai';
import { unwrap } from 'jotai/utils';

export const messageAddedInPanelAtom = atom<number | null>(null);

export type ActionType =
  | 'chat'
  | 'askForSummary'
  | 'describeImage'
  | 'extractImageText'
  | 'browserControl'
  | 'fillForm'
  | 'words'
  | SelectionActionType;

export type GlobalState = {
  actionType: ActionType;
  summaryTitle?: string;
  summaryText?: string;
  summaryPageLink?: string;
  // The summarized page is a YouTube video, and its text is the video's captions.
  summaryVideo?: boolean;
  summaryCaptions?: boolean;
  // The video's preview frames, for the scenes its summary shows (lib/storyboard.ts).
  summaryStoryboard?: string;
  selectionText?: string;
  imageBase64?: string;
  imageUrl?: string;
  // The form to fill from another tab: the tab and frame of the right-clicked field.
  formFillTabId?: number;
  formFillFrameId?: number;
};

export const defaultGlobalState: GlobalState = {
  actionType: 'chat',
};

export const globalStateAtom = atomWithChromeStorage<GlobalState>(
  STORAGE_GLOBAL_STATE,
  defaultGlobalState
);

// Resolve asynchronous action data before initializing the panel.
const resolvedGlobalStateAtom = unwrap(globalStateAtom);
export const sidePanelHydratedAtom = atom((get) => get(resolvedGlobalStateAtom) !== undefined);

export const updateGlobalStateAtom = atom(null, (_get, set, changes: Partial<GlobalState>) =>
  set(globalStateAtom, (prev) => prev instanceof Promise
    ? prev.then((state) => ({ ...state, ...changes }))
    : { ...prev, ...changes })
);

// Selection belongs to this panel's store. A reopened panel starts a new chat;
// saved conversations remain available through the IndexedDB history.
export const threadIdAtom = atom<string | undefined>(undefined);

// Set when the page's overlay menu asks for a new chat with browser control on; the chat turns it
// on and clears it.
export const browserControlRequestedAtom = atom(false);

// A continue card in the new chat's greeting (components/Chat/ChatGreeting.tsx) opened its chat:
// these tabs, still open from it, go into the chat box as attachments.
export const continueTabsAtom = atom<number[]>([]);

// Set when a form field's menu asks to fill its form from another tab; the chat shows the form fill
// card for it (components/FormFill/FormFillCard.tsx) and clears it when the card closes.
export const formFillRequestAtom = atom<{ tabId: number; frameId: number; at: number } | null>(null);

export const actionTypeAtom = atom(
  (get) => get(resolvedGlobalStateAtom)?.actionType ?? 'chat',
  (_get, set, newActionType: ActionType) =>
    set(updateGlobalStateAtom, { actionType: newActionType })
);

export const useActionType = () => useAtom(actionTypeAtom);
