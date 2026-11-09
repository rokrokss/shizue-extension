import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

const temporaries = [];
after(() => Promise.all(temporaries.map((file) => rm(file, { force: true }))));
const load = async (source) => {
  const temporary = fileURLToPath(new URL(`../.wxt/chat-lookup-${randomUUID()}.mjs`, import.meta.url));
  temporaries.push(temporary);
  await build({
    entryPoints: [fileURLToPath(new URL(source, import.meta.url))],
    outfile: temporary,
    bundle: true,
    platform: 'node',
    format: 'esm',
    packages: 'external',
    logLevel: 'silent',
  });
  return import(pathToFileURL(temporary).href);
};

const {
  fallbackSearchTerms,
  historyAddress,
  isSensitivePage,
  parseHistorySearchTerms,
  parseOpenTabPicks,
  pastFindsText,
  rankHistoryHits,
  snippetAround,
  tabCandidates,
  tabSite,
  CHAT_LINK_PATTERN,
} = await load('../src/lib/chatLookup.ts');
const { draftKeyOf, draftTextOf, withDraft, DRAFT_KEEP_MS, DRAFT_LIMIT, NEW_CHAT_DRAFT } = await load(
  '../src/lib/chatDrafts.ts'
);
const { continueCards, CONTINUE_DAYS_MS } = await load('../src/lib/continueCards.ts');

test('Banking, payments, health and mail sites are left out of what the chat looks through', () => {
  for (const url of [
    'https://www.kakaobank.com/accounts',
    'https://obank.kbstar.com/quics',
    'https://mail.google.com/mail/u/0/#inbox',
    'https://outlook.live.com/mail/0/',
    'https://www.paypal.com/myaccount',
    'https://mychart.example.org/visits',
    'https://www.samsunghospital.com/home',
  ]) {
    assert.equal(isSensitivePage(url), true, url);
  }
  assert.equal(isSensitivePage('https://example.com/', '우리은행 인터넷뱅킹'), true);
  assert.equal(isSensitivePage('https://example.com/', '受信トレイ - Mail'), true);
  for (const url of ['https://www.booking.com/hotel/jp/x.html', 'https://github.com/a/b', 'https://news.ycombinator.com/']) {
    assert.equal(isSensitivePage(url, 'A page'), false, url);
  }
});

test('Open tabs offered to the model: web tabs only, the latest used first, none the chat has', () => {
  const tabs = [
    { id: 9, title: 'Extension page', url: 'https://chromewebstore.google.com/detail/x/abc', lastAccessed: 95 },
    { id: 10, title: 'Old store', url: 'https://chrome.google.com/webstore/detail/x', lastAccessed: 96 },
    { id: 1, title: 'Hotel A', url: 'https://www.booking.com/a', lastAccessed: 10 },
    { id: 2, title: 'Hotel B', url: 'https://www.agoda.com/b#reviews', lastAccessed: 30 },
    { id: 3, title: 'Settings', url: 'chrome://settings', lastAccessed: 50 },
    { id: 4, title: 'Private', url: 'https://example.com/p', incognito: true, lastAccessed: 60 },
    { id: 5, title: 'Unloaded', url: 'https://example.com/u', discarded: true, lastAccessed: 70 },
    { id: 6, title: 'Bank', url: 'https://www.kakaobank.com/', lastAccessed: 80 },
    { id: 7, title: 'Hotel B again', url: 'https://www.agoda.com/b', lastAccessed: 20 },
    { id: 8, title: 'Already here', url: 'https://www.expedia.com/c', lastAccessed: 90 },
  ];
  const candidates = tabCandidates(tabs, ['https://www.expedia.com/c#top']);
  assert.deepEqual(
    candidates.map((tab) => tab.id),
    [2, 1]
  );
  assert.equal(tabSite('https://www.agoda.com/b/c?token=secret'), 'www.agoda.com/b/c');
});

test('Chrome Web Store pages, which Chrome keeps extensions out of: its new and old domains only', async () => {
  const { isWebStorePage } = await load('../src/lib/webStore.ts');
  for (const url of [
    'https://chromewebstore.google.com/',
    'https://chromewebstore.google.com/detail/shizue/mpcbgfkoholfgapcgcmfjobnfcbnfanm',
    'https://chrome.google.com/webstore/category/extensions',
    'https://chrome.google.com/',
  ]) {
    assert.equal(isWebStorePage(url), true, url);
  }
  for (const url of [
    undefined,
    '',
    'not a url',
    'https://www.google.com/chrome/',
    'https://support.google.com/chrome_webstore/answer/1',
    'https://notchromewebstore.google.com/',
    'https://example.com/?next=https://chromewebstore.google.com/',
  ]) {
    assert.equal(isWebStorePage(url), false, String(url));
  }
  assert.equal(tabSite('https://example.com/'), 'example.com');
});

test("The model's tab picks: numbered from 1, each once, within the list and the limit", () => {
  assert.deepEqual(parseOpenTabPicks('{"tabs": [3, 1, 3, 9, 0]}', 4, 5), [2, 0]);
  assert.deepEqual(parseOpenTabPicks('```json\n{"tabs": ["2"]}\n```', 4, 5), [1]);
  assert.deepEqual(parseOpenTabPicks('{"tabs": [1, 2, 3]}', 4, 2), [0, 1]);
  assert.deepEqual(parseOpenTabPicks('{"tabs": []}', 4, 5), []);
  assert.deepEqual(parseOpenTabPicks('no idea', 4, 5), []);
});

test('Search terms for history and past chats: short, each once, at most four; days kept in range', () => {
  assert.deepEqual(
    parseHistorySearchTerms('{"queries": [" walnut  desk ", "호두나무 책상", "walnut desk", "", "a", "b", "c"], "days": 14}'),
    { queries: ['walnut desk', '호두나무 책상', 'a', 'b'], days: 14 }
  );
  assert.deepEqual(parseHistorySearchTerms('{"queries": ["x"], "days": 9999}'), { queries: ['x'], days: 365 });
  assert.deepEqual(parseHistorySearchTerms('{"queries": ["x"]}'), { queries: ['x'], days: 0 });
  assert.equal(parseHistorySearchTerms('nothing'), null);
  assert.deepEqual(fallbackSearchTerms('지난주에 본 호두나무 책상 사이트 어디였지?').queries.slice(0, 2), ['지난주에', '호두나무']);
});

test('Visited pages more search terms found come first, then the latest; sensitive ones are left out', () => {
  const ranked = rankHistoryHits([
    [
      { url: 'https://shop.example/desk', title: 'Walnut desk', lastVisitTime: 100 },
      { url: 'https://other.example/', title: 'Desk ideas', lastVisitTime: 300 },
      { url: 'https://mail.google.com/x', title: 'Inbox', lastVisitTime: 400 },
    ],
    [
      { url: 'https://shop.example/desk#specs', title: 'Walnut desk', lastVisitTime: 200 },
      { url: 'chrome://history', title: 'History', lastVisitTime: 500 },
    ],
  ]);
  assert.deepEqual(
    ranked.map((hit) => [hit.url, hit.lastVisitTime]),
    [
      ['https://shop.example/desk', 200],
      ['https://other.example/', 300],
    ]
  );
});

test('Past finds go to the model as links it can point to', () => {
  const text = pastFindsText({
    pages: [{ url: 'https://shop.example/desk', title: 'Walnut [desk]', lastVisitTime: new Date(2026, 10, 2).getTime() }],
    chats: [{ threadId: 'abc-123', title: '존댓말', at: new Date(2026, 9, 3).getTime(), snippet: '…-요 is polite…' }],
  });
  assert.match(text, /\[Walnut desk\]\(https:\/\/shop\.example\/desk\) \(last visited 2026-11-02\)/);
  assert.match(text, /\[존댓말\]\(#chat=abc-123\) \(2026-10-03\): …-요 is polite…/);
  assert.equal('#chat=abc-123'.match(CHAT_LINK_PATTERN)?.[1], 'abc-123');
  assert.equal(snippetAround('a'.repeat(1000) + 'MATCH' + 'b'.repeat(1000), 1000, 60).includes('MATCH'), true);
  assert.equal(snippetAround('a  \n\n  b'.repeat(300) + 'MATCH', 3000, 40).includes('MATCH'), true);
});

test('A history link keeps what names the page and drops what may sign in', () => {
  assert.equal(historyAddress('https://www.youtube.com/watch?v=abc&t=30#top'), 'https://www.youtube.com/watch?v=abc&t=30');
  assert.equal(
    historyAddress('https://app.example/reset?token=s3cret&email=a%40b.c&page=2'),
    'https://app.example/reset?page=2'
  );
  assert.equal(historyAddress('https://shop.example/find?q=desk&api_key=x&code=1'), 'https://shop.example/find?q=desk');
  assert.equal(historyAddress('not a url'), 'not a url');
});

test('A draft is kept per chat until it is sent, and old or extra ones are dropped', () => {
  const now = 1_000_000_000_000;
  assert.equal(draftKeyOf(undefined), NEW_CHAT_DRAFT);
  assert.equal(draftKeyOf('t1'), 't1');
  let drafts = withDraft({}, 't1', 'half a question', now);
  assert.equal(draftTextOf(drafts, 't1', now), 'half a question');
  drafts = withDraft(drafts, 't1', '  ', now);
  assert.deepEqual(drafts, {});
  drafts = withDraft({ old: { text: 'stale', at: now - DRAFT_KEEP_MS - 1 } }, 'new', 'fresh', now);
  assert.deepEqual(Object.keys(drafts), ['new']);
  assert.equal(draftTextOf({ old: { text: 'stale', at: now - DRAFT_KEEP_MS - 1 } }, 'old', now), '');
  let many = {};
  for (let i = 0; i < DRAFT_LIMIT + 5; i++) many = withDraft(many, `t${i}`, `draft ${i}`, now + i);
  assert.equal(Object.keys(many).length, DRAFT_LIMIT);
  assert.equal(draftTextOf(many, 't0', now + 100), '');
  assert.equal(draftTextOf(many, `t${DRAFT_LIMIT + 4}`, now + 100), `draft ${DRAFT_LIMIT + 4}`);
});

test("Continue cards: the past week's chats whose pages are still open, latest first, three at most", () => {
  const now = 2_000_000_000_000;
  const chats = [
    { threadId: 'a', title: 'Tokyo hotels', updatedAt: now - 1000, urls: ['https://booking.com/a', 'https://agoda.com/b'] },
    { threadId: 'b', title: 'Old trip', updatedAt: now - CONTINUE_DAYS_MS - 1, urls: ['https://booking.com/a'] },
    { threadId: 'c', title: 'Nothing open', updatedAt: now - 500, urls: ['https://closed.example/'] },
    { threadId: 'd', title: 'Paper', updatedAt: now - 2000, urls: ['', 'https://arxiv.org/abs/1'] },
    { threadId: 'e', title: 'Paper 2', updatedAt: now - 3000, urls: ['https://arxiv.org/abs/1'] },
    { threadId: 'f', title: 'Paper 3', updatedAt: now - 4000, urls: ['https://arxiv.org/abs/1'] },
  ];
  const tabs = [
    { id: 1, url: 'https://booking.com/a#map', lastAccessed: 5 },
    { id: 2, url: 'https://agoda.com/b', lastAccessed: 9 },
    { id: 3, url: 'https://arxiv.org/abs/1', lastAccessed: 1 },
    { id: 4, url: 'https://booking.com/a', lastAccessed: 1 },
  ];
  const cards = continueCards(chats, tabs, now, 5);
  assert.deepEqual(
    cards.map((card) => [card.threadId, card.tabIds]),
    [
      ['a', [2, 1]],
      ['d', [3]],
      ['e', [3]],
    ]
  );
  assert.deepEqual(continueCards(chats.slice(0, 1), tabs, now, 1)[0].tabIds, [2]);
});
