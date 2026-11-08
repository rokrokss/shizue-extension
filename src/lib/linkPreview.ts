// A link's preview card (components/Toggle/LinkPreview.tsx): the page behind a link, read without
// opening it. The background fetches it (https only, without cookies, up to
// LINK_PREVIEW_MAX_BYTES), the page parses it, since the service worker has no DOMParser, and the
// chat model gives three key lines (services/background/linkPreview.ts).

export const LINK_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;
// What the model reads of the page: enough for its gist.
export const LINK_PREVIEW_TEXT_CHARS = 12_000;

export type LinkPreviewError = 'notHttps' | 'tooBig' | 'notPage' | 'noText' | 'failed';

export type LinkPreviewFetch =
  | { success: true; html: string; url: string }
  | { success: false; error: LinkPreviewError };

export type LinkPreviewSummary =
  | { success: true; lines: string[] }
  | { success: false; error: LinkPreviewError; message?: string };

export const isPreviewableUrl = (url: string) => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

// Minutes to read `text`: words in scripts that space them, characters in those that don't
// (Chinese, Japanese, Korean read about 500 a minute; Korean spaces words, but they are short).
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/g;

export const readingMinutes = (text: string) => {
  const cjk = (text.match(CJK) ?? []).length;
  const words = text
    .replace(CJK, ' ')
    .split(/\s+/)
    .filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
  return Math.max(1, Math.round(cjk / 500 + words / 230));
};

export const LINK_PREVIEW_JSON_SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
};

// The model's key lines: at most three, without list marks.
export const parsePreviewLines = (answer: string): string[] => {
  // The JSON, wherever the model put it among other words or a code fence; JSON that doesn't parse
  // shows the error, not its pieces. A model without JSON mode may answer with a list instead: its
  // items, or its lines when none is marked.
  let lines: unknown;
  if (answer.includes('{')) {
    try {
      lines = JSON.parse(answer.match(/\{[\s\S]*\}/)?.[0] ?? '')?.lines;
    } catch {
      lines = undefined;
    }
  } else {
    const all = answer.split('\n').filter((line) => line.trim());
    const items = all.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s/.test(line));
    lines = items.length ? items : all;
  }
  if (!Array.isArray(lines)) return [];
  return lines
    .filter((line): line is string => typeof line === 'string')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 3);
};

// The page's title and main text, from its HTML. A parsed document has no layout, so innerText
// would run its paragraphs together: the text is gathered block by block instead.
export const previewText = (html: string, exclude: string) => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (selector: string) =>
    doc.querySelector<HTMLMetaElement>(selector)?.content?.trim() ?? '';
  const title = meta('meta[property="og:title"]') || doc.title.trim();
  const description = meta('meta[property="og:description"]') || meta('meta[name="description"]');
  doc.querySelectorAll('script, style, noscript, template, svg, iframe').forEach((e) => e.remove());
  doc.querySelectorAll(exclude).forEach((element) => element.remove());
  const chars = (element: Element) => (element.textContent ?? '').replace(/\s/g, '').length;
  let root: Element | null = doc.querySelector('main, [role="main"]');
  if (!root || chars(root) < 200) root = doc.body;
  let article: Element | null = null;
  for (const candidate of Array.from(root?.querySelectorAll('article') ?? [])) {
    if (candidate.parentElement?.closest('article')) continue;
    if (!article || chars(candidate) > chars(article)) article = candidate;
  }
  if (article && root && chars(article) * 3 >= chars(root) * 2) root = article;
  const blocks = Array.from(
    root?.querySelectorAll('h1, h2, h3, h4, p, li, blockquote, pre, td, dd, figcaption') ?? []
  )
    // A block inside another (a <p> in an <li>) is read with its parent.
    .filter((block) => !block.parentElement?.closest('p, li, blockquote, pre, td, dd, figcaption'))
    .map((block) => (block.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  let text = blocks.join('\n');
  if (text.replace(/\s/g, '').length < 200) {
    text = (root?.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  }
  return { title, description, text };
};
