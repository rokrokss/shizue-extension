import InfoBadge from '@/components/Text/InfoBadge';
import { useAgentAllowedSites, useAgentSiteTips } from '@/hooks/browserAgent';
import { useThemeValue } from '@/hooks/layout';
import { Button, List } from 'antd';
import { useTranslation } from 'react-i18next';

// What the browser agent keeps between runs: the sites the user allowed for good on its cards, and
// the tips the user kept for a site after a run. Each can be removed here, or all at once. Only
// lists with something in them show, and the section hides while both are empty, since they fill
// from the run's cards and not from here.
export default function BrowserAgentSettings() {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [sites, setSites] = useAgentAllowedSites();
  const [tips, setTips] = useAgentSiteTips();
  const tipRows = Object.entries(tips).flatMap(([site, texts]) => texts.map((text) => ({ site, text })));
  const listStyle = {
    scrollbarWidth: 'thin' as const,
    scrollbarColor: `${theme == 'dark' ? '#111' : '#ddd'} transparent`,
  };
  const itemClass = `sz:font-ycom ${theme == 'dark' ? 'sz:text-gray-200' : 'sz:text-gray-800'}`;

  const removeTip = (site: string, text: string) => {
    const left = (tips[site] ?? []).filter((tip) => tip !== text);
    const next = { ...tips };
    if (left.length) next[site] = left;
    else delete next[site];
    void setTips(next);
  };

  if (!sites.length && !tipRows.length) return null;

  return (
    <div className="sz:flex sz:flex-col sz:items-center sz:gap-2">
      <div
        className={`sz:flex sz:items-center sz:gap-1 sz:text-base ${
          theme == 'dark' ? 'sz:text-gray-200' : 'sz:text-gray-800'
        }`}
      >
        {t('settings.browserAgent')}
        <InfoBadge text={t('settings.browserAgentDescription')} />
      </div>
      {sites.length ? (
        <>
          <div className="sz:w-68 sz:text-xs sz:font-semibold sz:text-gray-500">{t('settings.agentAllowedSites')}</div>
          <List
            dataSource={sites}
            bordered
            size="small"
            className="sz:w-68 sz:max-h-[160px] sz:overflow-auto"
            style={listStyle}
            renderItem={(site) => (
              <List.Item className={itemClass}>
                <div className="sz:w-full sz:flex sz:flex-row sz:items-center sz:justify-between sz:gap-2">
                  <div className="sz:text-xs sz:break-all">{site}</div>
                  <Button
                    type="dashed"
                    size="small"
                    className="sz:text-[12px] sz:font-ycom sz:shrink-0"
                    onClick={() => void setSites(sites.filter((kept) => kept !== site))}
                  >
                    {t('settings.autoMemoryDelete')}
                  </Button>
                </div>
              </List.Item>
            )}
          />
          <Button type="text" size="small" className="sz:text-[12px] sz:font-ycom" onClick={() => void setSites([])}>
            {t('settings.agentClearSites')}
          </Button>
        </>
      ) : null}
      {tipRows.length ? (
        <>
          <div className="sz:w-68 sz:text-xs sz:font-semibold sz:text-gray-500">{t('settings.agentSiteTips')}</div>
          <List
            dataSource={tipRows}
            bordered
            size="small"
            className="sz:w-68 sz:max-h-[200px] sz:overflow-auto"
            style={listStyle}
            renderItem={({ site, text }) => (
              <List.Item className={itemClass}>
                <div className="sz:w-full sz:flex sz:flex-row sz:items-start sz:justify-between sz:gap-2">
                  <div className="sz:min-w-0">
                    <div className="sz:text-[11px] sz:text-gray-500 sz:break-all">{site}</div>
                    <div className="sz:text-xs sz:break-keep sz:wrap-anywhere">{text}</div>
                  </div>
                  <Button
                    type="dashed"
                    size="small"
                    className="sz:text-[12px] sz:font-ycom sz:shrink-0"
                    onClick={() => removeTip(site, text)}
                  >
                    {t('settings.autoMemoryDelete')}
                  </Button>
                </div>
              </List.Item>
            )}
          />
          <Button type="text" size="small" className="sz:text-[12px] sz:font-ycom" onClick={() => void setTips({})}>
            {t('settings.agentClearTips')}
          </Button>
        </>
      ) : null}
    </div>
  );
}
