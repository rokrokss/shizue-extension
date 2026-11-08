import test from 'node:test';
import assert from 'node:assert/strict';
import { describeFields, formFields, matchOption, MAX_FORM_FIELDS, parseFormFillValues } from '../src/lib/formFill.ts';

const elements = [
  { ref: 1, tag: 'input', type: 'search', name: 'Search', search: true },
  { ref: 2, tag: 'input', type: 'text', name: 'Full name' },
  { ref: 3, tag: 'input', type: 'email', name: 'Email', value: 'old@example.com' },
  { ref: 4, tag: 'input', type: 'password', name: 'Password', secret: true },
  { ref: 5, tag: 'input', type: 'text', name: 'Card number', secret: true },
  { ref: 6, tag: 'select', name: 'Country', value: 'Choose', options: ['Choose', 'Korea, Republic of', 'Japan'] },
  { ref: 7, tag: 'textarea', name: 'Cover letter' },
  { ref: 8, tag: 'input', type: 'checkbox', name: 'I agree', checked: false },
  { ref: 9, tag: 'button', name: 'Submit' },
  { ref: 10, tag: 'input', type: 'text', name: 'Disabled', disabled: true },
  { ref: 11, tag: 'input', type: 'date', name: '' },
  { ref: 12, tag: 'input', type: 'file', name: 'Résumé' },
];

test('Only fields a value can be typed or picked into, never secrets, searches or checkboxes', () => {
  const fields = formFields(elements, { 11: { autocomplete: 'bday' } });
  assert.deepEqual(
    fields.map((field) => [field.ref, field.kind, field.type, field.label]),
    [
      [2, 'type', 'text', 'Full name'],
      [3, 'type', 'email', 'Email'],
      [6, 'select', 'select', 'Country'],
      [7, 'type', 'textarea', 'Cover letter'],
      // No label, but its autocomplete hint says what it is for.
      [11, 'type', 'date', 'bday'],
    ]
  );
  assert.equal(fields[1].value, 'old@example.com');
  // A field with nothing to tell what it is for is left out.
  assert.equal(formFields([{ ref: 1, tag: 'input', type: 'text', name: '' }]).length, 0);
});

test('The right-clicked form only, when the field is in one; at most MAX_FORM_FIELDS', () => {
  const fields = formFields(elements, { 3: { sameForm: true }, 7: { sameForm: true } });
  assert.deepEqual(fields.map((field) => field.ref), [3, 7]);
  const many = Array.from({ length: 80 }, (_, i) => ({ ref: i + 1, tag: 'input', type: 'text', name: `Field ${i}` }));
  assert.equal(formFields(many).length, MAX_FORM_FIELDS);
});

test('The prompt lists each field with its type, hint, choices and current value', () => {
  const lines = describeFields(formFields(elements, { 2: { autocomplete: 'name' } })).split('\n');
  assert.equal(lines[0], '[2] "Full name" (text; autocomplete: name)');
  assert.equal(lines[1], '[3] "Email" (email; now: "old@example.com")');
  assert.equal(lines[2], '[6] "Country" (select; choices: "Choose" | "Korea, Republic of" | "Japan"; now: "Choose")');
});

test('A dropdown value is one of its choices: the same text, or the only one that contains it', () => {
  const options = ['Choose', 'Korea, Republic of', 'Japan', 'Japanese Islands'];
  assert.equal(matchOption('  japan ', options), 'Japan');
  assert.equal(matchOption('Korea', options), 'Korea, Republic of');
  // Two choices contain it, and neither is it.
  assert.equal(matchOption('Jap', options), null);
  assert.equal(matchOption('France', options), null);
  assert.equal(matchOption('', options), null);
});

test("The model's values are kept only where they fit the form", () => {
  const fields = formFields(elements);
  const reply = JSON.stringify({
    values: [
      { ref: 2, value: '  Kim   Hyungrok ' },
      { ref: 2, value: 'Someone else' },
      // Already there.
      { ref: 3, value: 'old@example.com' },
      // Not a field of the form: a password, and a number the form doesn't have.
      { ref: 4, value: 'hunter2' },
      { ref: 99, value: 'x' },
      { ref: '6', value: 'korea' },
      { ref: 7, value: 'Dear team,\n\nI would like to apply.' },
      { ref: 11, value: '' },
    ],
  });
  assert.deepEqual(parseFormFillValues('```json\n' + reply + '\n```', fields), [
    { ref: 2, value: 'Kim Hyungrok' },
    { ref: 6, value: 'Korea, Republic of' },
    { ref: 7, value: 'Dear team,\n\nI would like to apply.' },
  ]);
  // A choice the dropdown doesn't have is dropped.
  assert.deepEqual(parseFormFillValues('{"values":[{"ref":6,"value":"France"}]}', fields), []);
  // A model without JSON mode may say something first.
  assert.deepEqual(parseFormFillValues('Here are the values:\n{"values":[{"ref":2,"value":"Kim"}]}', fields), [
    { ref: 2, value: 'Kim' },
  ]);
  assert.deepEqual(parseFormFillValues('not json', fields), []);
  assert.deepEqual(parseFormFillValues('{"values":"nope"}', fields), []);
});
