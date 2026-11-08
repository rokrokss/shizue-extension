// "X-ray in this page": a term or name the reader selected, explained by the passages of the page
// that mention it, numbered like a summary's lines ([¶3]) so the answer points back to them
// (lib/pageLines.ts, lib/pageSeek.ts).

// Only what the reader has reached goes to the model, on any page, so the answer can't give away
// what comes later (lib/xrayPage.ts). A term defined further down an article is left out with it.
// What the passages may take in the prompt, and one passage around its first mention.
const XRAY_PASSAGE_CHARS = 20_000;
const XRAY_LINE_CHARS = 1_200;

// Letters of scripts that put spaces between words: a term there must not sit inside a longer
// word ("art" in "start"). Other scripts glue particles to it ("철수는"), so they get no
// boundary.
const WORD_CHAR = 'A-Za-z0-9\\u00C0-\\u024F\\u0370-\\u03FF\\u0400-\\u04FF';

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const termPattern = (term: string) =>
  new RegExp(
    `(?<![${WORD_CHAR}])${escapeRegExp(term.trim()).replace(/\s+/g, '\\s+')}(?![${WORD_CHAR}])`,
    'iu'
  );

const fold = (text: string) => text.replace(/\s/g, '').toLowerCase();

// The index of the line that holds `snippet` (ignoring spaces and case, as innerText and the DOM
// space text differently), or -1.
export const lineIndexOf = (lines: string[], snippet: string) => {
  const needle = fold(snippet).slice(0, 60);
  if (needle.length < 6) return -1;
  return lines.findIndex((line) => fold(line).includes(needle));
};

// A long line cut to the part around its first mention, starting at a word.
const around = (line: string, at: number) => {
  if (line.length <= XRAY_LINE_CHARS) return line;
  let start = Math.max(0, at - XRAY_LINE_CHARS / 3);
  const space = line.lastIndexOf(' ', start);
  if (space > start - 40) start = space + 1;
  return line.slice(start, start + XRAY_LINE_CHARS).trim();
};

// The page's lines that mention `term`, up to line `readTo` when the reader is part way through,
// numbered [¶1], [¶2]… in page order. Too many to send are thinned evenly, keeping the first
// and the last.
export const xrayPassages = (text: string, term: string, readTo: number | null) => {
  const pattern = termPattern(term);
  const lines = text.split('\n');
  const last = readTo === null ? lines.length - 1 : Math.min(readTo, lines.length - 1);
  const found: string[] = [];
  for (let i = 0; i <= last; i++) {
    const match = pattern.exec(lines[i]);
    if (match) found.push(around(lines[i].trim(), match.index));
  }
  let kept = found;
  const total = found.reduce((sum, line) => sum + line.length + 8, 0);
  if (total > XRAY_PASSAGE_CHARS) {
    const keep = Math.max(2, Math.floor((found.length * XRAY_PASSAGE_CHARS) / total));
    kept = Array.from({ length: keep }, (_, i) =>
      found[Math.round((i * (found.length - 1)) / (keep - 1))]
    );
  }
  return {
    passages: kept.map((line, i) => `[¶${i + 1}] ${line}`).join('\n'),
    count: found.length,
  };
};
