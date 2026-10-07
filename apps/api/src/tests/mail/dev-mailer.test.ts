import { describe, it, expect } from 'vitest';
import { createDevMailer } from '../../mail/dev-mailer';

describe('dev mailer', () => {
  it('captures messages instead of sending them', async () => {
    const sink: any[] = [];
    await createDevMailer(sink).send({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
    expect(sink).toHaveLength(1);
    expect(sink[0].to).toBe('a@example.com');
  });
});
