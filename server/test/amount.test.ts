import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatAmount, toMinorUnits } from '../src/amount'

test('toMinorUnits scales decimals without floats', () => {
  assert.equal(toMinorUnits('12.5', 2), '1250')
  assert.equal(toMinorUnits('0.01', 2), '1')
  assert.equal(toMinorUnits('7', 0), '7')
  assert.equal(toMinorUnits('0.1', 9), '100000000')
})

test('toMinorUnits rejects bad input', () => {
  assert.throws(() => toMinorUnits('1.234', 2))
  assert.throws(() => toMinorUnits('0', 2))
  assert.throws(() => toMinorUnits('-1', 2))
  assert.throws(() => toMinorUnits('abc', 2))
})

test('formatAmount', () => {
  assert.equal(formatAmount({ value: '1250', assetCode: 'USD', assetScale: 2 }), '12.50 USD')
  assert.equal(formatAmount({ value: '5', assetCode: 'USD', assetScale: 2 }), '0.05 USD')
  assert.equal(formatAmount({ value: '7', assetCode: 'XRP', assetScale: 0 }), '7 XRP')
})
