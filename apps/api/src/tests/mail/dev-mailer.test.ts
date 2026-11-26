import { describe, it, expect } from 'vitest';
import { createDevMailer } from '../../mail/dev-mailer';

describe('dev mailer', () => {
  it('captures messages instead of sending them', async () => {
    const sink: any[] = [];
    expect(await createDevMailer(sink).send({ to: 'a@example.com', subject: 'Hi', text: 'Body' })).toBe('simulated');
    expect(sink).toHaveLength(1);
    expect(sink[0].to).toBe('a@example.com');
  });

  it('bounds retained simulated messages', async () => {
    const sink: any[] = [];
    const mailer = createDevMailer(sink);
    for (let index = 0; index < 105; index += 1) {
      await mailer.send({ to: `${index}@example.com`, subject: 'Hi', text: 'Body' });
    }
    expect(sink).toHaveLength(100);
    expect(sink[0].to).toBe('5@example.com');
  });
});
