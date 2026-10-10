import QRCode from 'qrcode';

const OPTIONS = { margin: 1, width: 320 };

export async function qrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, OPTIONS);
}

export async function qrPng(token: string): Promise<Buffer> {
  return QRCode.toBuffer(token, { ...OPTIONS, type: 'png' });
}
