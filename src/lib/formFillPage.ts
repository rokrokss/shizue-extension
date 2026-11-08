import type { FieldExtra } from '@/lib/formFill';

// What filling a form from another tab (lib/formFill.ts) runs in the form's frame, each function
// injected on its own with chrome.scripting.executeScript, so none uses anything outside itself.
// The fields are numbered by the browser agent's snapshot (snapshotPage), and filled by its
// performAction, which finds an element by that number.

type FormFillGlobals = {
  __shizueAgentRefs?: Map<number, Element>;
  __shizueFormFillRefs?: Map<number, Element>;
  __shizueAgentOverlay?: { host: HTMLElement };
};

// Whether the browser agent is working this tab: its pill is on the page. Its next snapshot would
// renumber the fields under the fill, and its actions would race the user's review.
export function agentWorkingHere(): boolean {
  return Boolean((globalThis as unknown as FormFillGlobals).__shizueAgentOverlay?.host.isConnected);
}

// Right after snapshotPage in the same frame: keeps the fields' numbering for the fill, and tells
// for each what the snapshot doesn't. The form is the one around the focused field, which is the
// one right-clicked: a right click focuses a text field.
export function keepFormFields(refs: number[]): Record<number, FieldExtra> {
  const globals = globalThis as unknown as FormFillGlobals;
  const numbered = globals.__shizueAgentRefs ?? new Map<number, Element>();
  let focused = document.activeElement;
  while (focused?.shadowRoot?.activeElement) focused = focused.shadowRoot.activeElement;
  const form = focused?.closest('form') ?? null;
  const kept = new Map<number, Element>();
  const extras: Record<number, FieldExtra> = {};
  for (const ref of refs) {
    const element = numbered.get(ref);
    if (!element) continue;
    kept.set(ref, element);
    const extra: FieldExtra = {};
    const autocomplete = (element.getAttribute('autocomplete') ?? '').trim().toLowerCase();
    if (autocomplete && autocomplete !== 'on' && autocomplete !== 'off') extra.autocomplete = autocomplete;
    if (form?.contains(element)) extra.sameForm = true;
    extras[ref] = extra;
  }
  globals.__shizueFormFillRefs = kept;
  return extras;
}

// Before the fill: puts the kept numbering back for performAction (a snapshot since may have
// replaced it), and tells for each field whether it is still on the page with the value it had
// when read. A field the user or the page changed since is left alone.
export function checkFormFields(fields: { ref: number; value: string }[]): Record<number, 'ok' | 'gone' | 'changed'> {
  const globals = globalThis as unknown as FormFillGlobals;
  const kept = globals.__shizueFormFillRefs;
  if (kept) globals.__shizueAgentRefs = new Map(kept);
  const clean = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim();
  const states: Record<number, 'ok' | 'gone' | 'changed'> = {};
  for (const { ref, value } of fields) {
    const element = kept?.get(ref);
    if (!element?.isConnected) {
      states[ref] = 'gone';
      continue;
    }
    const now =
      element instanceof HTMLSelectElement
        ? clean(element.selectedOptions[0]?.text)
        : element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? element.value.slice(0, 200)
          : '';
    states[ref] = now === value ? 'ok' : 'changed';
  }
  return states;
}
