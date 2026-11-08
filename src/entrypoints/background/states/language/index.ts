import {
  STORAGE_LANGUAGE,
  STORAGE_TRANSLATE_TARGET_LANGUAGE,
  STORAGE_TRANSLATION_TONE,
} from '@/config/constants';
import { Language } from '@/hooks/language';
import { determineAppLanguage } from '@/lib/language';
import type { TranslationTones } from '@/lib/translationTone';

let currentLang: Language = determineAppLanguage(chrome.i18n.getUILanguage());
let currentTranslationTargetLang: Language = determineAppLanguage(chrome.i18n.getUILanguage());
let currentTranslationTones: TranslationTones = {};

const changeLanguage = (lang: Language) => {
  currentLang = lang;
};

const changeTranslationTargetLanguage = (lang: Language) => {
  currentTranslationTargetLang = lang;
};

export const getCurrentLanguage = () => currentLang;

export const getTranslationTargetLanguage = () => currentTranslationTargetLang;

export const getTranslationTones = () => currentTranslationTones;

let languageStateReady: Promise<void> = Promise.resolve();

export const whenLanguageStateReady = () => languageStateReady;

export const languageListeners = () => {
  languageStateReady = chrome.storage.local
    .get([STORAGE_LANGUAGE, STORAGE_TRANSLATE_TARGET_LANGUAGE, STORAGE_TRANSLATION_TONE])
    .then((res) => {
      if (res.LANGUAGE) changeLanguage(res.LANGUAGE as Language);
      if (res.TRANSLATE_TARGET_LANGUAGE)
        changeTranslationTargetLanguage(res.TRANSLATE_TARGET_LANGUAGE as Language);
      currentTranslationTones = (res[STORAGE_TRANSLATION_TONE] as TranslationTones) ?? {};
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local') {
      if (changes.LANGUAGE) {
        changeLanguage(changes.LANGUAGE.newValue as Language);
      }
      if (changes.TRANSLATE_TARGET_LANGUAGE) {
        changeTranslationTargetLanguage(changes.TRANSLATE_TARGET_LANGUAGE.newValue as Language);
      }
      // A removed key is "auto" again.
      if (changes[STORAGE_TRANSLATION_TONE]) {
        currentTranslationTones =
          (changes[STORAGE_TRANSLATION_TONE].newValue as TranslationTones | undefined) ?? {};
      }
    }
  });
};
