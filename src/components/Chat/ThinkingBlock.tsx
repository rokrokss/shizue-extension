import MarkdownMessage from '@/components/Chat/MarkdownMessage';
import { useThemeValue } from '@/hooks/layout';
import { thinkingSeconds } from '@/lib/reasoning';
import type { WebSearchStep } from '@/lib/webSources';
import { GlobalOutlined, LoadingOutlined, RightOutlined } from '@ant-design/icons';
import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const hostOf = (url: string) => (URL.canParse(url) ? new URL(url).host : url);

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

// What the model showed of its thinking and the web searches it ran, above its answer, in the
// order they came. Open while it works, saying what it searches for or the seconds it has thought;
// it folds into "Thought for 12s · Web searches: 2" once the answer starts, and opens again on a
// click.
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
  const [open, setOpen] = useState(false);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const body = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!thinking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [thinking]);

  // While it works, the newest thinking or search stays in view.
  useEffect(() => {
    if (thinking && body.current) body.current.scrollTop = body.current.scrollHeight;
  }, [reasoning, searches, thinking]);

  const expanded = thinking || open;
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
        disabled={thinking}
        onClick={() => setOpen((value) => !value)}
        className={`sz:flex sz:items-center sz:gap-1.5 sz:max-w-full sz:min-w-0 sz:text-xs sz:font-ycom sz:rounded-md sz:py-0.5 sz:pr-1.5 sz:-ml-0.5 sz:pl-0.5 ${
          thinking
            ? 'sz-thinking-live sz:cursor-default'
            : `sz:cursor-pointer sz:text-gray-500 ${
                theme == 'dark' ? 'sz:hover:text-gray-300' : 'sz:hover:text-gray-700'
              }`
        }`}
      >
        <RightOutlined
          className={`sz:shrink-0 sz:text-[9px] sz:transition-transform sz:duration-200 sz:motion-reduce:transition-none ${
            expanded ? 'sz:rotate-90' : ''
          }`}
        />
        <span className="sz-thinking-label sz:truncate">{label}</span>
      </button>
      <div
        className={`sz:grid sz:w-full sz:transition-[grid-template-rows,opacity] sz:duration-300 sz:ease-out sz:motion-reduce:transition-none ${
          expanded ? 'sz:grid-rows-[1fr] sz:opacity-100' : 'sz:grid-rows-[0fr] sz:opacity-0'
        }`}
      >
        <div className="sz:overflow-hidden">
          <div
            ref={body}
            className={`sz-thinking-body sz:mt-1 sz:ml-1 sz:pl-3 sz:border-l-2 sz:max-h-40 sz:overflow-y-auto sz:text-xs sz:leading-5 sz:text-gray-500 ${
              theme == 'dark' ? 'sz:border-white/15' : 'sz:border-black/10'
            }`}
            style={{ scrollbarWidth: 'thin' }}
          >
            {thoughtsAndSearches(reasoning, searches).map((part, i) =>
              'text' in part ? (
                <MarkdownMessage key={i} content={part.text} />
              ) : (
                <div key={part.step.id} className="sz:flex sz:items-center sz:gap-1.5 sz:min-w-0 sz:py-0.5">
                  {part.step.done ? (
                    <GlobalOutlined className="sz:shrink-0" />
                  ) : (
                    <LoadingOutlined className="sz:shrink-0" />
                  )}
                  <span className="sz:truncate">
                    {part.step.query ??
                      (part.step.url ? hostOf(part.step.url) : t('chat.webSearch'))}
                  </span>
                  {part.step.results !== undefined ? (
                    <span className="sz:shrink-0">· {t('chat.searchResults', { count: part.step.results })}</span>
                  ) : null}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ThinkingBlock;
