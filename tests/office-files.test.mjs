import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { officeKind, readOfficeText, xhtmlText, xmlParagraphText } from '../src/lib/officeText.ts';

// A ZIP of the given files, deflated unless `stored` names them, the way Office and EPUB writers
// lay one out: local headers and data, then the central directory, then its end record.
const zip = (files, { stored = [], comment = '' } = {}) => {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBytes = Buffer.from(name);
    const raw = Buffer.from(content);
    const store = stored.includes(name);
    const data = store ? raw : deflateRawSync(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(store ? 0 : 8, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  const commentBytes = Buffer.from(comment);
  end.writeUInt16LE(commentBytes.length, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end, commentBytes]));
};

const LIMIT = 100_000;

test('the kind comes from the extension, and old binary formats have none', () => {
  assert.equal(officeKind('보고서.HWPX'), 'hwpx');
  assert.equal(officeKind('deck.pptx'), 'pptx');
  assert.equal(officeKind('book.epub'), 'epub');
  assert.equal(officeKind('old.hwp'), null);
  assert.equal(officeKind('old.doc'), null);
  assert.equal(officeKind('notes.txt'), null);
});

test('a Word file reads as paragraphs, with tabs, breaks and table rows, and a text box once', async () => {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr><w:r><w:t>Title &amp; intro</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Name:</w:t><w:tab/><w:t>Kim</w:t><w:br/><w:t>Second line</w:t></w:r></w:p>
<w:p/>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Price</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Desk</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>120</w:t></w:r></w:p><w:p><w:r><w:t>USD</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></w:drawing></mc:Choice><mc:Fallback><w:pict><w:txbxContent><w:p><w:r><w:t>Boxed</w:t></w:r></w:p></w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r><w:r><w:t>After the box</w:t></w:r></w:p>
</w:body></w:document>`;
  const text = await readOfficeText('docx', zip({ 'word/document.xml': document }), LIMIT);
  assert.equal(
    text,
    'Title & intro\nName:\tKim\nSecond line\n\nItem | Price\nDesk | 120 USD\nBoxed\nAfter the box'
  );
});

test('an Excel file reads sheet by sheet, with shared strings, empty columns and no phonetic guides', async () => {
  const files = {
    'xl/workbook.xml': `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>
      <sheet name="Prices" sheetId="1" r:id="rId1"/><sheet name="Empty" sheetId="2" r:id="rId2"/><sheet name="2024 &lt;Q1&gt;" sheetId="3" r:id="rId3"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="/xl/worksheets/sheet3.xml"/></Relationships>`,
    'xl/sharedStrings.xml': `<sst><si><t>Item</t></si><si><r><t>Pri</t></r><r><t>ce</t></r></si><si><t>東京</t><rPh sb="0" eb="2"><t>トウキョウ</t></rPh></si><si/></sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="b"><v>1</v></c><c r="C2"><f>1+2</f><v>3</v></c></row>
      <row r="3"><c r="A3" t="inlineStr"><is><t>inline</t></is></c><c r="B3" t="s"><v>3</v></c></row>
    </sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': '<worksheet><sheetData/></worksheet>',
    'xl/worksheets/sheet3.xml': '<worksheet><sheetData><row r="1"><c r="B1"><v>42.5</v></c></row></sheetData></worksheet>',
  };
  const text = await readOfficeText('xlsx', zip(files), LIMIT);
  assert.equal(text, '## Prices\nItem\t\tPrice\n東京\tTRUE\t3\ninline\n\n## 2024 <Q1>\n\t42.5');
});

test('a PowerPoint file reads its slides in the deck order, not file order', async () => {
  const slide = (text) => `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r><a:br/><a:r><a:t>more</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`;
  const files = {
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': '<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>',
    'ppt/slides/slide1.xml': slide('moved second'),
    'ppt/slides/slide2.xml': slide('moved first'),
  };
  const text = await readOfficeText('pptx', zip(files), LIMIT);
  assert.equal(text, '## Slide 1\nmoved first\nmore\n\n## Slide 2\nmoved second\nmore');
});

test('a HWPX file reads its sections in order, with a table inside a paragraph', async () => {
  const files = {
    mimetype: 'application/hwp+zip',
    'Contents/section1.xml': '<hs:sec><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>',
    'Contents/section0.xml': `<hs:sec xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
      <hp:p><hp:run><hp:t>공고<hp:tab width="4000"/>제2026-1호</hp:t></hp:run></hp:p>
      <hp:p><hp:run><hp:t>표 앞</hp:t><hp:tbl><hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList></hp:tc>
      <hp:tc><hp:subList><hp:p><hp:run><hp:t>금액</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr></hp:tbl></hp:run></hp:p>
      <hp:p><hp:run><hp:t>줄<hp:lineBreak/>바꿈<hp:fwSpace/>끝</hp:t></hp:run></hp:p></hs:sec>`,
  };
  const text = await readOfficeText('hwpx', zip(files, { stored: ['mimetype'] }), LIMIT);
  assert.equal(text, '공고\t제2026-1호\n구분 | 금액\n표 앞\n줄\n바꿈 끝\n\n둘째 구역');
});

test('an EPUB reads its spine in order, without the head, scripts or ruby readings', async () => {
  const files = {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': `<package><metadata><dc:title>Book</dc:title></metadata><manifest>
      <item id="c2" href="text/ch%202.xhtml" media-type="application/xhtml+xml"/>
      <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
      <item id="css" href="style.css" media-type="text/css"/></manifest>
      <spine><itemref idref="c1"/><itemref idref="css"/><itemref idref="c2"/></spine></package>`,
    'OEBPS/text/ch1.xhtml': `<!DOCTYPE html><html><head><title>Ch 1</title><style>p{}</style></head><body>
      <h1>Chapter&nbsp;One</h1><p>It was a <em>dark</em>
      night.</p><p><ruby>漢<rp>(</rp><rt>かん</rt><rp>)</rp></ruby>字</p><script>alert(1)</script><p>Last<br/>line</p></body></html>`,
    'OEBPS/text/ch 2.xhtml': '<html><body><p>Second chapter</p></body></html>',
  };
  const text = await readOfficeText('epub', zip(files, { stored: ['mimetype'] }), LIMIT);
  // A non-breaking space reads as a space, like the rest of the white space between words.
  assert.equal(text, 'Chapter One\nIt was a dark night.\n漢字\nLast\nline\n\nSecond chapter');
});

test('reading stops after the part that passes the limit', async () => {
  const section = (n) => `<hs:sec><hp:p><hp:run><hp:t>${String(n).repeat(60)}</hp:t></hp:run></hp:p></hs:sec>`;
  const files = Object.fromEntries([0, 1, 2, 3].map((n) => [`Contents/section${n}.xml`, section(n)]));
  const text = await readOfficeText('hwpx', zip(files), 100);
  assert.deepEqual(text.split('\n\n').map((part) => part[0]), ['0', '1']);
});

test('a ZIP comment is skipped, and a file that is not a ZIP fails', async () => {
  const files = { 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>ok</w:t></w:r></w:p></w:body></w:document>' };
  assert.equal(await readOfficeText('docx', zip(files, { comment: 'saved by a tool' }), LIMIT), 'ok');
  await assert.rejects(readOfficeText('docx', new TextEncoder().encode('not a zip at all, just text'), LIMIT));
  await assert.rejects(readOfficeText('docx', new Uint8Array(4), LIMIT));
});

test('the XML walkers decode entities and skip what is not text', () => {
  assert.equal(xmlParagraphText('<w:p><w:r><w:t>&#xAC00;&#44032;&lt;&gt;</w:t></w:r></w:p>'), '가가<>');
  assert.equal(xmlParagraphText('<w:p><w:r><w:instrText>PAGE</w:instrText><w:t>shown</w:t></w:r></w:p>'), 'shown');
  assert.equal(xhtmlText('<p>a &mdash; b</p><!-- note --><p><![CDATA[raw <x>]]></p>'), 'a — b\nraw <x>');
});
