import { describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '../../mail/provider';
import { createTestingMailer } from '../../mail/testing-mailer';

describe('testing mail labeling', () => {
  it('marks subject, text and HTML without changing the original message or attachments', async () => {
    const send = vi.fn(async (_message: EmailMessage) => undefined);
    const attachment = { filename: 'details.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') };
    const original = {
      to: 'family@example.test',
      subject: 'Trial details',
      text: 'Bring water.',
      html: '<!doctype html><html><body><p>Bring water.</p></body></html>',
      attachments: [attachment],
    };

    await createTestingMailer({ send }).send(original);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: original.to,
      subject: '[TEST] Trial details',
      text: '[TEST] This message came from the TEST environment.\n\nBring water.',
      html: '<!doctype html><html><body>\n<p><strong>[TEST]</strong> This message came from the TEST environment.</p>\n<p>Bring water.</p></body></html>',
      attachments: [attachment],
    }));
    expect(original).toMatchObject({ subject: 'Trial details', text: 'Bring water.', html: '<!doctype html><html><body><p>Bring water.</p></body></html>' });
  });

  it('does not duplicate TEST markers when a delivery is sent or wrapped again', async () => {
    const send = vi.fn(async (_message: EmailMessage) => undefined);
    const mailer = createTestingMailer({ send });
    const labeled = {
      to: 'admin@example.test',
      subject: '[TEST] Sign in',
      text: '[TEST] This message came from the TEST environment.\n\nUse the link.',
      html: '<p><strong>[TEST]</strong> This message came from the TEST environment.</p>\n<p>Use the link.</p>',
    };

    await mailer.send(labeled);
    await createTestingMailer(mailer).send(labeled);

    for (const [message] of send.mock.calls) {
      expect(message.subject.match(/\[TEST\]/g)).toHaveLength(1);
      expect(message.text.match(/\[TEST\]/g)).toHaveLength(1);
      expect(message.html?.match(/\[TEST\]/g)).toHaveLength(1);
    }
  });
});
