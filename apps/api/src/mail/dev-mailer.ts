import type { EmailMessage, EmailProvider } from './provider';

export function createDevMailer(
  sink: EmailMessage[],
): EmailProvider & { sent: EmailMessage[] } {
  return {
    sent: sink,
    async send(message: EmailMessage): Promise<void> {
      sink.push(message);
    },
  };
}
