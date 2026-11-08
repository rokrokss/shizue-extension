import { MAIN_TEXT_EXCLUDE, readPageContent } from '@/lib/mainText';
import { lineIndexOf, XRAY_CUT_CHARS, xrayPassages } from '@/lib/xray';

// The page side of an X-ray (lib/xray.ts): runs in the content script, where the page is.

// The line of `lines` (the page's main text) at the bottom of the screen, that is, how far the
// reader has read; -1 when nothing there is part of it (a fixed footer, a banner).
const readingLine = (lines: string[]) => {
  const x = window.innerWidth / 2;
  for (const share of [0.97, 0.85, 0.7, 0.5, 0.3]) {
    const y = window.innerHeight * share;
    // Firefox has only the standard caretPositionFromPoint.
    const node: Node | null | undefined =
      document.caretRangeFromPoint?.(x, y)?.startContainer ??
      (document as any).caretPositionFromPoint?.(x, y)?.offsetNode;
    if (!node) continue;
    let snippet = node.nodeType === Node.TEXT_NODE ? node.nodeValue ?? '' : '';
    // A short run of text (a link, a bold word) says too little; its element says more.
    if (snippet.replace(/\s/g, '').length < 12) {
      const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      const text = element?.textContent ?? '';
      if (text.length < 2_000) snippet = text;
    }
    const index = lineIndexOf(lines, snippet);
    if (index !== -1) return index;
  }
  return -1;
};

// The passages of this page that mention `term`. On a long page they stop at the bottom of the
// screen, or, when that can't be found in the text, at the selection.
export const xrayOfPage = (term: string) => {
  const { text } = readPageContent(MAIN_TEXT_EXCLUDE);
  let readTo: number | null = null;
  if (text.length > XRAY_CUT_CHARS) {
    const lines = text.split('\n');
    readTo = readingLine(lines);
    if (readTo === -1) {
      const selected = window.getSelection()?.anchorNode?.parentElement?.textContent ?? '';
      readTo = lineIndexOf(lines, selected.slice(0, 200));
    }
    // Nowhere to stop: the reader's place is unknown, so only the selected term itself goes.
    if (readTo === -1) readTo = 0;
  }
  const { passages } = xrayPassages(text, term, readTo);
  return { passages, cut: readTo !== null };
};
