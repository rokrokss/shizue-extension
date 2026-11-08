import CloseIcon from '@/assets/icons/close.svg?react';
import {
  MESSAGE_CONTEXT_MENU_PREVIEW_LINK,
  MESSAGE_FETCH_LINK_PREVIEW,
  MESSAGE_SUMMARIZE_LINK_PREVIEW,
} from '@/config/constants';
import { useThemeValue } from '@/hooks/layout';
import { useAnyModelAvailable } from '@/hooks/models';
import {
  isPreviewableUrl,
  LINK_PREVIEW_TEXT_CHARS,
  LinkPreviewError,
  LinkPreviewFetch,
  LinkPreviewSummary,
  previewText,
  readingMinutes,
} from '@/lib/linkPreview';
import { MAIN_TEXT_EXCLUDE } from '@/lib/mainText';
import { errorLog } from '@/logs';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// A link's preview card: hold Shift+Alt over a link, or pick "Preview link" in its context menu,
// and the page behind it shows here as its title, reading time and three key lines, without
// opening it (lib/linkPreview.ts).

type Preview = {
  url: string;
  // Where the card goes: under the link (or above it near the bottom of the screen).
  anchor: { left: number; top: number; bottom: number } | null;
  title?: string;
  minutes?: number;
  lines?: string[];
  error?: LinkPreviewError | 'noModel';
};

const CARD_WIDTH = 320;

// Previews already made on this page, by address.
const previews = new Map<string, Required<Pick<Preview, 'title' | 'minutes' | 'lines'>>>();

const linkAt = (event: Event) =>
  (event.composedPath()[0] as Element | undefined)?.closest?.<HTMLAnchorElement>('a[href]') ?? null;

const anchorOf = (rect: { left: number; top: number; bottom: number }) => ({
  left: rect.left,
  top: rect.top,
  bottom: rect.bottom,
});

const LinkPreview = () => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const anyModelAvailable = useAnyModelAvailable();
  const [preview, setPreview] = useState<Preview | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef<HTMLAnchorElement | null>(null);
  const contextRef = useRef<{ link: HTMLAnchorElement | null; x: number; y: number } | null>(null);
  // The address being previewed, so an answer for one closed or replaced since is dropped.
  const currentRef = useRef<string | null>(null);

  const show = useCallback(
    async (url: string, anchor: Preview['anchor']) => {
      currentRef.current = url;
      const update = (next: Preview) => {
        if (currentRef.current === url) setPreview(next);
      };
      if (!isPreviewableUrl(url)) return update({ url, anchor, error: 'notHttps' });
      const cached = previews.get(url);
      if (cached) return update({ url, anchor, ...cached });
      if (!anyModelAvailable) return update({ url, anchor, error: 'noModel' });
      update({ url, anchor });
      try {
        const page: LinkPreviewFetch = await chrome.runtime.sendMessage({
          action: MESSAGE_FETCH_LINK_PREVIEW,
          url,
        });
        if (!page?.success) return update({ url, anchor, error: page?.error ?? 'failed' });
        const { title: pageTitle, description, text } = previewText(page.html, MAIN_TEXT_EXCLUDE);
        const title = pageTitle || new URL(page.url).hostname;
        const minutes = readingMinutes(text);
        if (!text.trim() && !description) return update({ url, anchor, title, error: 'noText' });
        update({ url, anchor, title, minutes });
        const summary: LinkPreviewSummary = await chrome.runtime.sendMessage({
          action: MESSAGE_SUMMARIZE_LINK_PREVIEW,
          title,
          text: [description, text].filter(Boolean).join('\n\n').slice(0, LINK_PREVIEW_TEXT_CHARS),
        });
        if (!summary?.success) {
          return update({ url, anchor, title, minutes, error: summary?.error ?? 'failed' });
        }
        previews.set(url, { title, minutes, lines: summary.lines });
        update({ url, anchor, title, minutes, lines: summary.lines });
      } catch (error) {
        errorLog('Link preview failed:', error);
        update({ url, anchor, error: 'failed' });
      }
    },
    [anyModelAvailable]
  );

  const close = useCallback(() => {
    currentRef.current = null;
    setPreview(null);
  }, []);

  useEffect(() => {
    // Only the user's own pointer and keys: a page could otherwise make the extension fetch
    // addresses of its choosing and read the card back.
    const onMouseOver = (event: MouseEvent) => {
      if (!event.isTrusted) return;
      hoveredRef.current = linkAt(event);
    };
    const onContextMenu = (event: MouseEvent) => {
      contextRef.current = { link: linkAt(event), x: event.clientX, y: event.clientY };
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.isTrusted) return;
      if (event.key === 'Escape') {
        if (currentRef.current) close();
        return;
      }
      // Shift and Alt together, whichever went down last.
      if (event.repeat || !event.shiftKey || !event.altKey) return;
      if (event.key !== 'Shift' && event.key !== 'Alt') return;
      // Typing: Option+Shift writes characters on a Mac, and Alt+Shift switches layouts on Windows.
      const focused = event.composedPath()[0];
      if (
        focused instanceof HTMLElement &&
        (focused.isContentEditable || focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement)
      ) {
        return;
      }
      const link = hoveredRef.current;
      if (!link?.isConnected || !/^https?:$/.test(link.protocol)) return;
      void show(link.href, anchorOf(link.getBoundingClientRect()));
    };
    const onMouseDown = (event: MouseEvent) => {
      if (cardRef.current && !event.composedPath().includes(cardRef.current)) close();
    };
    const onMessage = (message: any) => {
      if (message?.action !== MESSAGE_CONTEXT_MENU_PREVIEW_LINK || !message.linkUrl) return;
      const context = contextRef.current;
      // The link is in this frame when the menu was opened here; one in a frame shows in a corner.
      let anchor: Preview['anchor'] = null;
      if (message.frameId === 0 && context) {
        anchor =
          context.link?.isConnected && context.link.href === message.linkUrl
            ? anchorOf(context.link.getBoundingClientRect())
            : { left: context.x, top: context.y, bottom: context.y };
      }
      void show(message.linkUrl, anchor);
    };
    document.addEventListener('mouseover', onMouseOver, { capture: true, passive: true });
    document.addEventListener('contextmenu', onContextMenu, { capture: true });
    document.addEventListener('keydown', onKeyDown, { capture: true });
    document.addEventListener('mousedown', onMouseDown, { capture: true });
    chrome.runtime.onMessage.addListener(onMessage);
    return () => {
      document.removeEventListener('mouseover', onMouseOver, { capture: true });
      document.removeEventListener('contextmenu', onContextMenu, { capture: true });
      document.removeEventListener('keydown', onKeyDown, { capture: true });
      document.removeEventListener('mousedown', onMouseDown, { capture: true });
      chrome.runtime.onMessage.removeListener(onMessage);
    };
  }, [show, close]);

  if (!preview) return null;

  const { anchor } = preview;
  const left = Math.max(8, Math.min(anchor?.left ?? Infinity, window.innerWidth - CARD_WIDTH - 8));
  // Below the link, unless it sits in the bottom third of the screen.
  const above = anchor !== null && anchor.bottom > (window.innerHeight * 2) / 3;
  const position = !anchor
    ? { top: 16 }
    : above
      ? { bottom: Math.max(8, window.innerHeight - anchor.top + 8) }
      : { top: Math.max(8, anchor.bottom + 8) };
  const loading = !preview.error && !preview.lines;
  let host = preview.url;
  try {
    host = new URL(preview.url).hostname;
  } catch {}

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={t('linkPreview.title')}
      style={{
        position: 'fixed',
        left,
        width: CARD_WIDTH,
        zIndex: 2147483647,
        filter: theme === 'dark' ? 'invert(1) hue-rotate(180deg)' : 'none',
        ...position,
      }}
      className={[
        'sz:flex sz:flex-col sz:gap-2 sz:p-3 sz:rounded-xl sz:bg-white sz:text-[#1f1f1f]',
        'sz:shadow-[0_6px_24px_rgba(0,0,0,0.18)] sz:border sz:border-[#e5e5e5]',
        'sz:font-ycom sz:text-[13px] sz:leading-[1.5]',
      ].join(' ')}
    >
      <div className="sz:flex sz:flex-row sz:items-start sz:gap-2">
        <div className="sz:flex sz:flex-col sz:min-w-0 sz:flex-1">
          <div className="sz:font-bold sz:text-[14px] sz:line-clamp-2 sz:break-words">
            {preview.title ?? host}
          </div>
          <div className="sz:text-[12px] sz:text-[#777] sz:truncate">
            {host}
            {preview.minutes ? ` · ${t('linkPreview.minutes', { count: preview.minutes })}` : ''}
          </div>
        </div>
        <button
          type="button"
          aria-label={t('linkPreview.close')}
          onClick={close}
          className={[
            'sz:shrink-0 sz:w-5 sz:h-5 sz:p-0 sz:border-0 sz:bg-transparent sz:cursor-pointer',
            'sz:text-[#999]',
          ].join(' ')}
        >
          <CloseIcon className="sz:w-full sz:h-full" />
        </button>
      </div>
      {loading ? (
        <div className="sz:text-[#777]">{t('linkPreview.loading')}</div>
      ) : preview.error ? (
        <div className="sz:text-[#b4532a]">{t(`linkPreview.error.${preview.error}`)}</div>
      ) : (
        <ul className="sz:m-0 sz:pl-4 sz:flex sz:flex-col sz:gap-1 sz:list-disc">
          {preview.lines!.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={close}
        className="sz:self-end sz:text-[12px] sz:text-[#14806f] sz:no-underline"
      >
        {t('linkPreview.open')}
      </a>
    </div>
  );
};

export default LinkPreview;
