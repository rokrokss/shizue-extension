import type { PageElement } from '@/lib/browserAgent';

// Filling a form from another open tab, in Firefox Smart Form Fill's steps: the form's fields are
// read with the browser agent's snapshot (lib/browserAgentPage.ts), the chat model proposes a
// value for each field the picked tab answers, and the user reviews them before any is typed.
// Shizue never submits the form.

export type FormField = {
  // The field's number in the snapshot of its frame.
  ref: number;
  label: string;
  // Typed into, or one of `options` picked.
  kind: 'type' | 'select';
  // An input's type ('text', 'email', 'date', …), 'textarea' or 'select'.
  type: string;
  options?: string[];
  // As the snapshot read it: an input's value (its first 200 characters) or a dropdown's choice.
  value?: string;
  autocomplete?: string;
};

// What the page tells about a field beyond the snapshot, read in its frame right after it.
export type FieldExtra = { autocomplete?: string; sameForm?: boolean };

export type FormFillProposal = { ref: number; value: string };

// Inputs that take typed text. Checkboxes, radios, files and buttons are left to the user.
const TYPED_INPUTS = new Set([
  'text',
  'email',
  'tel',
  'url',
  'number',
  'date',
  'month',
  'week',
  'time',
  'datetime-local',
]);

// More fields than this is a page of many forms, not one.
export const MAX_FORM_FIELDS = 60;

// The source page's text, enough for a résumé or a quote and a bound on the call's cost.
export const FORM_FILL_SOURCE_CHARS = 40_000;

// The snapshot's elements a value can go into. Passwords, card numbers and one-time codes
// (`secret`), search boxes and disabled fields are left out, and so is a field with nothing to
// tell what it is for. When the right-clicked field is in a form, only that form's fields.
export function formFields(elements: PageElement[], extras: Record<number, FieldExtra> = {}): FormField[] {
  const fields: FormField[] = [];
  for (const element of elements) {
    if (element.secret || element.disabled || element.search) continue;
    const autocomplete = extras[element.ref]?.autocomplete;
    const label = element.name.trim() || autocomplete || '';
    if (!label) continue;
    let field: FormField;
    if (element.tag === 'select') {
      if (!element.options?.length) continue;
      field = { ref: element.ref, label, kind: 'select', type: 'select', options: element.options };
    } else if (element.tag === 'textarea') {
      field = { ref: element.ref, label, kind: 'type', type: 'textarea' };
    } else if (element.tag === 'input' && TYPED_INPUTS.has((element.type ?? 'text').toLowerCase())) {
      field = { ref: element.ref, label, kind: 'type', type: (element.type ?? 'text').toLowerCase() };
    } else {
      continue;
    }
    if (element.value) field.value = element.value;
    if (autocomplete) field.autocomplete = autocomplete;
    fields.push(field);
  }
  const inForm = fields.filter((field) => extras[field.ref]?.sameForm);
  return (inForm.length ? inForm : fields).slice(0, MAX_FORM_FIELDS);
}

// The fields as the prompt lists them, one a line.
export function describeFields(fields: FormField[]): string {
  return fields
    .map((field) => {
      const details = [field.type];
      if (field.autocomplete) details.push(`autocomplete: ${field.autocomplete}`);
      if (field.options) details.push(`choices: ${field.options.map((option) => JSON.stringify(option)).join(' | ')}`);
      if (field.value) details.push(`now: ${JSON.stringify(field.value)}`);
      return `[${field.ref}] ${JSON.stringify(field.label)} (${details.join('; ')})`;
    })
    .join('\n');
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim().toLowerCase();

// The dropdown choice a value names: the same text, or the one choice that contains it.
export function matchOption(value: string, options: string[]): string | null {
  const wanted = normalize(value);
  if (!wanted) return null;
  const same = options.find((option) => normalize(option) === wanted);
  if (same !== undefined) return same;
  const containing = options.filter((option) => normalize(option).includes(wanted));
  return containing.length === 1 ? containing[0] : null;
}

// The model's values, kept only where they fit: a field of the form, a value that isn't empty or
// already there, a dropdown choice the dropdown has. In the form's order, a field at most once.
export function parseFormFillValues(text: string, fields: FormField[]): FormFillProposal[] {
  let values: unknown;
  try {
    // A model without JSON mode may put a sentence or a code fence around the object.
    values = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '')?.values;
  } catch {
    return [];
  }
  if (!Array.isArray(values)) return [];
  const byRef = new Map(fields.map((field) => [field.ref, field]));
  const proposed = new Map<number, string>();
  for (const item of values) {
    const ref = typeof item?.ref === 'string' ? Number(item.ref) : item?.ref;
    const field = typeof ref === 'number' ? byRef.get(ref) : undefined;
    if (!field || proposed.has(field.ref) || typeof item.value !== 'string') continue;
    let value =
      field.type === 'textarea' ? item.value.trim().slice(0, 5000) : item.value.replace(/\s+/g, ' ').trim().slice(0, 1000);
    if (field.kind === 'select') value = matchOption(value, field.options ?? []) ?? '';
    if (!value || value === field.value) continue;
    proposed.set(field.ref, value);
  }
  return fields.filter((field) => proposed.has(field.ref)).map((field) => ({ ref: field.ref, value: proposed.get(field.ref)! }));
}
