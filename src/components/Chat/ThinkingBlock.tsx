import MarkdownMessage from '@/components/Chat/MarkdownMessage';
import { useThemeValue } from '@/hooks/layout';
import { thinkingSeconds } from '@/lib/reasoning';
import type { WebSearchStep } from '@/lib/webSources';
import { GlobalOutlined, LinkOutlined, LoadingOutlined, RightOutlined } from '@ant-design/icons';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host.replace(/^www\./, '') : url);

// The thinking cut where each web search came, with the search between the pieces.
const thoughtsAndSearches = (reasoning: string, searches: WebSearchStep[]) => {
  const parts: ({ text: string } | { step: WebSearchStep })[] = [];
  let from = 0;
  for (const step of [...searches].sort((a, b) => a.at - b.at)) {
    const at = Math.min(Math.max(step.at, from), reasoning.length);
    if (reasoning.slice(from, at).trim()) parts.push({ text: reasoning.slice(from, at) });
    parts.push({ step });
    from = at;
  }
  if (reasoning.slice(from).trim()) parts.push({ text: reasoning.slice(from) });
  return parts;
};

const linkProps = { target: '_blank', rel: 'noopener noreferrer' } as const;

// One web search among the thoughts: what it looked for, or the page it opened, with how many pages
// it found on the right. A click lists those pages, each opening in a new tab.
const SearchStep = ({ step, hover }: { step: WebSearchStep; hover: string }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const sources = step.sources ?? [];
  const page = !step.query && step.url && /^https?:\/\//.test(step.url) ? step.url : undefined;
  const icon = step.done ? <GlobalOutlined className="sz:shrink-0" /> : <LoadingOutlined className="sz:shrink-0" />;
  const count =
    step.results !== undefined ? (
      <span className="sz:shrink-0">{t('chat.searchResults', { count: step.results })}</span>
    ) : null;
  const row = 'sz:flex sz:items-center sz:gap-1.5 sz:w-full sz:min-w-0';

  if (!sources.length) {
    return (
      <div className={`${row} sz:py-0.5`}>
        {icon}
        {page ? (
          <a href={page} {...linkProps} title={page} className={`sz:truncate sz:underline sz:underline-offset-2 sz:text-inherit ${hover}`}>
            {hostOf(page)}
          </a>
        ) : (
          <span className="sz:truncate">{step.query ?? (step.url ? hostOf(step.url) : t('chat.webSearch'))}</span>
        )}
        {count ? <span className="sz:ml-auto sz:pl-2 sz:flex">{count}</span> : null}
      </div>
    );
  }
  return (
    <div className="sz:py-0.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={`${row} sz:text-left sz:text-inherit sz:bg-transparent sz:border-0 sz:p-0 sz:cursor-pointer ${hover}`}
      >
        {icon}
        <span className="sz:truncate">{step.query ?? t('chat.webSearch')}</span>
        <span className="sz:ml-auto sz:pl-2 sz:flex sz:items-center sz:gap-1 sz:shrink-0">
          {count}
          <RightOutlined
            className={`sz:text-[8px] sz:transition-transform sz:duration-200 sz:motion-reduce:transition-none ${
              open ? 'sz:rotate-90' : ''
            }`}
          />
        </span>
      </button>
      {open ? (
        <div className="sz:flex sz:flex-col sz:pl-5 sz:pt-0.5">
          {sources.map((source) => (
            <a
              key={source.url}
              href={source.url}
              {...linkProps}
              title={source.url}
              className={`${row} sz:py-px sz:text-inherit ${hover}`}
            >
              <LinkOutlined className="sz:shrink-0 sz:text-[10px]" />
              <span className="sz:truncate">{source.title}</span>
              {source.title.replace(/^www\./, '') !== hostOf(source.url) ? (
                <span className="sz:ml-auto sz:pl-2 sz:shrink-0 sz:max-w-[40%] sz:truncate sz:opacity-70">
                  {hostOf(source.url)}
                </span>
              ) : null}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
};

// What the model showed of its thinking and the web searches it ran, above its answer, in the
// order they came. Open while it works, saying what it searches for or the seconds it has thought;
// it folds into "Thought for 12s · Web searches: 2" once the answer starts. A click opens or closes
// it, also while it works, and that choice then stays.
const ThinkingBlock = ({
  reasoning,
  searches,
  thinkingMs,
  thinking,
}: {
  reasoning: string;
  searches: WebSearchStep[];
  thinkingMs?: number;
  // The model is still at work, thinking or searching: no answer yet.
  thinking: boolean;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [open, setOpen] = useState<boolean | null>(null);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const body = useRef<HTMLDivElement>(null);
  // Whether the body keeps the newest line in view: until the user scrolls up from the bottom.
  const follow = useRef(true);
  // Whether lines are hidden above, which fades the top edge.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!thinking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [thinking]);

  useEffect(() => {
    if (thinking && follow.current && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [reasoning, searches, thinking]);

  const onScroll = () => {
    const el = body.current;
    if (!el) return;
    follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
    setScrolled(el.scrollTop > 0);
  };

  const expanded = open ?? thinking;
  const hover = theme == 'dark' ? 'sz:hover:text-gray-300' : 'sz:hover:text-gray-700';
  const seconds = thinkingSeconds(thinking ? now - startedAt : thinkingMs ?? 0);
  const running = [...searches].reverse().find((step) => !step.done);
  const thought = reasoning.trim()
    ? thinkingMs !== undefined
      ? t('chat.thoughtFor', { seconds })
      : t('chat.thought')
    : null;
  const searched = searches.length > 0 ? t('chat.webSearchCount', { count: searches.length }) : null;
  const label = !thinking
    ? [thought, searched].filter(Boolean).join(' · ')
    : running?.query
    ? t('chat.searchingWebFor', { query: running.query })
    : running?.url
    ? t('chat.openingPage', { host: hostOf(running.url) })
    : running
    ? t('chat.searchingWeb')
    : t('chat.thinking', { seconds });

  return (
    <div
      className="sz-thinking sz:flex sz:flex-col sz:items-start sz:pb-2"
      style={
        {
          '--sz-thinking-dim': theme == 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
          '--sz-thinking-bright': theme == 'dark' ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)',
        } as CSSProperties
      }
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
        className={`sz:flex sz:items-center sz:gap-1.5 sz:max-w-full sz:min-w-0 sz:text-[13px] sz:font-ycom sz:rounded-md sz:py-0.5 sz:px-0.5 sz:-ml-0.5 sz:cursor-pointer ${
          thinking ? 'sz-thinking-live' : `sz:text-gray-500 ${hover}`
        }`}
      >
        <span className="sz-thinking-label sz:truncate">{label}</span>
        <RightOutlined
          className={`sz:shrink-0 sz:text-[9px] sz:text-gray-400 sz:transition-transform sz:duration-200 sz:motion-reduce:transition-none ${
            expanded ? 'sz:rotate-90' : ''
          }`}
        />
      </button>
      <div
        className={`sz:grid sz:w-full sz:transition-[grid-template-rows,opacity] sz:duration-300 sz:ease-out sz:motion-reduce:transition-none ${
          expanded ? 'sz:grid-rows-[1fr] sz:opacity-100' : 'sz:grid-rows-[0fr] sz:opacity-0'
        }`}
      >
        <div className="sz:overflow-hidden">
          <div
            ref={body}
            onScroll={onScroll}
            className={`sz-thinking-body sz:mt-1 sz:ml-1 sz:pl-3 sz:border-l-2 sz:max-h-56 sz:overflow-y-auto sz:text-[13px] sz:leading-5 sz:text-gray-500 ${
              theme == 'dark' ? 'sz:border-white/15' : 'sz:border-black/10'
            }`}
            style={{
              scrollbarWidth: 'thin',
              ...(scrolled ? { maskImage: 'linear-gradient(to bottom, transparent, black 32px)' } : {}),
            }}
          >
            {thoughtsAndSearches(reasoning, searches).map((part, i) =>
              'text' in part ? (
                <MarkdownMessage key={i} content={part.text} />
              ) : (
                <SearchStep key={part.step.id} step={part.step} hover={hover} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingBlock;
