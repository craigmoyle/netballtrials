import { describe, expect, it } from 'vitest';
import { renderEmailTemplate, unsupportedTemplateFields } from '../../messages/template-renderer';

describe('communication template fields', () => {
  it('renders only the allow-listed audience fields', () => {
    const template = 'Hello {{ playerFirstName }}: {{playerNames}}';
    expect(unsupportedTemplateFields('participants', template)).toEqual([]);
    expect(renderEmailTemplate(template, { playerFirstName: 'Ada', playerNames: 'Ada Lovelace, Grace Hopper' }))
      .toBe('Hello Ada: Ada Lovelace, Grace Hopper');
  });

  it('rejects unknown and malformed placeholders instead of sending them literally', () => {
    expect(unsupportedTemplateFields('participants', 'Hello {{playerFistName}} {{player First}}'))
      .toEqual(['playerFistName', 'player First']);
    expect(renderEmailTemplate('Hello {{playerFistName}}', {})).toBe('Hello ');
  });
});
