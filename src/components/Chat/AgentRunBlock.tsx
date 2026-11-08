import { MESSAGE_AGENT_STOP, STORAGE_AGENT_SITE_TIPS } from '@/config/constants';
import { useThemeValue } from '@/hooks/layout';
import { type AgentRun, type AgentSiteTips, type AgentStep, withSiteTip } from '@/lib/browserAgent';
import { db } from '@/lib/indexDB';
import {
  AimOutlined,
  BulbOutlined,
  CheckOutlined,
  CloseOutlined,
  ExportOutlined,
  MessageOutlined,
  OrderedListOutlined,
  QuestionCircleOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SelectOutlined,
  StopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Button } from 'antd';
import type { TFunction } from 'i18next';
import { type CSSProperties, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const clip = (text: string | undefined, max: number) => {
  const value = (text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

const hostOf = (url: string | undefined) => {
  try {
    return new URL(url ?? '').host;
  } catch {
    return url ?? '';
  }
};

// A step as a short sentence: "Clicked ‘Search’", "Typed “shoes” in ‘Search’".
export const agentStepLabel = (step: AgentStep, t: TFunction) => {
  const { action } = step;
  const target = clip(step.target, 40) || '…';
  const text = clip(action.text, 40);
  switch (action.kind) {
    case 'click':
      return t('agent.step.click', { target });
    case 'type':
      return t(action.submit ? 'agent.step.typeSubmit' : 'agent.step.type', { target, text });
    case 'select':
      return t('agent.step.select', { target, text });
    case 'scroll':
      return t(action.direction === 'up' ? 'agent.step.scrollUp' : 'agent.step.scrollDown');
    case 'navigate':
      return t('agent.step.navigate', { host: hostOf(action.url) });
    case 'back':
      return t('agent.step.back');
    case 'ask':
      return t('agent.step.ask', { text: clip(action.text, 80) });
    case 'steer':
      return t('agent.step.steer', { text: clip(action.text, 80) });
    case 'look':
      return t('agent.step.look');
    case 'click_at':
      return t('agent.step.clickAt');
    case 'open_tab':
      return t('agent.step.openTab', { host: hostOf(action.url) });
    case 'switch_tab':
      return t('agent.step.switchTab', { tab: action.tab });
    case 'tool':
      return t('agent.step.tool', { target });
    case 'press':
      return step.target
        ? t('agent.step.pressOn', { key: action.key === ' ' ? 'Space' : action.key, target })
        : t('agent.step.press', { key: action.key === ' ' ? 'Space' : action.key });
    case 'hover':
      return t('agent.step.hover', { target });
    case 'upload':
      return t('agent.step.upload', { target, file: action.file });
    case 'handoff':
      return t('agent.step.handoff', { text: clip(action.text, 80) });
    case 'point':
      return t('agent.step.point', { text: clip(action.text, 80) });
    case 'plan':
      return t('agent.step.plan');
    default:
      return action.text ? t('agent.step.waitFor', { text }) : t('agent.step.wait');
  }
};

// Shows the tab a run behind the user's works in; while it works, stops it first.
const showRunTab = async (tabId: number, live: boolean) => {
  if (live) await chrome.runtime.sendMessage({ action: MESSAGE_AGENT_STOP, tabId }).catch(() => {});
  const tab = await chrome.tabs.update(tabId, { active: true }).catch(() => null);
  if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
};

const StepIcon = ({ step }: { step: AgentStep }) => {
  const className = 'sz:text-[11px] sz:shrink-0 sz:mt-[3px]';
  if (step.action.kind === 'steer') return <MessageOutlined className={`${className} sz:text-gray-400`} />;
  if (step.action.kind === 'ask' && step.status === 'awaiting') {
    return <QuestionCircleOutlined className={`${className} sz:text-sz-cyan`} />;
  }
  if ((step.action.kind === 'handoff' || step.action.kind === 'point') && step.status === 'awaiting') {
    return <UserOutlined className={`${className} sz:text-sz-cyan`} />;
  }
  switch (step.status) {
    case 'running':
      return <LoadingOutlined className={`${className} sz:text-sz-cyan`} />;
    case 'done':
      return <CheckOutlined className={`${className} sz:text-sz-cyan`} />;
    case 'failed':
      return <CloseOutlined className={`${className} sz:text-red-400`} />;
    case 'denied':
      return <StopOutlined className={`${className} sz:text-gray-400`} />;
    default:
      return <SafetyCertificateOutlined className={`${className} sz:text-amber-500`} />;
  }
};

// The browser agent's actions above its answer (lib/browserAgent.ts), like the model's thinking:
// open while it works, folded into "5 steps on example.com" once it is done. An action that sends,
// deletes or pays waits on a card here until the user allows or declines it, as do its plan and a
// site new to the run; on the user's turn a card says what to do. A tip it offers for the site
// waits under it to be kept or not.
const AgentRunBlock = ({
  run,
  messageId,
  live,
  onApproval,
}: {
  run: AgentRun;
  // Where the run is kept, to note the tip's answer.
  messageId?: string;
  // The agent is still working on this answer.
  live: boolean;
  onApproval: (stepId: string, approved: boolean | 'always') => void;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const dark = theme == 'dark';
  const [open, setOpen] = useState(false);
  // The card answered, until the agent moves on.
  const [answered, setAnswered] = useState<string | null>(null);
  const waiting = live ? run.steps.find((step) => step.status === 'awaiting') : undefined;
  // A question is answered from the chat box; the user's turn ends with its card's button or on the
  // page; an approval gets the card's buttons.
  const question = waiting?.action.kind === 'ask' ? waiting : undefined;
  const turn = waiting?.action.kind === 'handoff' || waiting?.action.kind === 'point' ? waiting : undefined;
  const awaiting = question || turn ? undefined : waiting;
  // The tip as the user answered it here, before the message is read again.
  const [tipState, setTipState] = useState(run.tip?.state);
  useEffect(() => {
    if (!awaiting) setAnswered(null);
  }, [awaiting]);

  const host = run.host ?? '';
  const count = run.steps.length;
  const expanded = live || open;
  const label = live
    ? t('agent.working', { host })
    : count
    ? t('agent.stepsDone', { count, host })
    : t('agent.readPage', { host });
  const outcome = !live && run.outcome && run.outcome !== 'finished' ? run.outcome : null;

  // A step may ask twice: whether to act on a site new to the run, then whether to take the action.
  const cardOf = (step: AgentStep) => `${step.id}:${step.site ?? ''}`;
  const answer = (approved: boolean | 'always', step = awaiting ?? turn) => {
    if (!step) return;
    setAnswered(cardOf(step));
    onApproval(step.id, approved);
  };

  const answerTip = async (keep: boolean) => {
    const tip = run.tip;
    if (!tip) return;
    const state = keep ? 'saved' : 'dismissed';
    setTipState(state);
    if (keep) {
      const stored = await chrome.storage.local.get(STORAGE_AGENT_SITE_TIPS);
      const tips = (stored[STORAGE_AGENT_SITE_TIPS] ?? {}) as AgentSiteTips;
      await chrome.storage.local.set({ [STORAGE_AGENT_SITE_TIPS]: withSiteTip(tips, tip.host, tip.text) });
    }
    if (messageId) await db.messages.update(messageId, { agentRun: { ...run, tip: { ...tip, state } } }).catch(() => {});
  };
  const cardClass = (tone: 'amber' | 'cyan') =>
    `sz:mt-2 sz:w-full sz:rounded-xl sz:border sz:p-3 sz:animate-[sz-fade-in_0.25s_ease-out] sz:motion-reduce:animate-none ${
      tone === 'amber'
        ? dark
          ? 'sz:border-amber-400/40 sz:bg-amber-400/10'
          : 'sz:border-amber-500/40 sz:bg-amber-50'
        : dark
          ? 'sz:border-sz-cyan/40 sz:bg-sz-cyan/10'
          : 'sz:border-sz-cyan/40 sz:bg-cyan-50'
    }`;
  const bodyClass = `sz:mt-1.5 sz:text-[13px] sz:break-words ${dark ? 'sz:text-gray-100' : 'sz:text-gray-800'}`;

  return (
    <div
      className="sz-agent-run sz:flex sz:flex-col sz:items-start sz:pb-2 sz:font-ycom"
      style={
        {
          '--sz-thinking-dim': dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.4)',
          '--sz-thinking-bright': dark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.85)',
        } as CSSProperties
      }
    >
      <button
        type="button"
        aria-expanded={expanded}
        disabled={live || count === 0}
        onClick={() => setOpen((value) => !value)}
        className={`sz:flex sz:items-center sz:gap-1.5 sz:text-xs sz:rounded-md sz:py-0.5 sz:pr-1.5 sz:-ml-0.5 sz:pl-0.5 sz:max-w-full ${
          live
            ? 'sz-thinking-live sz:cursor-default'
            : `sz:text-gray-500 ${count ? `sz:cursor-pointer ${dark ? 'sz:hover:text-gray-300' : 'sz:hover:text-gray-700'}` : 'sz:cursor-default'}`
        }`}
      >
        {count ? (
          <RightOutlined
            className={`sz:text-[9px] sz:transition-transform sz:duration-200 sz:motion-reduce:transition-none ${
              expanded ? 'sz:rotate-90' : ''
            }`}
          />
        ) : null}
        <SelectOutlined className={`sz:text-[11px] ${live ? 'sz:text-sz-cyan' : ''}`} />
        <span className="sz-thinking-label sz:truncate">{label}</span>
      </button>
      {run.tabId !== undefined ? (
        <button
          type="button"
          onClick={() => void showRunTab(run.tabId!, live)}
          className={`sz:flex sz:items-center sz:gap-1 sz:text-[11px] sz:text-gray-500 sz:rounded-md sz:py-0.5 sz:cursor-pointer ${
            dark ? 'sz:hover:text-gray-300' : 'sz:hover:text-gray-700'
          }`}
        >
          <ExportOutlined className="sz:text-[10px]" />
          {live ? t('agent.takeOver') : t('agent.showTab')}
        </button>
      ) : null}
      {count ? (
        <div
          className={`sz:grid sz:w-full sz:transition-[grid-template-rows,opacity] sz:duration-300 sz:ease-out sz:motion-reduce:transition-none ${
            expanded ? 'sz:grid-rows-[1fr] sz:opacity-100' : 'sz:grid-rows-[0fr] sz:opacity-0'
          }`}
        >
          <div className="sz:overflow-hidden">
            <ol
              className={`sz:mt-1 sz:ml-1 sz:pl-3 sz:border-l-2 sz:flex sz:flex-col sz:gap-1.5 sz:text-xs sz:leading-5 ${
                dark ? 'sz:border-white/15' : 'sz:border-black/10'
              }`}
            >
              {run.steps.map((step) => (
                <li key={step.id} className="sz:flex sz:items-start sz:gap-2 sz:animate-[sz-fade-in_0.25s_ease-out] sz:motion-reduce:animate-none">
                  <StepIcon step={step} />
                  <div className="sz:min-w-0 sz:flex-1">
                    <div
                      className={`sz:break-words ${
                        step.status === 'denied' ? 'sz:text-gray-500 sz:line-through' : dark ? 'sz:text-gray-200' : 'sz:text-gray-700'
                      }`}
                    >
                      {agentStepLabel(step, t)}
                    </div>
                    {step.autoApproved ? (
                      <div className="sz:text-[11px] sz:text-amber-500">{t('agent.autoApproved')}</div>
                    ) : null}
                    {step.alwaysAllowed ? (
                      <div className="sz:text-[11px] sz:text-gray-500">{t('agent.alwaysAllowedNote', { site: step.alwaysAllowed })}</div>
                    ) : null}
                    {step.reply ? (
                      <div className="sz:text-[11px] sz:text-gray-500 sz:break-words">
                        {t('agent.replied', { text: clip(step.reply, 120) })}
                      </div>
                    ) : null}
                    {step.status === 'failed' ? (
                      <div className="sz:text-[11px] sz:text-red-400">{t(`agent.error.${step.error ?? 'failed'}`)}</div>
                    ) : step.status === 'denied' ? (
                      <div className="sz:text-[11px] sz:text-gray-500">
                        {step.site ? t('agent.siteDenied', { site: step.site }) : t('agent.denied')}
                      </div>
                    ) : step.thought ? (
                      <div className="sz:text-[11px] sz:text-gray-500 sz:break-words">{step.thought}</div>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
      ) : null}
      {awaiting?.action.kind === 'plan' ? (
        <div role="alertdialog" aria-labelledby={`sz-agent-approval-${awaiting.id}`} className={cardClass('cyan')}>
          <div
            id={`sz-agent-approval-${awaiting.id}`}
            className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold"
          >
            <OrderedListOutlined className="sz:text-sz-cyan" />
            {t('agent.planTitle')}
          </div>
          <div className={`${bodyClass} sz:whitespace-pre-wrap`}>{awaiting.action.text}</div>
          {awaiting.action.sites?.length ? (
            <div className="sz:mt-1.5 sz:text-xs sz:text-gray-500 sz:break-words">
              {t('agent.planSites', { sites: awaiting.action.sites.join(', ') })}
            </div>
          ) : null}
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500">{t('agent.planHint')}</div>
          <div className="sz:flex sz:gap-2 sz:mt-2.5">
            <Button color="cyan" variant="solid" size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer(true)}>
              {t('agent.planStart')}
            </Button>
            <Button size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer(false)}>
              {t('agent.planCancel')}
            </Button>
          </div>
        </div>
      ) : awaiting?.site ? (
        <div role="alertdialog" aria-labelledby={`sz-agent-approval-${awaiting.id}`} className={cardClass('amber')}>
          <div
            id={`sz-agent-approval-${awaiting.id}`}
            className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold sz:break-words"
          >
            <SafetyCertificateOutlined className="sz:text-amber-500" />
            {t('agent.siteTitle', { site: awaiting.site })}
          </div>
          <div className={bodyClass}>{agentStepLabel(awaiting, t)}</div>
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500">{t('agent.siteHint')}</div>
          <div className="sz:flex sz:flex-wrap sz:gap-2 sz:mt-2.5">
            <Button color="cyan" variant="solid" size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer(true)}>
              {t('agent.allowOnce')}
            </Button>
            <Button size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer('always')}>
              {t('agent.allowAlways')}
            </Button>
            <Button size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer(false)}>
              {t('agent.deny')}
            </Button>
          </div>
        </div>
      ) : awaiting ? (
        <div role="alertdialog" aria-labelledby={`sz-agent-approval-${awaiting.id}`} className={cardClass('amber')}>
          <div
            id={`sz-agent-approval-${awaiting.id}`}
            className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold"
          >
            <SafetyCertificateOutlined className="sz:text-amber-500" />
            {t('agent.approvalTitle')}
          </div>
          <div className={bodyClass}>{agentStepLabel(awaiting, t)}</div>
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500 sz:break-words">
            {host ? `${host} · ` : ''}
            {t('agent.approvalHint')}
          </div>
          <div className="sz:flex sz:gap-2 sz:mt-2.5">
            <Button
              color="cyan"
              variant="solid"
              size="small"
              autoFocus
              disabled={answered === cardOf(awaiting)}
              onClick={() => answer(true)}
            >
              {t('agent.allow')}
            </Button>
            <Button size="small" disabled={answered === cardOf(awaiting)} onClick={() => answer(false)}>
              {t('agent.deny')}
            </Button>
          </div>
        </div>
      ) : null}
      {turn ? (
        <div role="status" className={cardClass('cyan')}>
          <div className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold">
            {turn.action.kind === 'point' ? (
              <AimOutlined className="sz:text-sz-cyan" />
            ) : (
              <UserOutlined className="sz:text-sz-cyan" />
            )}
            {t(turn.action.kind === 'point' ? 'agent.pointTitle' : 'agent.handoffTitle')}
          </div>
          <div className={bodyClass}>{turn.action.text}</div>
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500">
            {t(turn.action.kind === 'point' ? 'agent.pointHint' : 'agent.handoffHint')}
          </div>
          <div className="sz:flex sz:gap-2 sz:mt-2.5">
            {turn.action.kind === 'handoff' ? (
              <Button color="cyan" variant="solid" size="small" disabled={answered === cardOf(turn)} onClick={() => answer(true, turn)}>
                {t('agent.resume')}
              </Button>
            ) : null}
            <Button size="small" disabled={answered === cardOf(turn)} onClick={() => answer(false, turn)}>
              {t('agent.cancelTurn')}
            </Button>
          </div>
        </div>
      ) : null}
      {question ? (
        <div
          role="status"
          className={`sz:mt-2 sz:w-full sz:rounded-xl sz:border sz:p-3 sz:animate-[sz-fade-in_0.25s_ease-out] sz:motion-reduce:animate-none ${
            dark ? 'sz:border-sz-cyan/40 sz:bg-sz-cyan/10' : 'sz:border-sz-cyan/40 sz:bg-cyan-50'
          }`}
        >
          <div className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold">
            <QuestionCircleOutlined className="sz:text-sz-cyan" />
            {t('agent.questionTitle')}
          </div>
          <div className={`sz:mt-1.5 sz:text-[13px] sz:break-words ${dark ? 'sz:text-gray-100' : 'sz:text-gray-800'}`}>
            {question.action.text}
          </div>
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500">{t('agent.questionHint')}</div>
        </div>
      ) : null}
      {!live && run.tip && !tipState ? (
        <div role="group" aria-labelledby={`sz-agent-tip-${messageId}`} className={cardClass('cyan')}>
          <div id={`sz-agent-tip-${messageId}`} className="sz:flex sz:items-center sz:gap-1.5 sz:text-[13px] sz:font-semibold">
            <BulbOutlined className="sz:text-sz-cyan" />
            {t('agent.tipTitle', { site: run.tip.host })}
          </div>
          <div className={bodyClass}>{run.tip.text}</div>
          <div className="sz:mt-0.5 sz:text-xs sz:text-gray-500">{t('agent.tipHint')}</div>
          <div className="sz:flex sz:gap-2 sz:mt-2.5">
            <Button color="cyan" variant="solid" size="small" onClick={() => void answerTip(true)}>
              {t('agent.tipKeep')}
            </Button>
            <Button size="small" onClick={() => void answerTip(false)}>
              {t('agent.tipSkip')}
            </Button>
          </div>
        </div>
      ) : !live && run.tip && tipState === 'saved' ? (
        <div className="sz:flex sz:flex-row sz:items-start sz:gap-1 sz:text-xs sz:text-gray-500 sz:pt-1.5">
          <BulbOutlined className="sz:pt-[2px]" />
          <span>{t('agent.tipKept', { site: run.tip.host })}</span>
        </div>
      ) : null}
      {outcome ? (
        <div className="sz:flex sz:flex-row sz:items-start sz:gap-1 sz:text-xs sz:text-gray-500 sz:pt-1.5">
          <InfoCircleOutlined className="sz:pt-[2px]" />
          <span>{t(`agent.outcome.${outcome}`)}</span>
        </div>
      ) : null}
    </div>
  );
};

export default AgentRunBlock;
