import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPreviewableUrl,
  parsePreviewLines,
  readingMinutes,
} from '../src/lib/linkPreview.ts';
import { hasPageLines, pageLines } from '../src/lib/pageLines.ts';
import { lineIndexOf, termPattern, xrayPassages } from '../src/lib/xray.ts';

test('A link preview fetches only https pages', () => {
  assert.equal(isPreviewableUrl('https://example.com/a'), true);
  assert.equal(isPreviewableUrl('http://example.com/a'), false);
  assert.equal(isPreviewableUrl('javascript:alert(1)'), false);
  assert.equal(isPreviewableUrl('not a url'), false);
});

test('Reading time counts words, or characters in Chinese, Japanese and Korean', () => {
  assert.equal(readingMinutes('word '.repeat(460)), 2);
  assert.equal(readingMinutes('가'.repeat(1000)), 2);
  assert.equal(readingMinutes('短い'), 1);
  assert.equal(readingMinutes(''), 1);
});

test("The model's key lines: at most three, from JSON or plain lines", () => {
  assert.deepEqual(parsePreviewLines('{"lines": ["One.", "Two.", "Three.", "Four."]}'), [
    'One.',
    'Two.',
    'Three.',
  ]);
  assert.deepEqual(parsePreviewLines('```json\n{"lines": ["  A  b "]}\n```'), ['A b']);
  assert.deepEqual(parsePreviewLines('- First\n2. Second\n\n• Third'), ['First', 'Second', 'Third']);
  assert.deepEqual(parsePreviewLines('Key points:\n- First\n- Second'), ['First', 'Second']);
  assert.deepEqual(parsePreviewLines('Here you go:\n```json\n{"lines": ["One", '), []);
  assert.deepEqual(parsePreviewLines('{"lines": "nope"}'), []);
});

test('An X-ray term matches whole words where words are spaced, and before particles elsewhere', () => {
  assert.equal(termPattern('art').test('Start here.'), false);
  assert.equal(termPattern('art').test('Modern Art, they said.'), true);
  assert.equal(termPattern("Gatsby").test("Gatsby's party"), true);
  assert.equal(termPattern('철수').test('철수는 집에 갔다.'), true);
  assert.equal(termPattern('New York').test('in new  york today'), true);
  assert.equal(termPattern('C++').test('Written in C++ mostly'), true);
});

test('X-ray passages are the lines that mention the term, numbered in page order', () => {
  const text = ['Intro without it.', 'Ahab paces the deck.', 'Nothing here.', 'Ishmael watches Ahab.'].join(
    '\n'
  );
  const { passages, count } = xrayPassages(text, 'Ahab', null);
  assert.equal(count, 2);
  assert.equal(passages, '[¶1] Ahab paces the deck.\n[¶2] Ishmael watches Ahab.');
  // The [¶n] buttons find each passage again (lib/pageLines.ts).
  assert.equal(hasPageLines(passages), true);
  assert.equal(pageLines(passages).get(2), 'Ishmael watches Ahab.');
});

test('X-ray passages stop where the reader is', () => {
  const text = ['Ahab one.', 'Ahab two.', 'Ahab three (later).'].join('\n');
  assert.equal(xrayPassages(text, 'Ahab', 1).passages, '[¶1] Ahab one.\n[¶2] Ahab two.');
  assert.equal(xrayPassages(text, 'Ahab', 0).count, 1);
});

test('Too many passages are thinned evenly, keeping the first and the last', () => {
  const lines = Array.from({ length: 400 }, (_, i) => `Line ${i}: Ahab ${'x'.repeat(200)}`);
  const { passages, count } = xrayPassages(lines.join('\n'), 'Ahab', null);
  assert.equal(count, 400);
  const kept = passages.split('\n');
  assert.ok(kept.length < 400 && kept.length > 10);
  assert.match(kept[0], /^\[¶1\] Line 0:/);
  assert.match(kept[kept.length - 1], /Line 399:/);
  assert.ok(passages.length <= 21_000);
});

test('A long passage is cut to the part around its mention', () => {
  const line = `${'before '.repeat(400)}Ahab${' after'.repeat(400)}`;
  const { passages } = xrayPassages(line, 'Ahab', null);
  assert.ok(passages.length < 1_300);
  assert.match(passages, /Ahab/);
});

test("The reader's place is found in the page text despite spacing and case", () => {
  const lines = ['Chapter 1', 'Call me Ishmael. Some years ago—never mind how long.', 'Next line'];
  assert.equal(lineIndexOf(lines, '  call me   ishmael. some years'), 1);
  assert.equal(lineIndexOf(lines, 'Ch'), -1);
  assert.equal(lineIndexOf(lines, 'Not on this page at all'), -1);
});
