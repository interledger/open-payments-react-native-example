import { z } from 'zod'

try {
  process.loadEnvFile('.env')
} catch {
  // No .env — rely on the real environment.
}

const envSchema = z.object({
  TARGET: z.enum(['testwallet', 'local']).default('testwallet'),
  CLIENT_WALLET_ADDRESS: z.string().url(),
  KEY_ID: z.string().min(1),
  PRIVATE_KEY_PATH: z.string().min(1),
  APP_FINISH_URI: z.string().min(1).default('openpayments-rn-example://op/finish'),
  // finish URIs the app may ask for (Expo Go uses exp://…, Expo web uses
  // http://localhost:8081/…). Omitted → APP_FINISH_URI; anything else → 400.
  ALLOWED_FINISH_URI_PREFIXES: z
    .string()
    .default('openpayments-rn-example://,exp://,http://localhost:,https://localhost:'),
  PORT: z.coerce.number().int().positive().default(3040),
  DATABASE_FILE: z.string().min(1).default('./data/mobile.db')
})

const env = envSchema.parse(process.env)

export const CONFIG = {
  target: env.TARGET,
  clientWalletAddress: env.CLIENT_WALLET_ADDRESS,
  keyId: env.KEY_ID,
  privateKeyPath: env.PRIVATE_KEY_PATH,
  appFinishUri: env.APP_FINISH_URI,
  allowedFinishUriPrefixes: env.ALLOWED_FINISH_URI_PREFIXES.split(',').map((p) => p.trim()).filter(Boolean),
  port: env.PORT,
  databaseFile: env.DATABASE_FILE
} as const
