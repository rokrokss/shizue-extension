import { MESSAGE_FORM_FILL_PROPOSE } from '@/config/constants';
import { performAction, snapshotPage } from '@/lib/browserAgentPage';
import { formFields, type FormField, type FormFillProposal } from '@/lib/formFill';
import { agentWorkingHere, checkFormFields, keepFormFields } from '@/lib/formFillPage';
import type { FormFillProposeResult } from '@/services/background/formFillHandler';

// The side panel's half of filling a form from another tab (lib/formFill.ts): it reads and fills
// the form in the frame that was right-clicked, and asks the background for the values.

export type FormRead =
  | { success: true; fields: FormField[]; title: string; url: string }
  | { success: false; error: 'agent_running' | 'unreadable' | 'no_fields' };

export type FillOutcome = 'filled' | 'gone' | 'changed' | 'failed';

// The form's fields as they are now, numbered for the fill.
export async function readForm(tabId: number, frameId: number): Promise<FormRead> {
  try {
    const [agent] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: agentWorkingHere });
    if (agent?.result) return { success: false, error: 'agent_running' };
    const target = { tabId, frameIds: [frameId] };
    // No page text: only the controls are wanted.
    const [snapshot] = await chrome.scripting.executeScript({ target, func: snapshotPage, args: [0] });
    const elements = snapshot?.result?.elements;
    if (!elements) return { success: false, error: 'unreadable' };
    const candidates = elements
      .filter((element) => ['input', 'textarea', 'select'].includes(element.tag))
      .map((element) => element.ref);
    const [kept] = await chrome.scripting.executeScript({ target, func: keepFormFields, args: [candidates] });
    const fields = formFields(elements, kept?.result ?? {});
    if (!fields.length) return { success: false, error: 'no_fields' };
    const tab = await chrome.tabs.get(tabId);
    return { success: true, fields, title: tab.title ?? '', url: tab.url ?? '' };
  } catch {
    return { success: false, error: 'unreadable' };
  }
}

export const proposeValues = (fields: FormField[], form: { title: string; url: string }, sourceTabId: number) =>
  chrome.runtime
    .sendMessage({ action: MESSAGE_FORM_FILL_PROPOSE, fields, form, sourceTabId })
    .then((result: FormFillProposeResult | undefined) => result ?? { success: false as const, error: 'failed' as const })
    .catch(
      (error): FormFillProposeResult => ({
        success: false,
        error: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    );

// Types or picks each value, one field after another, and never submits. A field gone from the
// page or changed since it was read is left alone.
export async function fillForm(
  tabId: number,
  frameId: number,
  fields: FormField[],
  fills: FormFillProposal[]
): Promise<Record<number, FillOutcome> | 'agent_running'> {
  const target = { tabId, frameIds: [frameId] };
  const byRef = new Map(fields.map((field) => [field.ref, field]));
  const outcomes: Record<number, FillOutcome> = {};
  try {
    const [agent] = await chrome.scripting.executeScript({ target: { tabId, frameIds: [0] }, func: agentWorkingHere });
    if (agent?.result) return 'agent_running';
    const [checked] = await chrome.scripting.executeScript({
      target,
      func: checkFormFields,
      args: [fills.map(({ ref }) => ({ ref, value: byRef.get(ref)?.value ?? '' }))],
    });
    const states = checked?.result;
    for (const { ref, value } of fills) {
      const state = states?.[ref];
      if (state !== 'ok') {
        outcomes[ref] = state ?? 'failed';
        continue;
      }
      const field = byRef.get(ref)!;
      const [done] = await chrome.scripting.executeScript({
        target,
        func: performAction,
        args: [{ kind: field.kind === 'select' ? 'select' : 'type', ref, text: value }],
      });
      const result = done?.result;
      outcomes[ref] = result?.ok ? 'filled' : result?.error === 'not_found' ? 'gone' : 'failed';
    }
  } catch {
    for (const { ref } of fills) outcomes[ref] ??= 'failed';
  }
  return outcomes;
}
