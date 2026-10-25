// Same helpers as server/src/amount.ts, string-based (no floats).

export function toMinorUnits(decimal: string, assetScale: number): string {
  const match = /^(\d+)(?:[.,](\d+))?$/.exec(decimal.trim())
  if (!match) throw new Error(`Invalid amount: ${decimal}`)
  const [, whole, fraction = ''] = match
  if (fraction.length > assetScale) throw new Error(`At most ${assetScale} decimal places`)
  const minor = (whole + fraction.padEnd(assetScale, '0')).replace(/^0+(?=\d)/, '')
  if (/^0+$/.test(minor)) throw new Error('Amount must be greater than zero')
  return minor
}

export function formatAmount(amount: { value: string; assetScale: number; assetCode: string }): string {
  const padded = amount.value.padStart(amount.assetScale + 1, '0')
  const whole = padded.slice(0, padded.length - amount.assetScale)
  const fraction = amount.assetScale > 0 ? `.${padded.slice(-amount.assetScale)}` : ''
  return `${whole}${fraction} ${amount.assetCode}`
}
