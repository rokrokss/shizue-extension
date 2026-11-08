import InfoBadge from '@/components/Text/InfoBadge';
import { CUSTOM_INSTRUCTIONS_MAX_CHARS } from '@/config/constants';
import { useThemeValue } from '@/hooks/layout';
import { useUserMemory } from '@/hooks/userMemory';
import { Input } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

// The background adds these to the system message of every side panel chat request; an empty box
// turns them off. Typing saves after a 500 ms pause, and leaving the box or closing the settings
// saves at once.
export default function CustomInstructionsSettings() {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [userMemory, setUserMemory] = useUserMemory();
  const [text, setText] = useState(userMemory.text ?? '');
  const pendingText = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const save = () => {
    clearTimeout(saveTimer.current);
    if (pendingText.current === null) return;
    void setUserMemory({ text: pendingText.current });
    pendingText.current = null;
  };

  useEffect(() => save, []);

  const handleChange = (value: string) => {
    setText(value);
    pendingText.current = value;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(save, 500);
  };

  return (
    <div className="sz:flex sz:flex-col sz:items-center sz:gap-2">
      <div
        className={`sz:flex sz:items-center sz:gap-1 sz:text-base ${
          theme == 'dark' ? 'sz:text-gray-200' : 'sz:text-gray-800'
        }`}
      >
        {t('settings.customInstructions')}
        <InfoBadge text={t('settings.customInstructionsDescription')} />
      </div>
      <Input.TextArea
        value={text}
        onChange={(e) => handleChange(e.target.value)}
        onBlur={save}
        placeholder={t('settings.customInstructionsPlaceholder')}
        maxLength={CUSTOM_INSTRUCTIONS_MAX_CHARS}
        showCount
        autoSize={{ minRows: 3, maxRows: 8 }}
        className="sz:font-ycom sz:w-68"
      />
    </div>
  );
}
