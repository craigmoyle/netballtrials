import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../../mail/provider';
import { createTestRoutedMailer } from '../../mail/test-routed-mailer';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('test email routing', () => {
  it('sends allowlisted recipients through Gmail and stores every other recipient as simulated', async () => {
    const sent: EmailMessage[] = [];
    const liveMailer = { provider: 'gmail-api' as const, send: vi.fn(async (message: EmailMessage) => { sent.push(message); }) };
    const mailer = createTestRoutedMailer(prisma, liveMailer, ['CMoyle@gmail.com']);

    expect(await mailer.send({ to: 'cmoyle@gmail.com', subject: 'Real test', text: 'Delivered' })).toBeUndefined();
    expect(await mailer.send({ to: 'family@example.test', subject: 'Simulated test', text: 'Open this test link: https://test.example/admin/verify#token=sample' })).toBe('simulated');

    expect(liveMailer.send).toHaveBeenCalledTimes(1);
    expect(sent[0]?.to).toBe('cmoyle@gmail.com');
    expect(await prisma.testEmailOutbox.findMany()).toMatchObject([
      { to: 'family@example.test', subject: 'Simulated test', body: 'Open this test link: https://test.example/admin/verify#token=sample' },
    ]);
  });
});
