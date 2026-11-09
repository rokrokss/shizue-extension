import { attachRowClass, isWebTab, TabSummary } from '@/components/Chat/AttachMenu';
import { DotCycle } from '@/components/Loader/DotCycle';
import { useThemeValue } from '@/hooks/layout';
import type { FormField, FormFillProposal } from '@/lib/formFill';
import { isWebStorePage } from '@/lib/webStore';
import { fillForm, proposeValues, readForm, type FillOutcome } from '@/services/formFill';
import { FormOutlined } from '@ant-design/icons';
import { Button, Checkbox, Input, Select } from 'antd';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Form = { fields: FormField[]; title: string; url: string };

type Step =
  | { kind: 'reading' }
  | { kind: 'error'; message: string }
  | { kind: 'pick'; form: Form; tabs: chrome.tabs.Tab[] }
  | { kind: 'proposing'; form: Form; source: chrome.tabs.Tab }
  | { kind: 'review'; form: Form; source: string; rows: Row[] }
  | { kind: 'filling' }
  | { kind: 'done'; filled: number; skipped: { label: string; outcome: FillOutcome }[] };

type Row = FormFillProposal & { checked: boolean };

// Filling the right-clicked form from another open tab (lib/formFill.ts): the user picks the tab,
// the chat model proposes a value for each field it answers, and the user checks and edits them
// before anything is typed. The form is never submitted.
const FormFillCard = ({
  request,
  onClose,
}: {
  request: { tabId: number; frameId: number };
  onClose: () => void;
}) => {
  const { t } = useTranslation();
  const theme = useThemeValue();
  const [step, setStep] = useState<Step>({ kind: 'reading' });

  const listTabs = async (form: Form) => {
    const tabs = (await chrome.tabs.query({ currentWindow: true })).filter(
      (tab) =>
        isWebTab(tab) && tab.id !== request.tabId && !tab.discarded && !isWebStorePage(tab.url)
    );
    setStep({ kind: 'pick', form, tabs });
  };

  useEffect(() => {
    void readForm(request.tabId, request.frameId).then((read) =>
      read.success
        ? listTabs({ fields: read.fields, title: read.title, url: read.url })
        : setStep({ kind: 'error', message: t(`formFill.error.${read.error}`) })
    );
  }, []);

  const propose = async (form: Form, source: chrome.tabs.Tab) => {
    setStep({ kind: 'proposing', form, source });
    const result = await proposeValues(form.fields, { title: form.title, url: form.url }, source.id!);
    if (!result.success) {
      const message =
        result.error === 'failed' ? t('formFill.error.failed') : t(`formFill.error.source_${result.error}`);
      setStep({ kind: 'error', message: result.message ? `${message} (${result.message})` : message });
      return;
    }
    setStep({
      kind: 'review',
      form,
      source: result.sourceTitle || source.title || '',
      rows: result.proposals.map((proposal) => ({ ...proposal, checked: true })),
    });
  };

  const fill = async (form: Form, rows: Row[]) => {
    const fills = rows.filter((row) => row.checked && row.value.trim());
    setStep({ kind: 'filling' });
    const outcomes = await fillForm(request.tabId, request.frameId, form.fields, fills);
    if (outcomes === 'agent_running') {
      setStep({ kind: 'error', message: t('formFill.error.agent_running') });
      return;
    }
    const labelOf = (ref: number) => form.fields.find((field) => field.ref === ref)?.label ?? '';
    setStep({
      kind: 'done',
      filled: fills.filter(({ ref }) => outcomes[ref] === 'filled').length,
      skipped: fills
        .filter(({ ref }) => outcomes[ref] !== 'filled')
        .map(({ ref }) => ({ label: labelOf(ref), outcome: outcomes[ref] ?? 'failed' })),
    });
  };

  const muted = 'sz:text-xs sz:text-gray-500';
  const busy = (text: string) => (
    <div className="sz:flex sz:flex-col sz:items-center sz:gap-2 sz:py-6" aria-busy="true">
      <DotCycle />
      <div className={`${muted} sz:text-center sz:break-words`}>{text}</div>
    </div>
  );

  return (
    <div className="sz:flex sz:flex-col sz:gap-3 sz:max-h-[70vh] sz:overflow-y-auto sz:scrollbar-hidden">
      <div className="sz:flex sz:items-center sz:gap-1.5 sz:text-sm sz:font-semibold sz:pr-6">
        <FormOutlined className="sz:text-sz-cyan" />
        {t('formFill.title')}
      </div>

      {step.kind === 'reading' && busy(t('formFill.reading'))}

      {step.kind === 'error' && (
        <>
          <div className="sz:text-[13px] sz:break-words">{step.message}</div>
          <div>
            <Button size="small" onClick={onClose}>
              {t('formFill.close')}
            </Button>
          </div>
        </>
      )}

      {step.kind === 'pick' && (
        <>
          <div className={muted}>{t('formFill.fieldsFound', { count: step.form.fields.length })}</div>
          <div className="sz:text-[13px]">{t('formFill.pickSource')}</div>
          {step.tabs.length ? (
            <div className="sz:flex sz:flex-col">
              {step.tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={attachRowClass(false, theme)}
                  onClick={() => void propose(step.form, tab)}
                >
                  <TabSummary tab={tab} />
                </button>
              ))}
            </div>
          ) : (
            <div className={muted}>{t('formFill.noTabs')}</div>
          )}
        </>
      )}

      {step.kind === 'proposing' && busy(t('formFill.proposing', { title: step.source.title ?? '' }))}

      {step.kind === 'review' && (
        <>
          <div className={`${muted} sz:break-words`}>{t('formFill.reviewSource', { title: step.source })}</div>
          {step.rows.length ? (
            <>
              <div className="sz:text-[13px]">{t('formFill.reviewHint')}</div>
              <div className="sz:flex sz:flex-col sz:gap-2">
                {step.rows.map((row, index) => {
                  const field = step.form.fields.find((candidate) => candidate.ref === row.ref)!;
                  const update = (change: Partial<Row>) =>
                    setStep({
                      ...step,
                      rows: step.rows.map((other, i) => (i === index ? { ...other, ...change } : other)),
                    });
                  return (
                    <div key={row.ref} className="sz:flex sz:items-start sz:gap-2">
                      <Checkbox
                        className="sz:mt-1"
                        checked={row.checked}
                        aria-label={field.label}
                        onChange={(event) => update({ checked: event.target.checked })}
                      />
                      <div className="sz:min-w-0 sz:flex-1">
                        <div className={`${muted} sz:truncate`}>{field.label}</div>
                        {field.kind === 'select' ? (
                          <Select
                            size="small"
                            className="sz:w-full"
                            value={row.value}
                            disabled={!row.checked}
                            options={field.options!.map((option) => ({ value: option, label: option }))}
                            onChange={(value) => update({ value })}
                          />
                        ) : field.type === 'textarea' ? (
                          <Input.TextArea
                            size="small"
                            autoSize={{ minRows: 1, maxRows: 5 }}
                            value={row.value}
                            disabled={!row.checked}
                            onChange={(event) => update({ value: event.target.value })}
                          />
                        ) : (
                          <Input
                            size="small"
                            value={row.value}
                            disabled={!row.checked}
                            onChange={(event) => update({ value: event.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className={muted}>{t('formFill.noSubmit')}</div>
            </>
          ) : (
            <div className="sz:text-[13px]">{t('formFill.nothingFound')}</div>
          )}
          <div className="sz:flex sz:gap-2">
            {step.rows.length > 0 && (
              <Button
                color="cyan"
                variant="solid"
                size="small"
                disabled={!step.rows.some((row) => row.checked && row.value.trim())}
                onClick={() => void fill(step.form, step.rows)}
              >
                {t('formFill.fill', { count: step.rows.filter((row) => row.checked && row.value.trim()).length })}
              </Button>
            )}
            <Button size="small" onClick={() => void listTabs(step.form)}>
              {t('formFill.otherTab')}
            </Button>
          </div>
        </>
      )}

      {step.kind === 'filling' && busy(t('formFill.filling'))}

      {step.kind === 'done' && (
        <>
          <div className="sz:text-[13px]">{t('formFill.filled', { count: step.filled })}</div>
          {step.skipped.length > 0 && (
            <ul className={`${muted} sz:list-disc sz:pl-4 sz:break-words`}>
              {step.skipped.map((skipped, index) => (
                <li key={index}>
                  {skipped.label} · {t(`formFill.skipped.${skipped.outcome}`)}
                </li>
              ))}
            </ul>
          )}
          <div className={muted}>{t('formFill.noSubmit')}</div>
          <div>
            <Button size="small" onClick={onClose}>
              {t('formFill.close')}
            </Button>
          </div>
        </>
      )}
    </div>
  );
};

export default FormFillCard;
