import { generateJwk, generateKey } from '@interledger/http-signature-utils'
import { existsSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

/**
 * Generates the backend's Ed25519 client key with @interledger/http-signature-utils
 * and prints what to upload to the
 * Interledger Test Wallet (Settings → Developer Keys → Upload key). The
 * base64-encoded JWK is the same format the Web Monetization extension
 * uploads (`btoa(JSON.stringify(jwk))`).
 */
const dir = path.resolve('data/keys')
const fileName = 'client'
const pemPath = path.join(dir, `${fileName}.pem`)

if (existsSync(pemPath) && !process.argv.includes('--force')) {
  console.error(`${pemPath} already exists — pass --force to replace it.`)
  process.exit(1)
}

mkdirSync(dir, { recursive: true })
const keyId = randomUUID()
const privateKey = generateKey({ dir, fileName })
const jwk = generateJwk({ keyId, privateKey })

console.log(`Private key written to ${pemPath}\n`)
console.log('Public JWK:')
console.log(JSON.stringify(jwk, null, 2))
console.log('\nBase64 public key (paste into the test wallet\'s "Upload key"):')
console.log(Buffer.from(JSON.stringify(jwk)).toString('base64'))
console.log('\nThen set in server/.env:')
console.log(`KEY_ID=${keyId}`)
console.log(`PRIVATE_KEY_PATH=./data/keys/${fileName}.pem`)
