# Mobile clients: consent without the login screen

How can a mobile app use [Open Payments](https://openpayments.dev) so that, when approval is needed, the user lands **straight on the wallet's consent screen** rather than its login screen? And can the [Web Monetization extension](https://github.com/interledger/web-monetization-extension)'s approach to keys and "staying connected" be reused on a phone?

The proof of concept is this repository: [`app/`](../app/) and [`server/`](../server/). See [Running the PoC](#running-the-poc).

## TL;DR

- **Open Payments has no login session.** The client never logs into a wallet. It signs requests with its own key and holds GNAP tokens. "Logging in" happens only on the wallet's **IdP** page: the web page that Rafiki's auth server redirects to during a grant interaction.
- **The login screen appears only when the browser opening `interact.redirect` has no wallet session cookie.** If the user is already logged into the wallet in that browser, the IdP goes straight to the consent screen.
- On mobile, open `interact.redirect` in the **system auth browser**:
    - iOS: `ASWebAuthenticationSession` with `prefersEphemeralWebBrowserSession = false`, which shares Safari's cookies.
    - Android: Chrome Custom Tabs, which share Chrome's cookies.
    - A user logged into the wallet in that browser skips the login.
- **Make consent rare.** Request **one** outgoing-payment grant with spending `limits` (and optionally a repeating `interval`). Store its tokens and rotate the access token silently. Consent is then only needed to connect or change the budget, exactly like the Web Monetization extension.

## Where the login screen actually comes from

```
app ──POST grant request (signed)──▶ auth server        ◀── no user, no cookies
app ◀── interact.redirect, continue{uri, token}, interact.finish (nonce)

browser ──GET /interact/:id/:nonce──▶ auth server  sets cookie `sessionId`
        ◀──302 IdP consent URL?interactId&nonce&clientName&clientUri
browser ──GET consent page──▶ wallet (IdP)
           ├─ wallet session cookie present? ── yes ──▶ consent screen
           └─ no ──▶ login page ──▶ (after login) consent screen
IdP backend ──POST /grant/:id/:nonce/accept (x-idp-secret)──▶ auth server
browser ──GET /interact/:id/:nonce/finish──▶ auth server   checks cookie `sessionId`
        ◀──302 finish.uri?hash=…&interact_ref=…
app ──POST continue.uri {interact_ref} (signed, GNAP continue token)──▶ access_token
```

For the [Interledger Test Wallet](https://wallet.interledger-test.dev), the IdP is the page `/grant-interactions`.
- Its Next.js middleware checks the `testnet.cookie` cookie. If it is missing or invalid, it redirects to `/auth/login?callbackUrl=/grant-interactions?...`, and after login the user returns to the consent screen.
- The cookie is an iron-session cookie: `httpOnly`, `secure`, `SameSite=None`, and it lasts about **one month** (`COOKIE_TTL`).
- Source: [`interledger/testnet`](https://github.com/interledger/testnet), in `packages/wallet/frontend/src/middleware.ts` and `src/pages/grant-interactions/index.tsx`.

So "keeping the user connected" is really two separate things:

| What | Held by | Lifetime | Used for |
|---|---|---|---|
| Wallet login session (cookie) | The **browser** | The wallet decides (test wallet: about 1 month) | Skipping the login page during consent |
| GNAP grant + access token | The **client** (your app or backend) | Grant: until revoked or limits used up. Access token: 10 min, rotatable | Making payments with no UI at all |

## How the Web Monetization extension does it

All paths are in [`interledger/web-monetization-extension`](https://github.com/interledger/web-monetization-extension).

1. **Key generation** (`src/shared/crypto.ts`, `src/background/services/wallet.ts` → `generateKeys()`):
      - It creates one Ed25519 key pair with `@noble/ed25519`.
      - The private key is stored as hex in `browser.storage.local`, alongside `publicKey = btoa(JSON.stringify(jwk))` and `keyId = crypto.randomUUID()`, which is used as the JWK `kid`.
      - The keys **survive disconnecting**.
2. **Key registration on the user's own wallet address.** The extension has no wallet address of its own: its GNAP client identity is the user's wallet address. Before anything works, the user's wallet must list the extension's key in `{walletAddress}/jwks.json`. Two paths:
      - **Manual.** The popup shows the base64 key for the user to paste into the wallet's developer-keys page.
      - **Automatic** (`src/background/services/keyAutoAdd.ts` plus `src/content/keyAutoAdd/*.ts`):
          - It opens the wallet's keys page (for the test wallet, `https://wallet.interledger-test.dev/settings/developer-keys`) in a tab.
          - A content script waits up to 10 min for the user to be logged in. If the cookie is already valid, this step is skipped.
          - The script then calls the wallet's **internal** API from inside the page, so the user's cookie is sent: `POST https://api.wallet.interledger-test.dev/accounts/{acc}/wallet-addresses/{wa}/upload-key {base64Key, nickname}`.
          - Each wallet (GateHub, Fynbos, MMAON) needs its own script.
      - Afterwards it fetches `jwks.json` again to confirm the `kid` is there.
3. **One interactive grant** (`src/background/services/outgoingPaymentGrant.ts`):
      ```ts
      client.grant.request({ url: walletAddress.authServer }, {
        access_token: { access: [
          { type: 'quote', actions: ['create'] },
          { type: 'outgoing-payment', actions: ['create', 'read'], identifier: walletAddress.id,
            limits: { debitAmount, interval: `R/${new Date().toISOString()}/P1M` } }, // interval only if recurring
        ]},
        interact: { start: ['redirect'],
          finish: { method: 'redirect', uri: 'https://webmonetization.org/welcome', nonce } },
      })
      ```
      - The extension opens `interact.redirect` in a **normal browser tab** and watches `tabs.onUpdated` for `interact_ref` and `hash`. It gives up after 3 min, or with `result=grant_rejected`/`grant_invalid`.
      - It verifies the hash and calls `grant.continue`.
4. **Staying connected** (`src/background/services/openPayments.ts`, `outgoingPaymentGrant.ts`):
      - **Stores** `{accessToken: {value, manageUrl}, continue: {accessToken, url}}` in `storage.local`.
      - **Pays** every page directly through the Open Payments API, signing each request with its own key.
      - **Rotates the token** with `client.token.rotate({url: manageUrl, accessToken})` on 401 `Invalid Token` or 403 `Inactive Token`. The call is de-duplicated so concurrent callers share one rotation, and it needs no UI.
      - **Budget renewal** is handled server-side by the recurring `interval`.
      - **Revoked key** (`invalid_client`, or a signature failure): reconnecting tries a rotation first, then re-adds the key automatically.
      - **Disconnecting** calls `grant.cancel` with the continuation token.
5. **Why the user doesn't see a login screen** (twice): the extension holds no wallet session at all. A wallet page opens only to connect, add funds, change the budget, or re-add a key. Those tabs share the browser's cookies, so a user who is already logged in goes straight to the consent screen or the keys page.

**What carries over to mobile:** the grant strategy (one grant with limits, silent rotation), token storage, and the error handling.

**What does not carry over:** the *automatic* key add. Apps cannot inject content scripts into `ASWebAuthenticationSession` or Custom Tabs. See [Model B](#model-b-key-on-the-device-wm-extension-style).

## Rafiki constraints that matter on mobile

Checked against [`interledger/rafiki`](https://github.com/interledger/rafiki) `packages/auth`.

- **Only `redirect` is supported**, for both `interact.start` and `interact.finish.method`.
    - The discovery endpoint confirms it: `curl https://auth.interledger-test.dev/discovery`.
    - There is no `app`, `user_code` or `push`. `push` was proposed in rafiki#2194 and closed as not planned.
- **`finish.uri` can be any URI**: a custom scheme (`myapp://op/finish`) or an https universal link / App Link.
    - Rafiki only validates it against the OpenAPI `format: uri`, and does no allow-listing.
    - A universal link can't be hijacked by another app; a custom scheme can. Either way, the **hash check is your proof** that the redirect is genuine.
- **The cookie at `/finish` must match** (`interaction/routes.ts`):
    - `GET /interact/:id/:nonce` stores the nonce in a `koa-session` cookie (`sessionId`).
    - `GET …/finish` rejects with **401 `invalid session`** if that cookie is missing or holds a different nonce.
    - So the start and the finish must happen **in the same browser cookie jar**, and one jar holds **only one** live interaction at a time.
    - This works with `ASWebAuthenticationSession` and Custom Tabs. It **breaks** if the wallet's consent page hands off to a native wallet app (through a universal link) that then opens `/finish` in a different browser.
- **The IdP only records the decision.** The grant moves to *approved* when the browser actually reaches `/finish`. If the user approves and then closes the sheet before the redirect, the grant is never issued.
- **Timeouts:**
    - Interactions expire after `INTERACTION_EXPIRY_SECONDS` (default 600). Afterwards `/finish` redirects with `result=invalid_interaction`.
    - Access tokens last `ACCESS_TOKEN_EXPIRY_SECONDS` (default 600). They **can still be rotated after expiring** while the grant is live.
- **Outgoing-payment grants always need interaction.** Only `incoming-payment` and `quote` grants can be non-interactive. Nothing reuses a prior grant or skips consent based on limits, so the only way to "not ask again" is a grant with `limits` and an `interval`, kept alive by rotation.
- **The client must have a `publicName`.** For interactive grants, the client's wallet address needs a `publicName`, otherwise you get 400 `missing required request field 'client'`. That name is what the consent screen shows as `clientName`.
- **The finish hash** is computed by `interaction/routes.ts`:
    ```
    hash = base64( sha256( `${clientNonce}\n${interact.finish}\n${interact_ref}\n${grantRequestUrl}` ) )
    ```
    - It is standard base64 with `=` padding, not base64url.
    - Since rafiki PR #3728, `grantRequestUrl` is the wallet address's `authServer` value including the tenant path, with **no** trailing slash (e.g. `https://auth.interledger-test.dev/<tenantId>`). Older deployments used `${authServerUrl}/`.
    - Hash with exactly the `authServer` you POSTed the grant to, then retry with a trailing `/`. The extension does this too.

## Choosing the browser on mobile

| Option | Shares the user's wallet session? | Verdict |
|---|---|---|
| iOS `ASWebAuthenticationSession`, `prefersEphemeralWebBrowserSession = false` | **Yes**, Safari's persistent cookies | ✅ Recommended. iOS shows a one-tap "App wants to use … to sign in" prompt. |
| iOS `ASWebAuthenticationSession`, ephemeral **on** | No, a fresh jar each time | Login **every** time. Use it only to test logout or switch accounts. |
| Android Chrome Custom Tabs (`expo-web-browser`, AppAuth) | **Yes**, Chrome's cookies | ✅ Recommended |
| `SFSafariViewController` | No (isolated since iOS 11) | ❌ |
| Embedded `WKWebView` / Android `WebView` | No — but its **own jar persists across launches** | ⚠️ Login once *inside the app*, then consent opens directly. It is also the only option that lets the app add its key automatically (it can script the logged-in wallet page), which is why the [example app](#the-example-app-connect-send-history) uses it. The downsides: the user can't verify the URL bar, it goes against RFC 8252, and real wallets may block it. The test wallet's `X-Frame-Options: DENY` blocks iframes, not WebViews. |
| Opening the URL in the external browser app | Yes, but the return to the app relies on a link | ⚠️ Works, but is clunkier. Don't let a native wallet app take over halfway (cookie mismatch at `/finish`). |

React Native and Expo: `WebBrowser.openAuthSessionAsync(redirectUrl, 'myapp://op/finish', { preferEphemeralSession: false })` maps to `ASWebAuthenticationSession` on iOS and Custom Tabs on Android, and returns the final URL to the app.

> **The test wallet has no native app.** Today the user's wallet session lives in the browser. If a wallet ships a native app, the better long-term option is for the wallet itself to handle consent: the IdP page becomes a universal link that opens the wallet app. That only works if the wallet app finishes the interaction in the same cookie jar, which Rafiki does not support today (see above).

## Two client models

### Model A: backend as client (recommended)

```
phone app ──▶ your backend (GNAP client: its own wallet address + Ed25519 key)
                 ├── grant request / continue / rotate / pay (signed)
                 └── stores grant + tokens per app user
phone app ──openAuthSession(interact.redirect)──▶ wallet consent (system browser)
          ◀── myapp://op/finish?interact_ref&hash ──▶ forwarded to backend
```

- **The key lives on the server.** Your app has a wallet address (for example, a test wallet account named "My App"). Its `publicName` is what users see on the consent screen.
- **The user only gives their wallet address and approves once.** They never have to register keys.
- The phone holds an opaque `connectionId` (in Keychain/Keystore via `expo-secure-store`), never a payment token.
- This is the standard third-party Open Payments pattern, and every app shares one key and wallet address.
- Cost: you run a backend and must protect it (authenticate your own app users and bind each connection to them).

### Model B: key on the device (WM-extension style)

- The phone generates an Ed25519 key, the same as `@noble/ed25519` in the extension, and uses the **user's own wallet address** as the GNAP client.
- **Key registration** has to happen inside the wallet's own UI or API, because Open Payments has no "register this key" step:
    - With the system auth browser it is **manual**: the app shows or shares the base64 JWK and the user pastes it into the wallet's developer-keys page. Apps can't inject scripts into `ASWebAuthenticationSession` or Custom Tabs.
    - With an **embedded WebView** it can be **automatic**, the way the extension's content script does it: the app injects a script into the logged-in wallet page, which calls the wallet's API using the wallet's own session. This is implemented below in [The example app](#the-example-app-connect-send-history).
    - The real fix would be a wallet-side "register this key" consent flow, which doesn't exist in Open Payments today.
- **Key storage:**
    - iOS: the Secure Enclave only supports P-256, so the Ed25519 key goes in the Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`).
    - Android: the hardware-backed Keystore supports Ed25519 only on recent API levels. Check your minimum SDK, and otherwise encrypt the key with a Keystore AES key.
- **Signing:** the `@interledger/open-payments` SDK depends on Node crypto, so port the extension's `createSignatureHeaders` (the PoC's `app/src/op/signatures.ts` does this and is tested against the reference validator):
    - label `sig1`;
    - components `@method`, `@target-uri` and `authorization`, plus `content-digest`, `content-length` and `content-type` when there is a body;
    - `Content-Digest: sha-512=:…:`.
- **Downsides:** a payment-capable key sits on every phone; a lost phone means revoking the key in the wallet; the consent screen shows the user's *own* name as the client; it gets fiddly across several devices.

### Recommendation

- **For a third-party app** (a shop, a subscription, a game), use **Model A**. It needs no key registration, gives a stable client name on the consent screen, and keeps secrets off devices.
- **For a wallet-like app that acts *as* the user** (sending to contacts from their own wallet address), Model B works for payments. Accept the trade-offs above, plus the WebView caveats.
- **This example combines both.** A small backend (Model A) is the client for the ownership check when connecting, and for the Budget. The phone (Model B) signs every payment, so sending needs no backend. See [The example app](#the-example-app-connect-send-history).

## The example app: connect, send, history

Connect the wallet once, then send money with a normal "checkout" per payment. Every payment is signed on the phone.

```
connect (once) app → backend: POST /ownership-checks {walletAddress}
               backend (signed with ITS key): subject grant — verify wallet address ownership
               WebView: interact.redirect → user signs in to the wallet (once) → wallet confirms
                 └─ /finish 302 → openpayments-rn-example://op/finish?hash&interact_ref → WebView closes
               app → backend: POST /ownership-checks/{id}/finish
                 backend: verify hash → continue grant → subject.sub_ids = the user's address ✓
               app: only now generate the Ed25519 key → Keychain/Keystore
               WebView (already signed in): developer-keys page → injected script → wallet API: upload-key
               app: GET {walletAddress}/jwks.json shows the kid ✓

each payment   contact → amount → Proceed
               app (signed with device key):
                 incoming-payment grant + create   (receiver's auth server, non-interactive)
                 quote grant + create              (sender's auth server, non-interactive)
                 outgoing-payment grant            (interactive, limits = this quote + this receiver)
               WebView: interact.redirect → consent screen directly (still logged in) → Accept
                 └─ /finish 302 → openpayments-rn-example://op/finish?hash&interact_ref → WebView closes
               app: verify hash → continue grant → create outgoing payment
                 → incoming-payment grant [read, complete] (receiver, non-interactive)
                 → poll: GET outgoing payment (failed?) + GET incoming payment
                   until incoming.receivedAmount ≥ quoted receiveAmount
                 → POST {incomingPayment}/complete
               History → detail: GET outgoing payment with that grant (rotate token if expired);
                 completes the incoming payment there too if it's still open
```

**Why the backend runs the ownership check.** We want to verify the address first, before anything touches the wallet. That check is an interactive grant, and every grant request must be signed by a client whose key is already published:
- The phone can't be that client yet. Its client identity would be the user's own wallet address, and that address doesn't list the phone's key until step 3.
- Sending the key inline (`client: { jwk }`, "directed identity") doesn't help: Rafiki refuses it for interactive grants.
- The backend has its own wallet address and a registered key, so it can ask the user's wallet straight away. The grant has a `subject` and no `access_token`, so it gives no payment rights, and the backend cancels it right after.

The ownership check also gives the backend a verified address it could tie to the user's account in a real app.

**Why a WebView here, not the system auth browser:**
- **Login persists inside the app.** WKWebView and Android WebView keep their cookie store across launches. The test wallet's `testnet.cookie` (`Domain=interledger-test.dev; Secure; SameSite=None`, about one month) is set the first time the user logs in inside the app. After that, every consent screen opens without a login.
- **Automatic key registration.** The app injects a script into the logged-in developer-keys page, the way the extension's `src/content/keyAutoAdd/testWallet.ts` does. The script calls the wallet's API, so the user's session authenticates the requests. The API's CORS rules allow the wallet origin with credentials. The calls are:
    - `GET https://api-wallet.interledger-test.dev/accounts?include[]=walletAddresses&include[]=walletAddressKeys`
    - `PATCH …/accounts/{acc}/wallet-addresses/{wa}/{kid}/revoke-key/`, only when the `kid` already sits on another address, since a `kid` must be globally unique
    - `POST …/accounts/{acc}/wallet-addresses/{wa}/upload-key` with `{ base64Key: btoa(JSON.stringify(jwk)), nickname }`
- **Closing on its own.** After Accept, the consent page navigates to `auth…/interact/…/finish`, which 302s to `finish.uri`. The WebView's `onShouldStartLoadWithRequest` intercepts `openpayments-rn-example://op/finish?…`, hands the query to the app and closes. `/interact` and `/finish` run in the same WebView, so Rafiki's session-cookie check passes.

**Things to know:**
- **Complete the incoming payment.** The sender fixes the *debit* amount, so the receiver's incoming payment is created without an `incomingAmount`. The receiving wallet then can't know when the payment is done, and the incoming payment stays open until it expires. Once the outgoing payment has delivered, the client must call [`POST {incomingPayment}/complete`](https://openpayments.dev/sdk/incoming-complete/). That needs the `complete` action on an incoming-payment grant. Those grants are non-interactive, and Rafiki lets the client that created an incoming payment complete it, so the app requests a fresh `[read, complete]` grant at that moment. A 409 "wrong state" means it's already completed.
- **Judge delivery on the receiver's side.** Rafiki reports an outgoing payment's `sentAmount` in the **sender's** asset. Comparing it with `receiveAmount`, which is in the receiver's asset, never matches across currencies (a USD → COP payment would look "processing" forever). Comparing it with `debitAmount` under-reports when the debit includes fees. The reliable signal is the incoming payment's `receivedAmount` reaching the quoted `receiveAmount`. The outgoing payment's `receiver` field gives the incoming payment URL.
- **Per-payment grants are tight.** Each one is limited to this quote's `debitAmount` and this incoming payment (`limits.receiver`), so once the payment is made it can't move any more money. The app keeps it (tokens in the Keychain) only to read that payment's live status on the History detail page: `GET {outgoingPayment}`, with the token rotated through the manage URL when it has expired.
- **Which name the consent screen shows.** For payments it's the user's *own* name ("*{publicName}* is requesting access to *{amount}*"), because the client is the user's wallet address. For the ownership check and the Budget it's the backend's wallet address name, so give that address your app's name. The test wallet shows the amount but not the receiver.
- **Phone-side signing.** The `@interledger/open-payments` SDK needs Node crypto, so the app signs with its own small client (`app/src/op/`), which uses `@noble/ed25519` and `@noble/hashes`. `test/signatures.test.ts` checks its signatures against `@interledger/http-signature-utils`, the same validation Rafiki runs.
- **Where the key lives.** The private key never leaves the device: it's in the Keychain with `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Losing the phone means revoking the key in the wallet's developer keys.
- **The WebView caveats apply.** Users can't see the URL bar, the app could in theory read the wallet page, and RFC 8252 advises against embedded user agents for login. That's fine for a PoC against the test wallet, but expect production wallets to require the system browser.

## Grant strategy for "connect once"

1. **Connect.** One interactive grant:
      - `quote: [create]`;
      - `outgoing-payment: [create, read]` with `identifier` set to the user's wallet address, `limits.debitAmount`, and optionally `interval: R/<now>/P1M`.
2. **Store** `access_token.value`, `access_token.manage`, `continue.uri` and `continue.access_token.value`.
3. **Pay** with no UI:
      1. A non-interactive `incoming-payment` grant on the **receiver's** auth server.
      2. `incomingPayment.create`.
      3. `quote.create` and `outgoingPayment.create` with the stored token.
4. **On 401/403 token errors**, `token.rotate({url: manage, accessToken})` once, persist the new token, and retry.
5. **Budget used up** (403 on create, or `getGrantSpentAmounts` at the limit): ask the user to top up by running a new interactive grant, then `grant.cancel` the old one. They get the consent screen and skip sign-in while their wallet session is still alive (in the example's in-app WebView, about a month).
6. **Disconnect:** `grant.cancel({url: continue.uri, accessToken: continue token})`.

**"Sign in with your wallet address":** a grant with `subject.sub_ids: [{id: walletAddress, format: 'uri'}]` proves the user controls that address. It is always interactive. The test wallet auto-accepts it after 5 s for a logged-in owner. This is the closest Open Payments has to "Sign in with wallet". The example uses it as the first step of Connect (see above).

## Local Rafiki vs the test wallet

| | Local Rafiki playground | Interledger Test Wallet |
|---|---|---|
| IdP / consent | Rafiki's mock ASE at `localhost:3030/mock-idp`: **no login at all**, always shows consent | `wallet.interledger-test.dev/grant-interactions`: **real login**, session cookie |
| Can show "skip the login"? | No (there is no login) | **Yes** |
| Reachable from a phone | Simulator only (`localhost`). Wallet addresses use Docker-internal hostnames, so your backend needs the [virtual-host fetch](../server/src/op/virtual-host-fetch.ts) workaround | Yes, public HTTPS |
| Setup | `pnpm localenv:compose up` ([Rafiki localenv](https://github.com/interledger/rafiki/tree/main/localenv)) | Sign up, create a wallet address, upload a developer key in its UI |

Use local Rafiki to learn the flow, and the test wallet to check the session behaviour.

## Running the PoC

See the [README](../README.md). The app has four tabs:

- **Wallet:** connect once. The backend verifies ownership, then the phone creates its key and adds it to the wallet automatically.
- **Send:** contacts and a per-payment checkout. The phone signs everything and the user approves each payment in the in-app WebView, already signed in.
- **History:** live status of each transfer. The receiver's incoming payment is completed once delivered.
- **Budget** (Model A): the backend holds the grant. The user approves a budget once in the same WebView, then payments need no consent.

It needs a dev build (`npx expo run:ios`) and the backend running (`npm run dev` in `server/`). On web it falls back to a popup and a manual key upload.
