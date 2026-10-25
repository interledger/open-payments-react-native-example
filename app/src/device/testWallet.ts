/**
 * Interledger Test Wallet integration for automatic key registration — the
 * mobile equivalent of the Web Monetization extension's content script
 * (src/content/keyAutoAdd/testWallet.ts). The app loads the wallet's
 * developer-keys page in its WebView; once the user is logged in there, this
 * script runs *inside the wallet page*, so the wallet's own session cookie
 * authenticates the calls to its API (CORS allows the wallet origin with
 * credentials). The app never sees the password or the cookie.
 *
 *   GET  {api}/accounts?include[]=walletAddresses&include[]=walletAddressKeys
 *   PATCH {api}/accounts/{acc}/wallet-addresses/{wa}/{keyId}/revoke-key/   (if the kid sits elsewhere)
 *   POST {api}/accounts/{acc}/wallet-addresses/{wa}/upload-key  {base64Key, nickname}
 */

export const TEST_WALLET_ORIGIN = 'https://wallet.interledger-test.dev'
export const DEVELOPER_KEYS_URL = `${TEST_WALLET_ORIGIN}/settings/developer-keys`

export function isTestWalletAddress(walletAddress: string): boolean {
  return /^https:\/\/ilp\.interledger-test\.dev\//.test(walletAddress)
}

export type KeyUploadMessage =
  | { type: 'key-upload'; ok: true; alreadyPresent: boolean }
  | { type: 'key-upload'; ok: false; error: string }
  | { type: 'key-upload-waiting-for-login' }

/**
 * Injected into every page the WebView loads. It waits (polling, because the
 * wallet's login → callback is a client-side Next.js navigation) until the
 * user is on the developer-keys page — i.e. logged in — then registers the key.
 * Idempotent: if the key is already on the address it just reports success.
 */
export function buildKeyUploadScript(input: {
  walletAddressUrl: string
  keyId: string
  base64Key: string
  nickname: string
}): string {
  const config = JSON.stringify(input)
  return `
(function () {
  if (window.__rafikiKeyUpload) return;
  window.__rafikiKeyUpload = true;
  var cfg = ${config};
  function post(msg) { window.ReactNativeWebView.postMessage(JSON.stringify(msg)); }
  function normalize(url) { return (url || '').replace(/^\\$/, 'https://').replace(/\\/+$/, ''); }
  async function run() {
    var api = 'https://api-' + location.host;
    var res = await fetch(api + '/accounts?include[]=walletAddresses&include[]=walletAddressKeys', { credentials: 'include', headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error('Listing accounts failed (' + res.status + ')');
    var accounts = (await res.json()).result || [];
    var target = null, elsewhere = [];
    accounts.forEach(function (acc) {
      (acc.walletAddresses || []).forEach(function (wa) {
        var hasKey = (wa.keys || []).some(function (k) { return k.id === cfg.keyId; });
        if (normalize(wa.url) === normalize(cfg.walletAddressUrl)) target = { acc: acc.id, wa: wa.id, hasKey: hasKey };
        else if (hasKey) elsewhere.push({ acc: acc.id, wa: wa.id });
      });
    });
    if (!target) throw new Error('This wallet login does not own ' + cfg.walletAddressUrl);
    if (target.hasKey) return post({ type: 'key-upload', ok: true, alreadyPresent: true });
    for (var i = 0; i < elsewhere.length; i++) {
      var e = elsewhere[i];
      await fetch(api + '/accounts/' + e.acc + '/wallet-addresses/' + e.wa + '/' + cfg.keyId + '/revoke-key/', { method: 'PATCH', credentials: 'include', headers: { accept: 'application/json', 'content-type': 'application/json' } });
    }
    var up = await fetch(api + '/accounts/' + target.acc + '/wallet-addresses/' + target.wa + '/upload-key', {
      method: 'POST', credentials: 'include',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ base64Key: cfg.base64Key, nickname: cfg.nickname })
    });
    if (!up.ok) { var body = await up.json().catch(function () { return {}; }); throw new Error(body.message || ('Upload failed (' + up.status + ')')); }
    post({ type: 'key-upload', ok: true, alreadyPresent: false });
  }
  var announced = false;
  var timer = setInterval(function () {
    if (location.pathname.indexOf('/settings/developer-keys') !== 0) {
      if (!announced) { announced = true; post({ type: 'key-upload-waiting-for-login' }); }
      return;
    }
    clearInterval(timer);
    run().catch(function (err) { post({ type: 'key-upload', ok: false, error: String(err && err.message || err) }); });
  }, 500);
})();
true;`
}
