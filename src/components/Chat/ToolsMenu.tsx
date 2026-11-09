import {
  attachRowClass,
  isWebTab,
  TabSummary,
  toolbarButtonStyle,
} from '@/components/Chat/AttachMenu';
import InfoBadge from '@/components/Text/InfoBadge';
import { MAX_ATTACHED_TABS } from '@/config/constants';
import { useAgentBackground } from '@/hooks/browserAgent';
import { useThemeValue } from '@/hooks/layout';
import type { ModelOption } from '@/hooks/models';
import type { ChatModel } from '@/lib/modelRegistry';
import { BASE_REASONING_EFFORTS, type ReasoningEffort } from '@/lib/reasoning';
import { isWebStorePage } from '@/lib/webStore';
import {
  ApartmentOutlined,
  BlockOutlined,
  BulbOutlined,
  ControlOutlined,
  FileSearchOutlined,
  GlobalOutlined,
  HistoryOutlined,
  RobotOutlined,
  SelectOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Button, Popover, Select, Tooltip } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

// The tools button: the open tabs to attach to the next question, and how Shizue answers the
// questions that follow, with web search, with the open tabs or past chats and history it finds
// for them, or with the browser agent (asking before it sends, deletes or pays, or not), with which
// chat model, and how hard it thinks. Files and images to send are the paperclip's (AttachMenu).
const ToolsMenu = ({
  iconColor,
  attachedTabIds,
  attachedTotal,
  onToggleTab,
  onToggleAllTabs,
  webSearch,
  webSearchSupported,
  onToggleWebSearch,
  browserAgent,
  webStorePage,
  onToggleBrowserAgent,
  findTabs,
  onToggleFindTabs,
  searchPast,
  historyAllowed,
  onToggleSearchPast,
  autoApprove,
  onToggleAutoApprove,
  chatModel,
  chatModelOptions,
  onChatModel,
  reasoningEffort,
  reasoningEfforts,
  onReasoningEffort,
}: {
  iconColor: string;
  attachedTabIds: number[];
  // The tabs and files the next message has, which share the MAX_ATTACHED_TABS limit.
  attachedTotal: number;
  onToggleTab: (tab: chrome.tabs.Tab, attach: boolean) => void;
  onToggleAllTabs: (tabs: chrome.tabs.Tab[], attach: boolean) => void;
  webSearch: boolean;
  webSearchSupported: boolean;
  onToggleWebSearch: () => void;
  browserAgent: boolean;
  // The page beside the panel is a Chrome Web Store page (lib/webStore.ts).
  webStorePage: boolean;
  onToggleBrowserAgent: () => void;
  // Find in open tabs, and Search past chats and history (services/chatLookup.ts).
  findTabs: boolean;
  onToggleFindTabs: () => void;
  searchPast: boolean;
  // Without the history permission only past chats are searched.
  historyAllowed: boolean;
  onToggleSearchPast: () => void;
  autoApprove: boolean;
  onToggleAutoApprove: () => void;
  chatModel: ChatModel;
  // The models usable now without changing the AI provider.
  chatModelOptions: ModelOption[];
  onChatModel: (model: ChatModel) => void;
  reasoningEffort: ReasoningEffort;
  // The chat model's efforts; none when it takes none, and the base ones are shown disabled.
  reasoningEfforts: ReasoningEffort[];
  onReasoningEffort: (effort: ReasoningEffort) => void;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [open, setOpen] = useState(false);
  // The hover title is off while the menu is open and stays off until the pointer comes back, so
  // closing the menu doesn't flash it.
  const [hint, setHint] = useState(false);
  const [tabs, setTabs] = useState<chrome.tabs.Tab[]>([]);
  // While the menu is open, a tab that goes to another page or changes its title shows it.
  useEffect(() => {
    if (!open) return;
    const refresh = (_tabId: number, change: chrome.tabs.TabChangeInfo) => {
      if (!change.title && !change.url && !change.favIconUrl) return;
      void chrome.tabs
        .query({ currentWindow: true })
        .then((all) => setTabs(all.filter(isWebTab)));
    };
    chrome.tabs.onUpdated.addListener(refresh);
    return () => chrome.tabs.onUpdated.removeListener(refresh);
  }, [open]);
  const [agentBackground, setAgentBackground] = useAgentBackground();
  // Its tabs go in a group of their own when the user grants tab groups, asked here inside the
  // click; without them it works all the same.
  const toggleAgentBackground = () => {
    if (!agentBackground) void chrome.permissions?.request({ permissions: ['tabGroups'] }).catch(() => false);
    void setAgentBackground(!agentBackground);
  };
  const rowClass = (disabled: boolean) => attachRowClass(disabled, theme);
  const full = attachedTotal >= MAX_ATTACHED_TABS;
  // "Select all" takes the tabs with a page to read, as many as still fit; once they are all in,
  // or no more fit, it becomes "Clear all".
  const readableTabs = tabs.filter((tab) => !tab.discarded && !isWebStorePage(tab.url));
  const attachedCount = readableTabs.filter((tab) => attachedTabIds.includes(tab.id!)).length;
  const clearsAll = attachedCount > 0 && (attachedCount === readableTabs.length || full);
  const reasoningSupported = reasoningEfforts.length > 0;
  const effortStops = reasoningSupported ? reasoningEfforts : BASE_REASONING_EFFORTS;
  const effortIndex = Math.max(0, effortStops.indexOf(reasoningEffort));
  // The stop nearest the pointer, along the track's knob-wide ends.
  const pickEffortAt = (track: HTMLElement, clientX: number) => {
    const { left, width } = track.getBoundingClientRect();
    const knob = track.firstElementChild!.getBoundingClientRect().width;
    const at = Math.round(((clientX - left - knob / 2) / Math.max(1, width - knob)) * (effortStops.length - 1));
    const effort = effortStops[Math.min(effortStops.length - 1, Math.max(0, at))];
    if (effort !== reasoningEffort) onReasoningEffort(effort);
  };

  const content = (
    // The checkboxes are drawn by Chrome after the color scheme, so it follows Shizue's theme here.
    <div
      className={`sz-tools-menu sz:font-ycom sz:w-52 sz:flex sz:flex-col ${
        theme == 'dark' ? 'sz:[color-scheme:dark]' : 'sz:[color-scheme:light]'
      }`}
    >
      <label className={rowClass(!webSearchSupported)}>
        <GlobalOutlined className="sz:shrink-0" />
        <div className="sz:min-w-0 sz:flex-1">
          {/* Web search is on by default, so the row turns it off when checked. A button inside the
              label doesn't toggle the checkbox, so the (i) only shows its text. */}
          <div className="sz:flex sz:items-center sz:gap-1 sz:text-sm">
            {t('chat.webSearchOff')}
            {webSearchSupported ? <InfoBadge text={t('chat.webSearchHint')} /> : null}
          </div>
          {webSearchSupported ? null : (
            <div className="sz:text-xs sz:text-gray-500">{t('chat.webSearchNotSupported')}</div>
          )}
        </div>
        <input
          type="checkbox"
          checked={!webSearch}
          disabled={!webSearchSupported}
          onChange={onToggleWebSearch}
          className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
        />
      </label>
      {/* The web tabs open in this window, to attach to the next question or take off. The count
          against the limit says why the other tabs are off once it is reached. */}
      <div className="sz-attach-tabs sz:flex sz:items-center sz:gap-2 sz:px-2 sz:py-1.5">
        <BlockOutlined className="sz:shrink-0" />
        <div className="sz:min-w-0 sz:flex-1 sz:text-sm">{t('chat.attachTabs')}</div>
        {attachedTotal > 0 ? (
          <span className="sz:text-sm sz:text-sz-cyan">
            {attachedTotal} / {MAX_ATTACHED_TABS}
          </span>
        ) : null}
      </div>
      <div className="sz:pl-6 sz:flex sz:flex-col">
        {readableTabs.length > 1 ? (
          <div className="sz:flex sz:justify-end sz:px-2">
            <button
              type="button"
              disabled={!clearsAll && full}
              onClick={() => onToggleAllTabs(readableTabs, !clearsAll)}
              className="sz:text-xs sz:text-sz-cyan sz:rounded-sm sz:cursor-pointer sz:hover:underline sz:underline-offset-2 sz:focus-visible:outline-2 sz:focus-visible:outline-sz-cyan sz:disabled:opacity-50 sz:disabled:cursor-not-allowed sz:disabled:no-underline"
            >
              {clearsAll ? t('chat.deselectAllTabs') : t('chat.selectAllTabs')}
            </button>
          </div>
        ) : null}
        {/* Four tabs show, each row 48px high; the rest scroll. */}
        <div className="sz-attach-tabs-list sz:max-h-48 sz:overflow-y-auto sz:flex sz:flex-col">
          {tabs.length === 0 ? (
            <div className="sz:text-xs sz:text-gray-500 sz:px-2 sz:py-2">
              {t('chat.noOpenTabs')}
            </div>
          ) : (
            tabs.map((tab) => {
              const attached = attachedTabIds.includes(tab.id!);
              // A discarded tab has no page to read until it is opened again; a Web Store tab never
              // has one.
              const disabled =
                !attached && (full || Boolean(tab.discarded) || isWebStorePage(tab.url));
              return (
                <label key={tab.id} className={rowClass(disabled)}>
                  <TabSummary tab={tab} />
                  <input
                    type="checkbox"
                    checked={attached}
                    disabled={disabled}
                    onChange={(e) => onToggleTab(tab, e.target.checked)}
                    className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
                  />
                </label>
              );
            })
          )}
        </div>
      </div>
      <label className={rowClass(false)}>
        <FileSearchOutlined className="sz:shrink-0" />
        <div className="sz:min-w-0 sz:flex-1">
          <div className="sz:text-sm">{t('chat.findInTabs')}</div>
        </div>
        <input
          type="checkbox"
          checked={findTabs}
          onChange={onToggleFindTabs}
          className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
        />
      </label>
      <label className={rowClass(false)}>
        <HistoryOutlined className="sz:shrink-0" />
        <div className="sz:min-w-0 sz:flex-1">
          <div className="sz:text-sm">{t('chat.searchPast')}</div>
          {searchPast && !historyAllowed ? (
            <div className="sz:text-xs sz:text-gray-500">{t('chat.searchPastChatsOnly')}</div>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={searchPast}
          onChange={onToggleSearchPast}
          className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
        />
      </label>
      {/* It starts on the page beside the panel, which can't be a Web Store page. Once on, it can
          still be turned off there. */}
      <label className={rowClass(webStorePage && !browserAgent)}>
        <SelectOutlined className="sz:shrink-0" />
        <div className="sz:min-w-0 sz:flex-1">
          <div className="sz:flex sz:items-center sz:gap-1 sz:text-sm">
            {t('chat.browserAgent')}
            {webStorePage ? <InfoBadge text={t('chat.webStorePage')} /> : null}
          </div>
        </div>
        <input
          type="checkbox"
          checked={browserAgent}
          disabled={webStorePage && !browserAgent}
          onChange={onToggleBrowserAgent}
          className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
        />
      </label>
      {browserAgent ? (
        <div className="sz:pl-6">
          <label className={rowClass(false)}>
            <ThunderboltOutlined className="sz:shrink-0 sz:text-amber-500" />
            <div className="sz:min-w-0 sz:flex-1">
              <div className="sz:text-sm">{t('chat.autoApprove')}</div>
            </div>
            <input
              type="checkbox"
              checked={autoApprove}
              onChange={onToggleAutoApprove}
              className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-amber-500 sz:cursor-[inherit]"
            />
          </label>
          <label className={rowClass(false)}>
            <ApartmentOutlined className="sz:shrink-0" />
            <div className="sz:min-w-0 sz:flex-1">
              <div className="sz:text-sm">{t('chat.agentBackground')}</div>
            </div>
            <input
              type="checkbox"
              checked={agentBackground}
              onChange={toggleAgentBackground}
              className="sz:w-4 sz:h-4 sz:shrink-0 sz:accent-sz-cyan sz:cursor-[inherit]"
            />
          </label>
        </div>
      ) : null}
      <div className="sz:flex sz:flex-col sz:gap-2 sz:px-2 sz:py-1.5">
        <div className="sz:flex sz:items-center sz:gap-2">
          <RobotOutlined className="sz:shrink-0" />
          <span className="sz:text-sm">{t('settings.chatModel')}</span>
        </div>
        <Select
          size="small"
          aria-label={t('settings.chatModel')}
          value={chatModelOptions.some(({ value }) => value === chatModel) ? chatModel : undefined}
          placeholder={t('settings.chatModel')}
          options={chatModelOptions.map(({ value, label }) => ({ value, label, className: 'sz:font-ycom' }))}
          onChange={onChatModel}
          className="sz:w-full sz:font-ycom"
        />
      </div>
      <div
        className={`sz:flex sz:flex-col sz:gap-2 sz:px-2 sz:py-1.5 ${
          reasoningSupported ? '' : 'sz:opacity-50'
        }`}
      >
        <div className="sz:flex sz:items-center sz:gap-2">
          <BulbOutlined className="sz:shrink-0" />
          <div className="sz:min-w-0 sz:flex-1">
            <div className="sz:flex sz:items-baseline sz:justify-between sz:gap-2">
              <span className="sz:text-sm">{t('chat.reasoningEffort')}</span>
              {reasoningSupported ? (
                <span className="sz:text-sm sz:text-sz-cyan">{t(`chat.reasoningEffort_${reasoningEffort}`)}</span>
              ) : null}
            </div>
            {reasoningSupported ? null : (
              <div className="sz:text-xs sz:text-gray-500">{t('chat.reasoningEffortNotSupported')}</div>
            )}
          </div>
        </div>
        {/* A slider: a dot for each of the model's efforts and a knob on the chosen one. */}
        <div
          role="radiogroup"
          aria-label={t('chat.reasoningEffort')}
          onKeyDown={(e) => {
            const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[e.key];
            if (!reasoningSupported || !step) return;
            e.preventDefault();
            const effort = effortStops[effortIndex + step];
            if (effort) onReasoningEffort(effort);
          }}
          className={`sz:p-0.5 sz:rounded-full ${theme == 'dark' ? 'sz:bg-white/10' : 'sz:bg-black/5'}`}
        >
          <div
            className={`sz:relative sz:flex sz:justify-between sz:touch-none ${
              reasoningSupported ? 'sz:cursor-pointer' : 'sz:cursor-not-allowed'
            }`}
            onPointerDown={(e) => reasoningSupported && pickEffortAt(e.currentTarget, e.clientX)}
            onPointerMove={(e) => reasoningSupported && e.buttons === 1 && pickEffortAt(e.currentTarget, e.clientX)}
          >
            <span
              aria-hidden
              className={`sz:absolute sz:top-0 sz:size-5 sz:rounded-full sz:shadow-sm sz:transition-[left] sz:duration-150 ${
                theme == 'dark' ? 'sz:bg-gray-100' : 'sz:bg-white sz:ring-1 sz:ring-black/10'
              }`}
              style={{ left: `calc((100% - 1.25rem) * ${effortStops.length > 1 ? effortIndex / (effortStops.length - 1) : 0})` }}
            />
            {effortStops.map((effort) => (
              <button
                key={effort}
                type="button"
                role="radio"
                aria-checked={effort === reasoningEffort}
                aria-label={t(`chat.reasoningEffort_${effort}`)}
                title={t(`chat.reasoningEffort_${effort}`)}
                disabled={!reasoningSupported}
                onClick={() => onReasoningEffort(effort)}
                className="sz:relative sz:size-5 sz:flex sz:items-center sz:justify-center sz:rounded-full sz:cursor-[inherit] sz:focus-visible:outline-2 sz:focus-visible:outline-sz-cyan"
              >
                <span className={`sz:size-1 sz:rounded-full ${theme == 'dark' ? 'sz:bg-white/30' : 'sz:bg-black/25'}`} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="topRight"
      open={open}
      onOpenChange={async (next) => {
        setHint(false);
        if (next) setTabs((await chrome.tabs.query({ currentWindow: true })).filter(isWebTab));
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
              {t('chat.tools')}
            </div>
          }
          color={theme == 'dark' ? '#505362' : 'white'}
          className="sz:font-ycom"
        >
          <Button
            type="text"
            aria-label={t('chat.tools')}
            icon={<ControlOutlined style={{ fontSize: '20px', color: iconColor }} />}
            size="middle"
            style={toolbarButtonStyle}
          ></Button>
        </Tooltip>
      </span>
    </Popover>
  );
};

export default ToolsMenu;
