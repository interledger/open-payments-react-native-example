/**
 * Converts a user-entered decimal ("12.5") into Open Payments' integer string
 * at the wallet's assetScale ("1250" at scale 2). String-based, no floats.
 */
export function toMinorUnits(decimal: string, assetScale: number): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(decimal.trim())
  if (!match) throw new Error(`Invalid amount: ${decimal}`)
  const [, whole, fraction = ''] = match
  if (fraction.length > assetScale) {
    throw new Error(`Amount ${decimal} has more than ${assetScale} decimal places`)
  }
  const minor = BigInt(whole + fraction.padEnd(assetScale, '0'))
  if (minor <= 0n) throw new Error('Amount must be greater than zero')
  return minor.toString()
}

export function formatAmount(amount: { value: string; assetScale: number; assetCode: string }): string {
  const padded = amount.value.padStart(amount.assetScale + 1, '0')
  const whole = padded.slice(0, padded.length - amount.assetScale)
  const fraction = amount.assetScale > 0 ? `.${padded.slice(-amount.assetScale)}` : ''
  return `${whole}${fraction} ${amount.assetCode}`
}
