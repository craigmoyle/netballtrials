import type { EmailMessage, EmailProvider } from './provider';

const MAX_RETAINED_MESSAGES = 100;

export function createDevMailer(
  sink: EmailMessage[],
): EmailProvider & { sent: EmailMessage[] } {
  return {
    sent: sink,
    async send(message: EmailMessage): Promise<'simulated'> {
      sink.push(message);
      if (sink.length > MAX_RETAINED_MESSAGES) sink.splice(0, sink.length - MAX_RETAINED_MESSAGES);
      return 'simulated';
    },
  };
}
