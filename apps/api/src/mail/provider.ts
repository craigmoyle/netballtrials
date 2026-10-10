export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Uint8Array;
}

export interface InlineEmailImage extends EmailAttachment {
  cid: string;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: EmailAttachment[];
  inlineImages?: InlineEmailImage[];
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}
