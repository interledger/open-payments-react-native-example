# Open Payments React Native Example

A React Native / Expo app that uses [Open Payments](https://openpayments.dev) from a phone, against the [Interledger Test Wallet](https://wallet.interledger-test.dev). The backend's optional `TARGET=local` mode runs against Rafiki's [local playground](https://github.com/interledger/rafiki/tree/main/localenv) instead.

What it shows:

- **Connect a wallet:** the user's wallet confirms the user owns the address first (an Open Payments ownership check, run by the backend). Only then does the phone create its own key and add it to the wallet.
- **Send to contacts:** every payment has its own consent, in an in-app WebView that stays signed in to the wallet.
- **History:** live transfer status. The app also completes the receiver's incoming payment.
- **Budget:** the backend holds its own key, the user approves a budget once, and payments after that need no consent.

The design notes are in [docs/mobile-clients.md](docs/mobile-clients.md).

| | Who signs the Open Payments requests | Consent | Backend needed |
|---|---|---|---|
| **Connect** (Wallet tab) | the backend (its own wallet address + key) | once: sign in to the wallet and confirm ownership | yes |
| **Send / History** | **this phone** (Ed25519 key in the Keychain/Keystore, registered on the user's wallet address) | per payment, in the in-app WebView | no |
| **Budget** | the backend | once, for a budget, in the in-app WebView | yes |

```
open-payments-react-native-example/
├── app/                   Expo (SDK 57) + Expo Router
│   ├── src/app/           routes: (tabs)/ Send · History · Wallet · Budget, send/[contactId], history/[id]
│   ├── src/op/            on-device Open Payments client: Ed25519 keys, RFC 9421 signing, checkout, payment status
│   ├── src/device/        Keychain/Keystore + contacts/history storage, test wallet key auto-upload script
│   ├── src/state/         AppState context shared by the pages
│   ├── src/components/    WalletWebView (consent / key upload), Screen, StateBadge
│   ├── src/screens/       BudgetScreen
│   ├── test/              unit tests (signatures checked against @interledger/http-signature-utils)
│   └── scripts/           checkout-smoke.mts: runs src/op against the real test wallet from Node
├── server/                Node + Express backend: ownership checks (Connect) and the Budget grant
└── docs/                  design notes (mobile-clients.md) + Mermaid source of the send sequence diagram
```

## 1. Set up the backend

The backend is a GNAP client with its own wallet address and key. It runs the ownership check while the phone has no key yet, and it holds the Budget grant.

1. **Test wallet setup (one-off).** At [wallet.interledger-test.dev](https://wallet.interledger-test.dev):
   1. Create a wallet address for **the app** and give it a public name. Users see that name on the ownership and budget consent screens.
   2. Generate the backend's key:
      ```bash
      cd server && npm install && npm run gen-key
      ```
   3. Go to **Settings → Developer Keys → Upload key** and paste the printed key.
2. **Run it.**
   ```bash
   cd server
   cp .env.example .env   # set CLIENT_WALLET_ADDRESS, KEY_ID, PRIVATE_KEY_PATH
   npm run dev            # http://localhost:3040
   ```

- The app reaches the backend on the Expo dev server's host, port 3040. Override this with `EXPO_PUBLIC_API_URL`.
- **Local Rafiki** (`TARGET=local`): use a wallet address on the playground's Cloud Nine ASE, with a key you registered on it, as `CLIENT_WALLET_ADDRESS`. The mock IdP has no login. Pay from a mock-ASE account such as `…/accounts/gfranklin`.

You also need a **user wallet**: ideally a different test wallet login with some play money. Add a second wallet address (or another user's) to use as a contact.

## 2. Run the app on the iOS Simulator

You need Xcode with an iOS Simulator runtime. Install CocoaPods too if Expo asks for it (`brew install cocoapods`).

```bash
cd app
npm install
npx expo run:ios
```

Two things this setup needed (Xcode 27 / iOS 27 SDK):

- **The scene life cycle.** iOS 27 refuses to launch apps without it ("UIScene life cycle is required…"). Expo SDK 57 ships `ExpoAppSceneDelegate`, but its prebuild template doesn't use it yet, so the local config plugin [`app/plugins/withSceneLifecycle.js`](app/plugins/withSceneLifecycle.js) wires it up (registered in `app.json`). Don't edit `ios/` by hand. After changing plugins or `app.json`, regenerate with `npx expo prebuild --platform ios --clean`.
- **A UTF-8 locale for CocoaPods.** If `pod install` fails with `Unicode Normalization not appropriate for ASCII-8BIT`, run `export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` first.

The app uses `react-native-webview`, so use a dev build (`expo run:ios` / `run:android`). Expo Go also bundles the WebView, so `npx expo start` plus Expo Go on a phone works too. In a desktop browser (`npm run web`), the app uses a popup for consent and shows the key for a manual upload.

## 3. Try it

1. **Connect your wallet (Wallet tab, once).** Enter your wallet address (e.g. `$ilp.interledger-test.dev/alice`) and tap **Connect**.
   1. **Ownership.** The backend requests Open Payments' [verify wallet address ownership](https://openpayments.dev/guides/verify-wallet-address-ownership/) grant: an interactive grant with a `subject` and no payment rights. Your wallet opens inside the app. **Sign in** (first time only), and the test wallet confirms ownership by itself. The backend checks the redirect hash, continues the grant, and checks the wallet confirmed the same address.
   2. **Device key.** Only now does the phone create its Ed25519 key, stored in the Keychain.
   3. **Key on the wallet.** The wallet opens again, already signed in. A script running inside the wallet page adds the key through the wallet's API, and the WebView closes. The app checks the key is listed in `{walletAddress}/jwks.json`.
   
   All three steps show ✓ and the wallet is **connected**.
2. **Contacts (Send tab).** Add contacts by name and wallet address. Each address is checked live.
3. **Send.** Tap a contact, then **Send**, enter an amount, then **Proceed**.
   1. The phone creates the incoming payment (on the receiver's side), the quote, and an interactive grant limited to exactly this payment.
   2. The wallet's **consent screen** opens in the WebView with **no sign-in**, because the WebView kept your session.
   3. Tap **Accept**. The WebView closes, and the app continues the grant and creates the outgoing payment.
   4. The app waits until the receiver got the quoted amount, then **marks the receiver's incoming payment complete** (`POST …/complete`). Otherwise it would stay open until it expires, because it has no fixed `incomingAmount`.
4. **History.** Every transfer made from the app is listed. Tap one to see its live status (Completed / Processing / Failed, sent and delivered amounts), read from the wallet with that payment's own grant. That grant can't spend more, because it was limited to exactly that payment.
5. **Budget.** The tab shows your connected wallet. Enter an amount (optionally recurring monthly) and tap **Approve budget**: the backend requests the grant and you approve it in the WebView, already signed in. After that, **Pay** works with no browser and no consent. After 10 minutes the backend rotates the access token silently (it logs `access token rotated`). **Remove budget** cancels the grant.
6. **Relaunch the app and send again.** Consent still opens straight away. The test wallet session lasts about a month.

## Smoke test without a phone

This runs the exact `src/op` code the app uses from Node, signing as the backend's already-registered key:

```bash
cd app
npm run smoke -- --receiver '$ilp.interledger-test.dev/<someone>' --amount 0.01
```

It prints the consent URL. Approve it in a browser; the wallet redirects to a temporary `localhost:3999` listener, which completes the payment. Add `--prepare-only` to stop before consent. To complete an incoming payment that's still open (one this client created), add `--complete-incoming <incoming payment URL>`.

## Tests

```bash
cd app && npm test && npm run typecheck
cd server && npm test && npx tsc --noEmit
```

## Not production-ready

- **In-app WebView:** it goes against RFC 8252 for sign-in, and real wallets may block it. The automatic key upload uses the test wallet's private API.
- **Keys:** the device key is in the Keychain, not the Secure Enclave, which doesn't support Ed25519. Revoke it in the wallet if the phone is lost.
- **Backend:** it has no user accounts. Ownership-check and budget ids act as bearer handles, pending ownership checks live in memory, and Budget tokens are stored unencrypted in SQLite. A real backend would authenticate its users, tie the verified address to the user's account, and give the phone a signed proof of the check.
- **Finish URIs** use the custom scheme `openpayments-rn-example://`. Use universal links / App Links in production.
