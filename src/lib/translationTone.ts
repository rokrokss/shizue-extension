// The sentence style page translation writes Korean and Japanese in (Settings → Page translation).
// "Auto" leaves it to the model, which follows the page. Captions and image translation don't use
// it: they translate speech, where the speakers' own politeness (반말 or 존댓말 between two
// characters) carries meaning a single style would erase.

export type KoreanTone = 'hamnida' | 'haeyo' | 'handa';
export type JapaneseTone = 'desumasu' | 'dearu';
export type TranslationTone = KoreanTone | JapaneseTone;

// The tone picked for each language that has one; a missing language is "auto".
export type TranslationTones = { ko?: KoreanTone; ja?: JapaneseTone };

export type ToneLanguage = keyof TranslationTones;

export const TONE_OPTIONS: { ko: KoreanTone[]; ja: JapaneseTone[] } = {
  ko: ['hamnida', 'haeyo', 'handa'],
  ja: ['desumasu', 'dearu'],
};

// What each style is called in its own language, shown as is in every UI language.
export const TONE_NAMES: Record<TranslationTone, string> = {
  hamnida: '합니다체',
  haeyo: '해요체',
  handa: '한다체',
  desumasu: 'です・ます調',
  dearu: 'だ・である調',
};

// How formal each style is, for the label next to its name (settings.translationTone<Register>).
export const TONE_REGISTERS: Record<TranslationTone, 'Formal' | 'Polite' | 'Plain'> = {
  hamnida: 'Formal',
  haeyo: 'Polite',
  handa: 'Plain',
  desumasu: 'Polite',
  dearu: 'Plain',
};

// Target languages are stored as names (hooks/language.ts).
export const toneLanguage = (language: string): ToneLanguage | null =>
  language === 'Korean_한국어' ? 'ko' : language === 'Japanese_日本語' ? 'ja' : null;

export const translationToneFor = (
  language: string,
  tones: TranslationTones | undefined
): TranslationTone | undefined => {
  const code = toneLanguage(language);
  const tone = code ? tones?.[code] : undefined;
  return code && tone && (TONE_OPTIONS[code] as string[]).includes(tone) ? tone : undefined;
};

const TONE_INSTRUCTIONS: Record<TranslationTone, string> = {
  hamnida: 'End Korean sentences in the formal polite style, 합니다체 (~합니다, ~습니까, ~하십시오)',
  haeyo: 'End Korean sentences in the polite everyday style, 해요체 (~해요, ~인가요, ~하세요)',
  handa: 'End Korean sentences in the plain written style of articles and books, 한다체 (~한다, ~이다, ~인가)',
  desumasu: 'End Japanese sentences in the polite style, です・ます調 (~です, ~ます, ~でしょうか)',
  dearu: 'End Japanese sentences in the plain written style, だ・である調 (~だ, ~である, ~か)',
};

// The prompt rule for a tone. Labels, headings and quoted speech are left alone, so a "Sign in"
// button doesn't become a sentence and a quote keeps how its speaker talks.
export const toneRule = (tone: TranslationTone) =>
  `${TONE_INSTRUCTIONS[tone]}, in every snippet, so the page reads in one voice. Leave buttons, menu items, headings and other fragments that are not full sentences as short as they are, and keep quoted speech in its speaker's own register.`;

// Translations saved in one tone aren't reused for another. Without a tone the key is the language
// alone, so translations saved before tones existed still count as "auto".
export const translationCacheLanguage = (language: string, tone?: TranslationTone) =>
  tone ? `${language}#${tone}` : language;
