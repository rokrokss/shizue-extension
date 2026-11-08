import { useThemeValue } from '@/hooks/layout';
import type { PastFinds } from '@/lib/chatLookup';
import { CloseOutlined, GlobalOutlined, MessageOutlined } from '@ant-design/icons';
import { Button } from 'antd';
import { useTranslation } from 'react-i18next';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

// Above the chat box, each time Search past chats and history found something for a question:
// what it found, which goes to the model with the question only if the user says so.
const PastFindsCard = ({
  finds,
  onSend,
  onSkip,
  onCancel,
}: {
  finds: PastFinds;
  onSend: () => void;
  // The question goes without them.
  onSkip: () => void;
  // Back to the chat box, with the question still in it.
  onCancel: () => void;
}) => {
  const { t, i18n } = useTranslation();
  const theme = useThemeValue();
  const pages = finds.pages.length;
  const chats = finds.chats.length;
  const found = pages + chats > 0;
  const date = (time: number) =>
    new Date(time).toLocaleDateString(i18n.language.replace('_', '-'), {
      month: 'short',
      day: 'numeric',
    });

  return (
    <div
      role="dialog"
      aria-label={t('chat.searchPast')}
      className={`sz:w-full sz:mb-2 sz:p-2 sz:rounded-lg sz:border sz:font-ycom sz:text-sm ${
        theme == 'dark'
          ? 'sz:border-white/15 sz:bg-[#2A2C38] sz:text-white'
          : 'sz:border-black/10 sz:bg-gray-50'
      }`}
    >
      <div className="sz:flex sz:items-start sz:gap-2">
        <div className="sz:flex-1">
          {pages && chats
            ? t('chat.pastFindsFound', { pages, chats })
            : pages
              ? t('chat.pastFindsPagesOnly', { pages })
              : chats
                ? t('chat.pastFindsChatsOnly', { chats })
                : t('chat.pastFindsNone')}
        </div>
        <button
          type="button"
          aria-label={t('chat.pastFindsCancel')}
          title={t('chat.pastFindsCancel')}
          onClick={onCancel}
          className="sz:cursor-pointer sz:text-gray-500 sz:shrink-0"
        >
          <CloseOutlined />
        </button>
      </div>
      {found ? (
        <ul className="sz:mt-1.5 sz:max-h-40 sz:overflow-y-auto sz:flex sz:flex-col sz:gap-0.5">
          {finds.pages.map((page) => (
            <li key={page.url} className="sz:flex sz:items-center sz:gap-1.5 sz:min-w-0">
              <GlobalOutlined className="sz:shrink-0 sz:text-gray-500" />
              <span className="sz:truncate" title={page.url}>
                {page.title || page.url}
              </span>
              <span className="sz:shrink-0 sz:text-xs sz:text-gray-500">
                {hostOf(page.url)} · {date(page.lastVisitTime)}
              </span>
            </li>
          ))}
          {finds.chats.map((chat) => (
            <li key={chat.threadId} className="sz:flex sz:items-center sz:gap-1.5 sz:min-w-0">
              <MessageOutlined className="sz:shrink-0 sz:text-gray-500" />
              <span className="sz:truncate" title={chat.snippet}>
                {chat.title}
              </span>
              <span className="sz:shrink-0 sz:text-xs sz:text-gray-500">{date(chat.at)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="sz:flex sz:justify-end sz:gap-2 sz:mt-2">
        {found ? (
          <>
            <Button size="small" onClick={onSkip} className="sz:font-ycom">
              {t('chat.pastFindsSkip')}
            </Button>
            <Button size="small" type="primary" onClick={onSend} className="sz:font-ycom">
              {t('chat.pastFindsSend')}
            </Button>
          </>
        ) : (
          <Button size="small" type="primary" onClick={onSkip} className="sz:font-ycom">
            {t('chat.pastFindsAskAnyway')}
          </Button>
        )}
      </div>
    </div>
  );
};

export default PastFindsCard;
