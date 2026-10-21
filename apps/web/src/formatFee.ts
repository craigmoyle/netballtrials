const feeFormats = new Map<string, Intl.NumberFormat>();

export function formatFee(cents: number, currency: string): string {
  const code = currency.toUpperCase();
  let format = feeFormats.get(code);
  if (!format) {
    format = new Intl.NumberFormat('en-AU', { style: 'currency', currency: code });
    feeFormats.set(code, format);
  }
  return format.format(cents / 100);
}
