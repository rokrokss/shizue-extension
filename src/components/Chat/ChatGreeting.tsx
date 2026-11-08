import CharacterStanding from '@/components/Character/CharacterStanding';
import { isSelectionActionType, MAX_ATTACHED_TABS } from '@/config/constants';
import { switchThreadAtom } from '@/hooks/chat';
import { continueTabsAtom } from '@/hooks/global';
import { useThemeValue } from '@/hooks/layout';
import { CONTINUE_DAYS_MS, continueCards, type ContinueCard } from '@/lib/continueCards';
import { db, type Message } from '@/lib/indexDB';
import { MessageOutlined } from '@ant-design/icons';
import { useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// How a chat is named on its card: by what its first message shows.
const titleOf = (first: Message) =>
  first.translateMode
    ? ''
    : first.actionType === 'askForSummary'
    ? first.summaryTitle ?? ''
    : isSelectionActionType(first.actionType)
    ? first.selectionText ?? ''
    : first.content;

// The latest chats of the past week, as continue cards for the tabs of theirs still open.
const loadContinueCards = async (): Promise<ContinueCard[]> => {
  const now = Date.now();
  const threads = (await db.threads.where('updatedAt').above(now - CONTINUE_DAYS_MS).toArray())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 30);
  const chats = await Promise.all(
    threads.map(async (thread) => {
      const messages = await db.messages.where('threadId').equals(thread.id).sortBy('createdAt');
      return {
        threadId: thread.id,
        updatedAt: thread.updatedAt,
        title: messages[0] ? titleOf(messages[0]) : '',
        urls: messages.flatMap((m) => [
          ...(m.attachments ?? []).map((page) => page.url),
          // A summary's page, and a selection action's (explain, X-ray and the like).
          ...(m.summaryPageLink ? [m.summaryPageLink] : []),
          ...(m.agentRun?.url ? [m.agentRun.url] : []),
        ]),
      };
    })
  );
  return continueCards(chats, await chrome.tabs.query({}), now, MAX_ATTACHED_TABS);
};

// Under the greeting: recent chats whose pages are still open. Picking one opens the chat with
// those tabs attached to the chat box, read again as they are now when the next question goes.
const ContinueCards = () => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const switchThread = useSetAtom(switchThreadAtom);
  const setContinueTabs = useSetAtom(continueTabsAtom);
  const [cards, setCards] = useState<ContinueCard[]>([]);

  useEffect(() => {
    let current = true;
    loadContinueCards()
      .then((found) => current && setCards(found))
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);

  if (cards.length === 0) return null;
  return (
    <div className="sz:flex sz:flex-col sz:gap-1.5 sz:mt-6 sz:w-full sz:max-w-72 sz:px-4 sz:font-ycom">
      <div className="sz:text-xs sz:text-gray-500">{t('chat.continueTitle')}</div>
      {cards.map((card) => (
        <button
          key={card.threadId}
          type="button"
          onClick={() => {
            setContinueTabs(card.tabIds);
            switchThread(card.threadId);
          }}
          className={`sz:flex sz:items-center sz:gap-2 sz:w-full sz:px-3 sz:py-2 sz:rounded-lg sz:border sz:text-left sz:cursor-pointer ${
            theme == 'dark'
              ? 'sz:border-white/15 sz:text-white sz:hover:bg-white/5'
              : 'sz:border-black/10 sz:text-black sz:hover:bg-black/[0.03]'
          }`}
        >
          <MessageOutlined className="sz:shrink-0 sz:text-gray-500" />
          <span className="sz:min-w-0 sz:flex-1">
            <span className="sz:block sz:truncate sz:text-sm">{card.title}</span>
            <span className="sz:block sz:text-xs sz:text-gray-500">
              {t('chat.continueTabsOpen', { count: card.tabIds.length })}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
};

const ChatGreeting = () => {
  const { t } = useTranslation();
  const theme = useThemeValue();

  return (
    <div className="sz-chat-greeting-container sz:flex sz:flex-col sz:items-center sz:justify-center sz:h-full sz:w-full sz:pb-35">
      <div className="sz-chat-greeting sz:flex sz:flex-row sz:items-center sz:justify-center">
        <CharacterStanding
          scale={3}
          marginLeft="0"
          invert={theme == 'dark'}
          dark={theme == 'dark'}
        />
        <div
          className={`sz-chat-greeting-message sz:text-xl sz:ml-3 sz:pt-2 ${
            theme == 'dark' ? 'sz:text-white' : 'sz:text-black'
          }`}
        >
          <div>{t('chat.greeting')}</div>
          <div>{t('chat.main_0')}</div>
        </div>
      </div>
      <ContinueCards />
    </div>
  );
};

export default ChatGreeting;
