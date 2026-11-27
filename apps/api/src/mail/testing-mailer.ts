import type { EmailMessage, EmailProvider } from './provider';

const TEST_TEXT_NOTICE = '[TEST] This message came from the TEST environment.';
const TEST_HTML_NOTICE = '<p><strong>[TEST]</strong> This message came from the TEST environment.</p>';
const wrappedTestingMailer = Symbol('wrappedTestingMailer');

type WrappedTestingProvider<T extends EmailProvider> = T & { [wrappedTestingMailer]: true };

function labelSubject(subject: string): string {
  return /^\s*\[TEST\](?:\s|$)/i.test(subject) ? subject : `[TEST] ${subject}`;
}

function labelText(text: string): string {
  return /^\s*\[TEST\](?:\s|$)/i.test(text) ? text : `${TEST_TEXT_NOTICE}\n\n${text}`;
}

function labelHtml(html: string): string {
  if (html.includes(TEST_HTML_NOTICE) || /<strong[^>]*>\s*\[TEST\]\s*<\/strong>/i.test(html)) return html;
  const body = /<body(?:\s[^>]*)?>/i;
  return body.test(html)
    ? html.replace(body, (opening) => `${opening}\n${TEST_HTML_NOTICE}\n`)
    : `${TEST_HTML_NOTICE}\n${html}`;
}

export function createTestingMailer<T extends EmailProvider>(provider: T): WrappedTestingProvider<T> {
  if (wrappedTestingMailer in provider) return provider as WrappedTestingProvider<T>;
  return {
    ...provider,
    [wrappedTestingMailer]: true,
    async send(message: EmailMessage) {
      return provider.send({
        ...message,
        subject: labelSubject(message.subject),
        text: labelText(message.text),
        ...(message.html !== undefined ? { html: labelHtml(message.html) } : {}),
      });
    },
  } as WrappedTestingProvider<T>;
}
