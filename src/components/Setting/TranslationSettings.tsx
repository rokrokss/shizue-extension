import InfoBadge from '@/components/Text/InfoBadge';
import { useTranslateTargetLanguageValue, useTranslationTones } from '@/hooks/language';
import { useThemeValue, useTranslationMaskPrivate } from '@/hooks/layout';
import { clearCachedTranslations, countCachedTranslations } from '@/lib/indexDB';
import {
  TONE_NAMES,
  TONE_OPTIONS,
  TONE_REGISTERS,
  toneLanguage,
  type TranslationTone,
  type TranslationTones,
} from '@/lib/translationTone';
import { Button, Checkbox, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// Page translation keeps emails, phone numbers, card numbers and API keys from the AI (on by
// default), and saves its translations for 30 days so a page read again costs nothing. Into
// Korean or Japanese it can also keep one sentence style.
export default function TranslationSettings() {
  const { t, i18n } = useTranslation();
  const theme = useThemeValue();
  const [maskPrivate, setMaskPrivate] = useTranslationMaskPrivate();
  const [saved, setSaved] = useState<number | null>(null);
  const targetLanguage = useTranslateTargetLanguageValue();
  const [tones, setTones] = useTranslationTones();
  const toneCode = toneLanguage(targetLanguage);

  useEffect(() => {
    countCachedTranslations()
      .then(setSaved)
      .catch(() => setSaved(null));
  }, []);

  const clear = () => void clearCachedTranslations().then(() => setSaved(0));

  return (
    <div className="sz:flex sz:flex-col sz:items-center sz:gap-2">
      <div className={`sz:text-base ${theme == 'dark' ? 'sz:text-gray-200' : 'sz:text-gray-800'}`}>
        {t('settings.pageTranslation')}
      </div>
      {/* Beside the checkbox, not in its label, so pressing the (i) doesn't tick it. The label
          already ends in 8px of padding, taken back to the 4px gap the other (i)s have. */}
      <div className="sz:flex sz:items-center sz:gap-1">
        <Checkbox
          checked={maskPrivate}
          onChange={(e) => void setMaskPrivate(e.target.checked)}
          className="sz:font-ycom"
        >
          {t('settings.maskPrivate')}
        </Checkbox>
        <span className="sz:flex sz:-ml-2">
          <InfoBadge text={t('settings.maskPrivateDescription')} />
        </span>
      </div>
      {toneCode && (
        <div className="sz:flex sz:flex-col sz:items-center sz:gap-1">
          <div className="sz:flex sz:items-center sz:gap-1 sz:text-sm sz:text-gray-500">
            {t('settings.translationTone')}
            <InfoBadge text={t('settings.translationToneHint')} />
          </div>
          <Select<TranslationTone | 'auto'>
            value={tones[toneCode] ?? 'auto'}
            onChange={(value) =>
              void setTones({
                ...tones,
                [toneCode]: value === 'auto' ? undefined : value,
              } as TranslationTones)
            }
            className="sz:font-ycom sz:w-60"
            options={[
              { value: 'auto', label: t('settings.translationToneAuto'), className: 'sz:font-ycom' },
              ...(TONE_OPTIONS[toneCode] as TranslationTone[]).map((tone) => {
                const register = t(`settings.translationTone${TONE_REGISTERS[tone]}`);
                return {
                  value: tone,
                  label: `${TONE_NAMES[tone]} (${register})`,
                  className: 'sz:font-ycom',
                };
              }),
            ]}
          />
        </div>
      )}
      {saved !== null && saved > 0 && (
        <div className="sz:flex sz:flex-row sz:items-center sz:gap-1 sz:text-xs sz:text-gray-500">
          <span>{t('settings.savedTranslations', { number: saved.toLocaleString(i18n.language) })}</span>
          <Button type="text" size="small" className="sz:text-[12px] sz:font-ycom" onClick={clear}>
            {t('settings.savedTranslationsClear')}
          </Button>
        </div>
      )}
    </div>
  );
}
