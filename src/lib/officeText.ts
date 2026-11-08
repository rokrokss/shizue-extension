// The text of Word, Excel, PowerPoint, HWPX and EPUB files. Each is a ZIP of XML, so this reads
// the ZIP's central directory, inflates only the XML it needs (DecompressionStream, no library)
// and walks the XML with a small tokenizer instead of DOMParser, which the tests' Node lacks.

export type OfficeKind = 'docx' | 'xlsx' | 'pptx' | 'hwpx' | 'epub';

const OFFICE_KINDS: OfficeKind[] = ['docx', 'xlsx', 'pptx', 'hwpx', 'epub'];

export const officeKind = (name: string): OfficeKind | null => {
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  return (OFFICE_KINDS as string[]).includes(extension) ? (extension as OfficeKind) : null;
};

// One XML part inflated past this is a ZIP bomb, not a document.
const MAX_PART_BYTES = 64 * 1024 * 1024;

type ZipEntry = { method: number; flags: number; compressedSize: number; offset: number };

const readZipEntries = (bytes: Uint8Array): Map<string, ZipEntry> => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record sits in the last 22 bytes plus a comment of up to 64 KiB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error('not a zip file');
  const count = view.getUint16(end + 10, true);
  let p = view.getUint32(end + 16, true);
  // ZIP64 (over 4 GiB or 65,535 files) never holds a document worth reading here.
  if (p === 0xffffffff || count === 0xffff) throw new Error('zip64 is not supported');
  const names = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('broken central directory');
    const nameLength = view.getUint16(p + 28, true);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLength));
    entries.set(name, {
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      compressedSize: view.getUint32(p + 20, true),
      offset: view.getUint32(p + 42, true),
    });
    p += 46 + nameLength + view.getUint16(p + 30, true) + view.getUint16(p + 32, true);
  }
  return entries;
};

const inflate = async (data: Uint8Array): Promise<Uint8Array> => {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'))
    .getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_PART_BYTES) {
      await reader.cancel();
      throw new Error('zip part too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
};

type Zip = { names: string[]; text: (name: string) => Promise<string | null> };

const openZip = (bytes: Uint8Array): Zip => {
  const entries = readZipEntries(bytes);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  return {
    names: [...entries.keys()],
    text: async (name) => {
      const entry = entries.get(name);
      if (!entry) return null;
      // An encrypted part can't be read without the password.
      if (entry.flags & 1) throw new Error('encrypted');
      const p = entry.offset;
      if (view.getUint32(p, true) !== 0x04034b50) throw new Error('broken local header');
      const start = p + 30 + view.getUint16(p + 26, true) + view.getUint16(p + 28, true);
      const data = bytes.subarray(start, start + entry.compressedSize);
      if (entry.method === 0) return decoder.decode(data);
      if (entry.method === 8) return decoder.decode(await inflate(data));
      throw new Error(`compression method ${entry.method}`);
    },
  };
};

// XML tokens: CDATA, comments and declarations (skipped), tags with their attributes (a quoted
// value may hold '>'; a sloppy EPUB's unquoted or bare HTML attribute passes too), and text.
const TOKEN =
  /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<[?!][^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*(\/?)>|([^<]+)/g;

type XmlEvent =
  | { type: 'open'; name: string; attrs: string; empty: boolean }
  | { type: 'close'; name: string }
  | { type: 'text'; text: string };

// Element names lose their prefix (w:p, a:p and hp:p are all "p").
const localName = (name: string) => name.slice(name.indexOf(':') + 1);

function* xmlEvents(xml: string): Generator<XmlEvent> {
  for (const match of xml.matchAll(TOKEN)) {
    if (match[1] !== undefined) yield { type: 'text', text: match[1] };
    else if (match[6] !== undefined) yield { type: 'text', text: decodeEntities(match[6]) };
    else if (match[3] !== undefined) {
      const name = localName(match[3]);
      if (match[2]) yield { type: 'close', name };
      else yield { type: 'open', name, attrs: match[4] ?? '', empty: match[5] === '/' };
    }
  }
}

const attribute = (attrs: string, name: string) => {
  for (const match of attrs.matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    if (match[1] === name || localName(match[1]) === name) {
      return decodeEntities(match[2] ?? match[3] ?? '');
    }
  }
  return undefined;
};

// The relationship id on <sldId> and <sheet>, under whatever prefix the writer bound it to
// (Office always says r:id).
const relationshipId = (attrs: string) => {
  for (const match of attrs.matchAll(/([^\s=]+:id)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    return match[2] ?? match[3] ?? '';
  }
  return '';
};

// XML's own entities and the HTML ones EPUB 2 books still use.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', mdash: '—', ndash: '–',
  hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  middot: '·', bull: '•', copy: '©', reg: '®', trade: '™', shy: '',
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const hex = code[1] === 'x' || code[1] === 'X';
      const point = hex ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(point) && point <= 0x10ffff ? String.fromCodePoint(point) : whole;
    }
    return NAMED_ENTITIES[code] ?? whole;
  });

// Blank lines kept to one, and none at the ends.
const tidy = (lines: string[]) =>
  lines
    .map((line) => line.replace(/[ \u00a0]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Paragraphs of WordprocessingML (docx), DrawingML (pptx) and OWPML (hwpx), which share a shape:
// text runs in <t> inside <p>, tabs and line breaks as their own elements, and tables as rows of
// cells, each a list of paragraphs. A row reads "cell | cell". OWPML puts a table inside a
// paragraph, so paragraphs and tables keep stacks.
export const xmlParagraphText = (xml: string): string => {
  const lines: string[] = [];
  const paragraphs: string[] = [];
  const rows: string[][] = [];
  const cells: string[][] = [];
  const path: string[] = [];
  let inText = 0;
  // Word saves a text box twice, as DrawingML and as VML in <mc:Fallback>; only the first is read.
  let skip = 0;
  const emit = (line: string) => {
    if (cells.length > 0) cells[cells.length - 1].push(line.trim());
    else lines.push(line);
  };
  const append = (text: string) => {
    if (paragraphs.length > 0) paragraphs[paragraphs.length - 1] += text;
  };
  for (const event of xmlEvents(xml)) {
    if (event.type === 'text') {
      if (inText > 0 && skip === 0) append(event.text);
      continue;
    }
    const { name } = event;
    if (event.type === 'open') {
      const parent = path[path.length - 1];
      if (!event.empty) path.push(name);
      if (name === 'Fallback') {
        if (!event.empty) skip++;
        continue;
      }
      if (skip > 0) continue;
      if (name === 't' && !event.empty) inText++;
      // A <tab> in a run or in <t> is a tab character; in <tabs> or <tabLst> it is a tab stop.
      else if (name === 'tab' && (parent === 'r' || parent === 't')) append('\t');
      else if ((name === 'br' || name === 'cr' || name === 'lineBreak') && parent !== 'pPr') {
        append('\n');
      } else if ((name === 'nbSpace' || name === 'fwSpace') && parent === 't') append(' ');
      else if (name === 'p' && !event.empty) paragraphs.push('');
      else if (name === 'p') emit('');
      else if (name === 'tr' && !event.empty) rows.push([]);
      else if (name === 'tc' && !event.empty) cells.push([]);
      continue;
    }
    path.pop();
    if (name === 'Fallback') {
      skip = Math.max(0, skip - 1);
      continue;
    }
    if (skip > 0) continue;
    if (name === 't') inText = Math.max(0, inText - 1);
    else if (name === 'p') emit(paragraphs.pop() ?? '');
    else if (name === 'tc') {
      const cell = (cells.pop() ?? []).filter(Boolean).join(' ');
      rows[rows.length - 1]?.push(cell);
    }
    else if (name === 'tr') {
      const row = rows.pop() ?? [];
      if (row.some(Boolean)) emit(row.join(' | '));
    }
  }
  return tidy(lines);
};

// A part's relationships: rId → path inside the ZIP, resolved against the part's folder.
const relationships = async (zip: Zip, part: string) => {
  const folder = part.slice(0, part.lastIndexOf('/') + 1);
  const rels = await zip.text(`${folder}_rels/${part.slice(folder.length)}.rels`);
  const targets = new Map<string, string>();
  if (!rels) return targets;
  for (const event of xmlEvents(rels)) {
    if (event.type !== 'open' || event.name !== 'Relationship') continue;
    const id = attribute(event.attrs, 'Id');
    const target = attribute(event.attrs, 'Target');
    if (id && target) targets.set(id, resolvePath(folder, target));
  }
  return targets;
};

// A relative href against a folder, with ".." and "." taken out; "/x" is from the ZIP's root.
const resolvePath = (folder: string, href: string) => {
  const target = safeDecode(href.split('#')[0]);
  const parts = (target.startsWith('/') ? target.slice(1) : folder + target).split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
};

const safeDecode = (text: string) => {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
};

const byNumber = (pattern: RegExp) => (names: string[]) =>
  names
    .flatMap((name) => {
      const match = name.match(pattern);
      return match ? [{ name, n: Number(match[1]) }] : [];
    })
    .sort((a, b) => a.n - b.n)
    .map(({ name }) => name);

// Each part in order, stopping once the text holds `limit` characters, like a PDF's pages.
const readParts = async (
  parts: string[],
  limit: number,
  read: (part: string, index: number) => Promise<string>
) => {
  const sections: string[] = [];
  let length = 0;
  for (let i = 0; i < parts.length && length < limit; i++) {
    const section = await read(parts[i], i);
    if (!section) continue;
    sections.push(section);
    length += section.length + 2;
  }
  return sections.join('\n\n');
};

const readDocx = async (zip: Zip) => xmlParagraphText((await zip.text('word/document.xml')) ?? '');

const readPptx = async (zip: Zip, limit: number) => {
  // The deck's order is presentation.xml's slide list; slide file numbers keep their first order.
  const presentation = (await zip.text('ppt/presentation.xml')) ?? '';
  const rels = await relationships(zip, 'ppt/presentation.xml');
  const listed: string[] = [];
  for (const event of xmlEvents(presentation)) {
    if (event.type !== 'open' || event.name !== 'sldId') continue;
    const target = rels.get(relationshipId(event.attrs));
    if (target && zip.names.includes(target)) listed.push(target);
  }
  const slides = listed.length > 0 ? listed : byNumber(/^ppt\/slides\/slide(\d+)\.xml$/)(zip.names);
  return readParts(slides, limit, async (slide, i) => {
    const text = xmlParagraphText((await zip.text(slide)) ?? '');
    return text ? `## Slide ${i + 1}\n${text}` : '';
  });
};

const readHwpx = async (zip: Zip, limit: number) =>
  readParts(byNumber(/^Contents\/section(\d+)\.xml$/)(zip.names), limit, async (section) =>
    xmlParagraphText((await zip.text(section)) ?? '')
  );

const columnIndex = (ref: string | undefined) => {
  const letters = ref?.match(/^[A-Z]+/i)?.[0].toUpperCase();
  if (!letters) return -1;
  let n = 0;
  for (const letter of letters) n = n * 26 + letter.charCodeAt(0) - 64;
  return n - 1;
};

// Text of each <si>, without the phonetic guides (<rPh>) Japanese workbooks add.
const sharedStrings = (xml: string) => {
  const strings: string[] = [];
  let current: string | null = null;
  let inText = false;
  let phonetic = 0;
  for (const event of xmlEvents(xml)) {
    if (event.type === 'text') {
      if (current !== null && inText && phonetic === 0) current += event.text;
    } else if (event.type === 'open') {
      if (event.name === 'si' && event.empty) strings.push('');
      else if (event.name === 'si') current = '';
      else if (event.name === 'rPh' && !event.empty) phonetic++;
      else if (event.name === 't' && !event.empty) inText = true;
    } else if (event.name === 'si') {
      strings.push(current ?? '');
      current = null;
    } else if (event.name === 'rPh') phonetic--;
    else if (event.name === 't') inText = false;
  }
  return strings;
};

// Rows as tab-separated cells, empty columns kept so values stay under their headers. Dates and
// formatted numbers come as Excel stores them (a date is a day count), since styles aren't read.
const sheetRows = (xml: string, strings: string[]) => {
  const lines: string[] = [];
  let row: string[] | null = null;
  let cell: { column: number; type?: string; value: string } | null = null;
  let capture = false;
  for (const event of xmlEvents(xml)) {
    if (event.type === 'text') {
      if (cell && capture) cell.value += event.text;
    } else if (event.type === 'open') {
      if (event.name === 'row') row = event.empty ? null : [];
      else if (event.name === 'c' && row && !event.empty) {
        const column = columnIndex(attribute(event.attrs, 'r'));
        const type = attribute(event.attrs, 't');
        cell = { column: column < 0 ? row.length : column, type, value: '' };
      } else if ((event.name === 'v' || event.name === 't') && !event.empty) capture = true;
    } else if (event.name === 'v' || event.name === 't') capture = false;
    else if (event.name === 'c' && row && cell) {
      const { column, type, value } = cell;
      if (type === 's') row[column] = strings[Number(value)] ?? '';
      else if (type === 'b') row[column] = value === '1' ? 'TRUE' : 'FALSE';
      else row[column] = value;
      cell = null;
    } else if (event.name === 'row' && row) {
      const cells = Array.from(row, (value) => (value ?? '').replace(/\s*\n\s*/g, ' '));
      while (cells.length > 0 && !cells[cells.length - 1]) cells.pop();
      if (cells.length > 0) lines.push(cells.join('\t'));
      row = null;
    }
  }
  return lines.join('\n');
};

const readXlsx = async (zip: Zip, limit: number) => {
  const workbook = (await zip.text('xl/workbook.xml')) ?? '';
  const rels = await relationships(zip, 'xl/workbook.xml');
  const strings = sharedStrings((await zip.text('xl/sharedStrings.xml')) ?? '');
  const sheets: { name: string; part: string }[] = [];
  for (const event of xmlEvents(workbook)) {
    if (event.type !== 'open' || event.name !== 'sheet') continue;
    const part = rels.get(relationshipId(event.attrs));
    if (part) sheets.push({ name: attribute(event.attrs, 'name') ?? '', part });
  }
  return readParts(
    sheets.map(({ part }) => part),
    limit,
    async (part, i) => {
      const rows = sheetRows((await zip.text(part)) ?? '', strings);
      return rows ? `## ${sheets[i].name}\n${rows}` : '';
    }
  );
};

const BLOCK_TAGS = new Set([
  'p', 'div', 'br', 'hr', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'tr', 'table', 'section', 'article',
  'aside', 'header', 'footer', 'nav', 'blockquote', 'pre', 'figure', 'figcaption', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6',
]);

// An EPUB chapter's text: each block on its own line, without <head>, scripts, styles or the
// readings ruby puts over Japanese and Chinese words (<rt>, <rp>).
export const xhtmlText = (xhtml: string) => {
  let text = '';
  let skip = 0;
  let pre = 0;
  for (const event of xmlEvents(xhtml)) {
    const name = event.type === 'text' ? '' : event.name.toLowerCase();
    if (event.type === 'text') {
      if (skip === 0) text += pre > 0 ? event.text : event.text.replace(/\s+/g, ' ');
    } else if (['head', 'script', 'style', 'rt', 'rp'].includes(name)) {
      if (event.type === 'close') skip = Math.max(0, skip - 1);
      else if (!event.empty) skip++;
    } else if (skip === 0 && BLOCK_TAGS.has(name)) {
      if (name === 'pre') pre = Math.max(0, pre + (event.type === 'close' ? -1 : event.empty ? 0 : 1));
      text += '\n';
    }
  }
  // Blocks open and close with a line break each, so the blank lines between them are dropped.
  return tidy(
    text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );
};

const readEpub = async (zip: Zip, limit: number) => {
  const container = (await zip.text('META-INF/container.xml')) ?? '';
  let opfPath = '';
  for (const event of xmlEvents(container)) {
    if (event.type === 'open' && event.name === 'rootfile') {
      opfPath = attribute(event.attrs, 'full-path') ?? '';
      break;
    }
  }
  const opf = (opfPath && (await zip.text(opfPath))) || '';
  const folder = opfPath.slice(0, opfPath.lastIndexOf('/') + 1);
  const items = new Map<string, { href: string; type: string }>();
  const spine: string[] = [];
  for (const event of xmlEvents(opf)) {
    if (event.type !== 'open') continue;
    if (event.name === 'item') {
      const id = attribute(event.attrs, 'id');
      const href = attribute(event.attrs, 'href');
      if (id && href) items.set(id, { href, type: attribute(event.attrs, 'media-type') ?? '' });
    } else if (event.name === 'itemref') {
      const item = items.get(attribute(event.attrs, 'idref') ?? '');
      if (item && /html/i.test(item.type)) spine.push(resolvePath(folder, item.href));
    }
  }
  return readParts(spine, limit, async (chapter) => xhtmlText((await zip.text(chapter)) ?? ''));
};

// The document's text, part by part until it holds `limit` characters (the caller cuts it to fit
// and marks it cut). Throws when the file isn't a readable ZIP of that kind.
export const readOfficeText = async (kind: OfficeKind, bytes: Uint8Array, limit: number) => {
  const zip = openZip(bytes);
  switch (kind) {
    case 'docx':
      return readDocx(zip);
    case 'xlsx':
      return readXlsx(zip, limit);
    case 'pptx':
      return readPptx(zip, limit);
    case 'hwpx':
      return readHwpx(zip, limit);
    case 'epub':
      return readEpub(zip, limit);
  }
};
