import { STORAGE_BRIDGE_LOG, STORAGE_BRIDGE_PAUSED_TABS } from '@/config/constants';
import { useThemeValue } from '@/hooks/layout';
import type { BridgeLogEntry } from '@/services/background/nativeBridge';
import { Button, List } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type StoppedTab = { id: number; title: string };

const isBridgeBuild = () =>
  chrome.runtime.getManifest().permissions?.includes('nativeMessaging') ?? false;

// Only in the bridge build (`pnpm build:bridge`): which tabs an agent such as Claude Code or Codex
// reaches, the tabs whose pill the user stopped it in, with a way to let it back in, and what it
// did lately. The background keeps both in session storage (services/background/nativeBridge.ts),
// so they last until the browser closes.
export default function BridgeSettings() {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [log, setLog] = useState<BridgeLogEntry[]>([]);
  const [stopped, setStopped] = useState<StoppedTab[]>([]);

  useEffect(() => {
    if (!isBridgeBuild()) return;
    const load = async () => {
      const stored = await chrome.storage.session.get([
        STORAGE_BRIDGE_LOG,
        STORAGE_BRIDGE_PAUSED_TABS,
      ]);
      setLog(
        ((stored[STORAGE_BRIDGE_LOG] as BridgeLogEntry[] | undefined) ?? []).slice().reverse()
      );
      const ids = (stored[STORAGE_BRIDGE_PAUSED_TABS] as number[] | undefined) ?? [];
      const tabs = await Promise.all(ids.map((id) => chrome.tabs.get(id).catch(() => null)));
      setStopped(
        tabs.flatMap((tab) =>
          tab?.id !== undefined ? [{ id: tab.id, title: tab.title ?? tab.url ?? '' }] : []
        )
      );
    };
    void load();
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (STORAGE_BRIDGE_LOG in changes || STORAGE_BRIDGE_PAUSED_TABS in changes) void load();
    };
    chrome.storage.session.onChanged.addListener(onChanged);
    return () => chrome.storage.session.onChanged.removeListener(onChanged);
  }, []);

  if (!isBridgeBuild()) return null;

  const letBackIn = async (tabId: number) => {
    const stored = await chrome.storage.session.get(STORAGE_BRIDGE_PAUSED_TABS);
    const ids = (stored[STORAGE_BRIDGE_PAUSED_TABS] as number[] | undefined) ?? [];
    await chrome.storage.session.set({
      [STORAGE_BRIDGE_PAUSED_TABS]: ids.filter((id) => id !== tabId),
    });
  };

  const textColor = theme == 'dark' ? 'sz:text-gray-200' : 'sz:text-gray-800';
  const listStyle = {
    scrollbarWidth: 'thin' as const,
    scrollbarColor: `${theme == 'dark' ? '#111' : '#ddd'} transparent`,
  };

  const noteOf = (entry: BridgeLogEntry) =>
    entry.note === 'declined'
      ? t('agent.denied')
      : entry.note === 'paused'
        ? t('bridge.refusedStopped')
        : entry.note;

  return (
    <div className="sz:flex sz:flex-col sz:items-center sz:gap-2">
      <div className={`sz:text-base ${textColor}`}>{t('bridge.title')}</div>
      <div className="sz:w-68 sz:text-xs sz:text-center sz:text-gray-500 sz:break-keep sz:wrap-anywhere">
        {t('bridge.description')}
      </div>
      {stopped.length > 0 && (
        <>
          <div className={`sz:text-sm ${textColor}`}>{t('bridge.stopped')}</div>
          <List
            dataSource={stopped}
            bordered
            size="small"
            className="sz:w-68"
            renderItem={(tab) => (
              <List.Item className={`sz:font-ycom ${textColor}`}>
                <div className="sz:w-full sz:flex sz:flex-row sz:items-center sz:justify-between sz:gap-2">
                  <div className="sz:text-xs sz:truncate">{tab.title}</div>
                  <Button
                    type="dashed"
                    size="small"
                    className="sz:text-[12px] sz:font-ycom sz:shrink-0"
                    onClick={() => void letBackIn(tab.id)}
                  >
                    {t('bridge.resume')}
                  </Button>
                </div>
              </List.Item>
            )}
          />
        </>
      )}
      <div className={`sz:text-sm ${textColor}`}>{t('bridge.log')}</div>
      {log.length > 0 ? (
        <>
          <List
            dataSource={log}
            bordered
            size="small"
            className="sz:w-68 sz:max-h-[200px] sz:overflow-auto"
            style={listStyle}
            renderItem={(entry) => (
              <List.Item className={`sz:font-ycom ${textColor}`}>
                <div className="sz:w-full sz:flex sz:flex-col sz:gap-0.5 sz:text-xs sz:break-keep sz:wrap-anywhere">
                  <div className="sz:flex sz:flex-row sz:gap-2">
                    <span className={entry.ok ? 'sz:text-green-600' : 'sz:text-red-500'}>
                      {entry.ok ? '✓' : '✗'}
                    </span>
                    <span className="sz:text-gray-500">
                      {new Date(entry.at).toLocaleTimeString()}
                    </span>
                    {entry.agent && <span className="sz:shrink-0">{entry.agent}</span>}
                    {entry.host && <span className="sz:truncate">{entry.host}</span>}
                  </div>
                  <div>
                    {entry.tool}
                    {entry.target ? ` · ${entry.target}` : ''}
                  </div>
                  {noteOf(entry) && (
                    <div className="sz:text-gray-500 sz:line-clamp-2">{noteOf(entry)}</div>
                  )}
                </div>
              </List.Item>
            )}
          />
          <Button
            type="text"
            size="small"
            className="sz:text-[12px] sz:font-ycom"
            onClick={() => void chrome.storage.session.set({ [STORAGE_BRIDGE_LOG]: [] })}
          >
            {t('bridge.clearLog')}
          </Button>
        </>
      ) : (
        <div className="sz:text-xs sz:text-gray-500">{t('bridge.logEmpty')}</div>
      )}
    </div>
  );
}
