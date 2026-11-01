import { describe, expect, it } from 'vitest';
import { previewAutomaticEmailTemplate } from './automatic-email-preview';

describe('automatic email preview', () => {
  it('fills recognized placeholders and leaves unknown tokens visible for correction', () => {
    expect(previewAutomaticEmailTemplate('{{playerName}} — {{eventName}} {{unknownField}}'))
      .toBe('Sample Player — Sample Trials {{unknownField}}');
  });
});
