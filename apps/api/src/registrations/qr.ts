import QRCode from 'qrcode';

export async function qrDataUrl(token: string): Promise<string> {
  return QRCode.toDataURL(token, { margin: 1, width: 320 });
}
