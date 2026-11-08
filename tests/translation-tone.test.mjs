import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  toneLanguage,
  toneRule,
  translationCacheLanguage,
  translationToneFor,
} from '../src/lib/translationTone.ts';

const temporaries = [];
after(() => Promise.all(temporaries.map((file) => rm(file, { force: true }))));
const load = async (source) => {
  const temporary = fileURLToPath(new URL(`../.wxt/translation-tone-${randomUUID()}.mjs`, import.meta.url));
  temporaries.push(temporary);
  await build({ entryPoints: [fileURLToPath(new URL(source, import.meta.url))], outfile: temporary, bundle: true, platform: 'node', format: 'esm', packages: 'external', logLevel: 'silent' });
  return import(pathToFileURL(temporary).href);
};
const { getHtmlTranslationBatchPrompt } = await load('../src/lib/prompts.ts');

const korean = 'Korean_한국어';
const japanese = 'Japanese_日本語';

test('a tone applies only to its own target language, and "auto" is no tone', () => {
  assert.equal(toneLanguage(korean), 'ko');
  assert.equal(toneLanguage(japanese), 'ja');
  assert.equal(toneLanguage('English'), null);
  const tones = { ko: 'haeyo', ja: 'dearu' };
  assert.equal(translationToneFor(korean, tones), 'haeyo');
  assert.equal(translationToneFor(japanese, tones), 'dearu');
  assert.equal(translationToneFor('English', tones), undefined);
  assert.equal(translationToneFor(japanese, { ko: 'handa' }), undefined);
  assert.equal(translationToneFor(korean, {}), undefined);
  assert.equal(translationToneFor(korean, undefined), undefined);
  // A value from another language or an older build is ignored, not sent to the model.
  assert.equal(translationToneFor(korean, { ko: 'desumasu' }), undefined);
  assert.equal(translationToneFor(japanese, { ja: 'polite' }), undefined);
});

test('saved translations are kept apart by tone, and "auto" keeps the keys from before tones', () => {
  assert.equal(translationCacheLanguage(korean), korean);
  assert.equal(translationCacheLanguage(korean, undefined), korean);
  const keys = new Set([
    translationCacheLanguage(korean),
    translationCacheLanguage(korean, 'hamnida'),
    translationCacheLanguage(korean, 'haeyo'),
    translationCacheLanguage(korean, 'handa'),
  ]);
  assert.equal(keys.size, 4);
});

test('the page translation prompt asks for the tone only when one is picked', () => {
  const batch = JSON.stringify(['<p>Hello</p>']);
  const plain = getHtmlTranslationBatchPrompt(batch, korean);
  assert.ok(!plain.includes('**Tone:**'));
  assert.ok(!getHtmlTranslationBatchPrompt(batch, korean, undefined, undefined).includes('Tone:'));

  const haeyo = getHtmlTranslationBatchPrompt(batch, korean, undefined, 'haeyo');
  assert.ok(haeyo.includes(`6.  **Tone:** ${toneRule('haeyo')}`));
  assert.match(haeyo, /해요체/);
  assert.match(haeyo, /not full sentences/);
  assert.match(haeyo, /quoted speech/);
  assert.ok(haeyo.indexOf('**Tone:**') < haeyo.indexOf('===Input HTML Snippets'));

  const dearu = getHtmlTranslationBatchPrompt(batch, japanese, { title: 'T', site: 's' }, 'dearu');
  assert.match(dearu, /だ・である調/);
  assert.ok(dearu.indexOf('**Tone:**') < dearu.indexOf('===The page these snippets come from==='));
});
