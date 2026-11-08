import { attachRowClass, toolbarButtonStyle } from '@/components/Chat/AttachMenu';
import { useThemeValue } from '@/hooks/layout';
import { BookOutlined, EditOutlined, ReadOutlined, TranslationOutlined } from '@ant-design/icons';
import { Button, Popover, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

// The study button: translate mode in this chat, the memo, and the word list, each acting at once.
const StudyMenu = ({
  iconColor,
  onTranslateMode,
  onMemo,
  onWordList,
}: {
  iconColor: string;
  onTranslateMode: () => void;
  onMemo: () => void;
  onWordList: () => void;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [open, setOpen] = useState(false);
  // The hover title is off while the menu is open and stays off until the pointer comes back, so
  // closing the menu doesn't flash it.
  const [hint, setHint] = useState(false);
  const rowClass = attachRowClass(false, theme);
  const pick = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const content = (
    <div className="sz-study-menu sz:font-ycom sz:w-40 sz:flex sz:flex-col">
      <button type="button" onClick={pick(onTranslateMode)} className={rowClass}>
        <TranslationOutlined className="sz:shrink-0" />
        <div className="sz:text-sm">{t('chat.translateMode')}</div>
      </button>
      <button type="button" onClick={pick(onMemo)} className={rowClass}>
        <EditOutlined className="sz:shrink-0" />
        <div className="sz:text-sm">{t('memo.memo')}</div>
      </button>
      <button type="button" onClick={pick(onWordList)} className={rowClass}>
        <ReadOutlined className="sz:shrink-0" />
        <div className="sz:text-sm">{t('words.title')}</div>
      </button>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="topLeft"
      open={open}
      onOpenChange={(next) => {
        setHint(false);
        setOpen(next);
      }}
    >
      <span className="sz:inline-flex">
        <Tooltip
          placement="top"
          open={hint}
          onOpenChange={(next) => setHint(next && !open)}
          title={
            <div
              className={`sz:font-ycom sz:z-2147483647 ${
                theme == 'dark' ? 'sz:text-white' : 'sz:text-black'
              }`}
            >
              {t('chat.study')}
            </div>
          }
          color={theme == 'dark' ? '#505362' : 'white'}
          className="sz:font-ycom"
        >
          <Button
            type="text"
            aria-label={t('chat.study')}
            icon={<BookOutlined style={{ fontSize: '20px', color: iconColor }} />}
            size="middle"
            style={toolbarButtonStyle}
          ></Button>
        </Tooltip>
      </span>
    </Popover>
  );
};

export default StudyMenu;
