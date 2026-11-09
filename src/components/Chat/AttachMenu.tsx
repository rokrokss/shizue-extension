import InfoBadge from '@/components/Text/InfoBadge';
import { MAX_ATTACHED_TABS } from '@/config/constants';
import { useThemeValue } from '@/hooks/layout';
import { OFFICE_FILE_ACCEPT, TEXT_FILE_ACCEPT } from '@/lib/tabText';
import { isWebStorePage } from '@/lib/webStore';
import {
  CameraOutlined,
  FileAddOutlined,
  FileTextOutlined,
  PaperClipOutlined,
  PictureOutlined,
} from '@ant-design/icons';
import { Button, Popover, Tooltip } from 'antd';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export const isWebTab = (tab: chrome.tabs.Tab) =>
  tab.id !== undefined && /^https?:/.test(tab.url ?? '');

// A tab's icon, title and site, as the tools menu and the @ list show it.
export const TabSummary = ({ tab }: { tab: chrome.tabs.Tab }) => {
  const { t } = useTranslation();
  return (
    <>
      {tab.favIconUrl ? (
        <img src={tab.favIconUrl} alt="" className="sz:w-4 sz:h-4 sz:shrink-0" />
      ) : (
        <FileTextOutlined className="sz:shrink-0" />
      )}
      <div className="sz:min-w-0 sz:flex-1">
        <div className="sz:truncate sz:text-sm">{tab.title || tab.url}</div>
        {/* A Web Store tab can't be attached; its (i) says why. The @ list leaves those tabs out,
            so the (i) never lands inside its row buttons. */}
        <div className="sz:flex sz:items-center sz:gap-1">
          <div className="sz:min-w-0 sz:truncate sz:text-xs sz:text-gray-500">
            {tab.discarded ? t('chat.tabAsleep') : new URL(tab.url!).host}
          </div>
          {isWebStorePage(tab.url) ? <InfoBadge text={t('chat.webStorePage')} /> : null}
        </div>
      </div>
    </>
  );
};

// The chat box's toolbar buttons, a little narrower than antd's 32px so all ten fit a side panel
// at its 320px minimum.
export const toolbarButtonStyle = { width: 28 };

// Tabs, files and the capture share one row style, like items of one list.
export const attachRowClass = (disabled: boolean, theme: string, active = false) =>
  `sz:flex sz:items-center sz:gap-2 sz:w-full sz:px-2 sz:py-1.5 sz:rounded-md sz:text-left ${
    disabled
      ? 'sz:opacity-50 sz:cursor-not-allowed'
      : `sz:cursor-pointer ${theme == 'dark' ? 'sz:hover:bg-white/10' : 'sz:hover:bg-black/5'}`
  } ${active ? (theme == 'dark' ? 'sz:bg-white/10' : 'sz:bg-black/5') : ''}`;

// The paperclip button: what goes with the next question from the computer. PDF and text files,
// images, and, for models that read images, a capture of what the current tab shows (a dragged part
// has its own button). The open tabs to attach are in the tools menu.
const AttachMenu = ({
  full,
  imagesSupported,
  iconColor,
  onPickFiles,
  onPickImages,
  onCapture,
}: {
  // The next message already has MAX_ATTACHED_TABS tabs and files.
  full: boolean;
  imagesSupported: boolean;
  iconColor: string;
  onPickFiles: (files: File[]) => void;
  onPickImages: (files: File[]) => void;
  onCapture: () => void;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [open, setOpen] = useState(false);
  // The hover title is off while the menu is open and stays off until the pointer comes back, so
  // closing the menu doesn't flash it.
  const [hint, setHint] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const handleOpenChange = (next: boolean) => {
    setHint(false);
    setOpen(next);
  };

  const rowClass = (disabled: boolean) => attachRowClass(disabled, theme);

  const content = (
    // Narrow enough to stay centered over the paperclip, inside a side panel at its 320px minimum.
    <div className="sz-attach-menu sz:font-ycom sz:w-52 sz:flex sz:flex-col sz:gap-1">
      {full ? (
        <div className="sz:text-xs sz:text-gray-500 sz:px-2">
          {t('chat.attachLimit', { max: MAX_ATTACHED_TABS })}
        </div>
      ) : null}
      <div className="sz:flex sz:flex-col">
        <input
          ref={fileInput}
          type="file"
          accept={`application/pdf,.pdf,${OFFICE_FILE_ACCEPT},text/*,${TEXT_FILE_ACCEPT}`}
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length === 0) return;
            setOpen(false);
            onPickFiles(files);
          }}
        />
        {/* The (i) lies over the row beside its button, not inside it, so pressing it doesn't open
            the file picker. */}
        <div className="sz:relative">
          <button
            type="button"
            disabled={full}
            onClick={() => fileInput.current?.click()}
            className={rowClass(full)}
          >
            <FileAddOutlined className="sz:shrink-0" />
            <div className="sz:min-w-0 sz:flex-1 sz:pr-5">
              <div className="sz:text-sm">{t('chat.attachFile')}</div>
            </div>
          </button>
          <span
            className={`sz:absolute sz:right-2 sz:top-1/2 sz:-translate-y-1/2 sz:flex ${
              full ? 'sz:opacity-50' : ''
            }`}
          >
            <InfoBadge text={t('chat.attachFileTypes')} />
          </span>
        </div>
        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length === 0) return;
            setOpen(false);
            onPickImages(files);
          }}
        />
        <button
          type="button"
          disabled={!imagesSupported}
          onClick={() => imageInput.current?.click()}
          className={rowClass(!imagesSupported)}
        >
          <PictureOutlined className="sz:shrink-0" />
          <div className="sz:min-w-0 sz:flex-1">
            <div className="sz:text-sm">{t('chat.imageUpload')}</div>
            {imagesSupported ? null : (
              <div className="sz:text-xs sz:text-gray-500">{t('chat.imageUploadNotSupported')}</div>
            )}
          </div>
        </button>
        <button
          type="button"
          disabled={!imagesSupported}
          onClick={() => {
            setOpen(false);
            onCapture();
          }}
          className={rowClass(!imagesSupported)}
        >
          <CameraOutlined className="sz:shrink-0" />
          <div className="sz:min-w-0 sz:flex-1">
            <div className="sz:text-sm">{t('chat.captureScreen')}</div>
            {imagesSupported ? null : (
              <div className="sz:text-xs sz:text-gray-500">{t('chat.imageUploadNotSupported')}</div>
            )}
          </div>
        </button>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="top"
      open={open}
      onOpenChange={handleOpenChange}
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
              {t('chat.attach')}
            </div>
          }
          color={theme == 'dark' ? '#505362' : 'white'}
          className="sz:font-ycom"
        >
          <Button
            type="text"
            aria-label={t('chat.attach')}
            icon={<PaperClipOutlined style={{ fontSize: '20px', color: iconColor }} />}
            size="middle"
            style={toolbarButtonStyle}
          ></Button>
        </Tooltip>
      </span>
    </Popover>
  );
};

export default AttachMenu;
