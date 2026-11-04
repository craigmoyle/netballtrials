import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../../mail/provider';
import { createTestRoutedMailer } from '../../mail/test-routed-mailer';
import { prisma } from '../../db';
import { resetDb } from '../helpers/db';

beforeEach(resetDb);

describe('test email routing', () => {
  it('sends current Admins through Gmail and simulates every other recipient', async () => {
    const sent: EmailMessage[] = [];
    const liveMailer = { provider: 'gmail-api' as const, send: vi.fn(async (message: EmailMessage) => { sent.push(message); }) };
    const mailer = createTestRoutedMailer(prisma, liveMailer);
    await prisma.staffUser.createMany({ data: [{ email: 'cmoyle@gmail.com' }, { email: 'nicole@example.test' }] });

    expect(await mailer.send({ to: 'cmoyle@gmail.com', subject: 'Real test', text: 'Delivered' })).toBeUndefined();
    expect(await mailer.send({ to: 'nicole@example.test', subject: 'Admin test', text: 'Delivered' })).toBeUndefined();
    await prisma.staffUser.delete({ where: { email: 'nicole@example.test' } });
    expect(await mailer.send({ to: 'nicole@example.test', subject: 'Revoked Admin', text: 'No longer delivered' })).toBe('simulated');
    expect(await mailer.send({ to: 'family@example.test', subject: 'Simulated test', text: 'Open this test link: https://test.example/admin/verify#token=sample' })).toBe('simulated');

    expect(liveMailer.send).toHaveBeenCalledTimes(2);
    expect(sent.map((message) => message.to)).toEqual(['cmoyle@gmail.com', 'nicole@example.test']);
    const simulated = await prisma.testEmailOutbox.findMany();
    expect(simulated).toHaveLength(2);
    expect(simulated).toEqual(expect.arrayContaining([
      expect.objectContaining({ to: 'nicole@example.test', subject: 'Revoked Admin', body: 'No longer delivered' }),
      expect.objectContaining({ to: 'family@example.test', subject: 'Simulated test', body: 'Open this test link: https://test.example/admin/verify#token=sample' }),
    ]));
  });
});
