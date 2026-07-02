// Generated from dig_provider.entry.mjs by build-provider.mjs. Do not edit.
// window.chia is derived from @dignetwork/chia-provider (buildProvider) so the
// DIG Browser and the dig-chrome-extension expose the identical provider surface.
// Regenerate: cd dig/provider && npm install && npm run build
(() => {
  // node_modules/@dignetwork/chia-provider/src/methods.mjs
  var CHIP0002_METHODS = [
    "chip0002_chainId",
    "chip0002_connect",
    "chip0002_getPublicKeys",
    "chip0002_filterUnlockedCoins",
    "chip0002_signMessage",
    "chip0002_signCoinSpends",
    "chip0002_getAssetBalance",
    "chip0002_getAssetCoins"
  ];
  var CHIA_METHODS = [
    "chia_getAddress",
    "chia_signMessageByAddress",
    "chia_send",
    "chia_getTransactions",
    "chia_getNfts",
    "chia_transferNft",
    "chia_mintNft",
    "chia_bulkMintNfts",
    "chia_getDids",
    "chia_createDidWallet",
    "chia_transferDid",
    "chia_getOfferSummary",
    "chia_createOffer",
    "chia_takeOffer",
    "chia_cancelOffer"
  ];
  var WALLET_METHODS = [...CHIP0002_METHODS, ...CHIA_METHODS];
  var GOBY_ALIASES = Object.freeze({
    // CHIP-0002 core (read + sign) → chip0002_
    chainId: "chip0002_chainId",
    getPublicKeys: "chip0002_getPublicKeys",
    filterUnlockedCoins: "chip0002_filterUnlockedCoins",
    getAssetBalance: "chip0002_getAssetBalance",
    getAssetCoins: "chip0002_getAssetCoins",
    signMessage: "chip0002_signMessage",
    signCoinSpends: "chip0002_signCoinSpends",
    // Goby extensions + Sage WC2 → chia_
    transfer: "chia_send",
    send: "chia_send",
    getAddress: "chia_getAddress",
    signMessageByAddress: "chia_signMessageByAddress",
    getTransactions: "chia_getTransactions",
    getNFTs: "chia_getNfts",
    getNfts: "chia_getNfts",
    transferNft: "chia_transferNft",
    mintNft: "chia_mintNft",
    bulkMintNfts: "chia_bulkMintNfts",
    getDids: "chia_getDids",
    createDid: "chia_createDidWallet",
    createDidWallet: "chia_createDidWallet",
    transferDid: "chia_transferDid",
    getOfferSummary: "chia_getOfferSummary",
    createOffer: "chia_createOffer",
    takeOffer: "chia_takeOffer",
    cancelOffer: "chia_cancelOffer",
    getNFTInfo: "chia_getNftInfo",
    getNftInfo: "chia_getNftInfo",
    walletWatchAsset: "chia_walletWatchAsset",
    sendTransaction: "chia_sendTransaction"
  });
  function normalizeMethod(method) {
    if (!method) return method;
    if (/^(chip0002_|chia_)/.test(method)) return method;
    if (GOBY_ALIASES[method]) return GOBY_ALIASES[method];
    return "chip0002_" + method;
  }
  function remapGobyParams(method, params) {
    if (!params) return params;
    if ((method === "transfer" || method === "send") && params.to != null && params.address == null) {
      const { to, ...rest } = params;
      return { ...rest, address: to };
    }
    return params;
  }

  // node_modules/@dignetwork/chia-provider/src/provider.mjs
  var WALLET_PROVIDER_VERSION = 1;
  var WALLET_PROVIDER_NAME = "DIG";
  var WALLET_API_VERSION = "1.0.0";
  var WALLET_CHAIN_ID = "mainnet";
  var PROVIDER_INFO = Object.freeze({
    isDIG: true,
    /** 'walletconnect' (extension brokers to Sage) — the native browser reports 'in-process'. */
    transport: "walletconnect",
    /** 'extension' here; the native fork reports 'browser'. */
    edition: "extension",
    providerVersion: WALLET_PROVIDER_VERSION
  });
  var PROVIDER_ERROR_CODES = Object.freeze({
    /** 4001 — the user rejected the request (or a connect is still pending approval). */
    USER_REJECTED: 4001,
    /** 4100 — the origin/account is not authorized (call connect() first). */
    UNAUTHORIZED: 4100,
    /** 4200 — the wallet does not support the requested method. */
    UNSUPPORTED_METHOD: 4200,
    /** 4900 — the wallet is disconnected / unreachable (no Sage session, relay down). */
    DISCONNECTED: 4900
  });
  function mapEnvelopeToError(env) {
    if (!env) {
      const e2 = new Error("DIG wallet is not reachable");
      e2.code = PROVIDER_ERROR_CODES.DISCONNECTED;
      return e2;
    }
    const status = env.status || 0;
    const body = env.body || {};
    const msg = body && body.error || env.error || "DIG wallet error " + status;
    if (status === 202) {
      const e2 = new Error("Connection pending approval");
      e2.code = PROVIDER_ERROR_CODES.USER_REJECTED;
      e2.pending = true;
      e2.status = status;
      return e2;
    }
    let code;
    if (status === 401 || status === 403) code = PROVIDER_ERROR_CODES.UNAUTHORIZED;
    else if (status === 404) code = PROVIDER_ERROR_CODES.UNSUPPORTED_METHOD;
    else if (status >= 500 || status === 0) code = PROVIDER_ERROR_CODES.DISCONNECTED;
    else code = PROVIDER_ERROR_CODES.USER_REJECTED;
    const e = new Error(msg);
    e.code = code;
    e.status = status;
    return e;
  }
  function buildProvider({ bridgeCall, version, emit } = {}) {
    const listeners = {};
    const fire = emit || ((ev, data) => {
      (listeners[ev] || []).slice().forEach((fn) => {
        try {
          fn(data);
        } catch {
        }
      });
    });
    let _connected = false;
    let _chainId;
    let _selectedAddress;
    async function rpc(method, params) {
      const env = await bridgeCall(method, params);
      const status = env && env.status || 0;
      if (!env || status < 200 || status >= 300 || status === 202) {
        throw mapEnvelopeToError(env);
      }
      return (env.body || {}).data;
    }
    async function connect(eager) {
      const deadline = Date.now() + 12e4;
      for (; ; ) {
        try {
          const r = await rpc("chip0002_connect", { eager: !!eager });
          _connected = true;
          _chainId = WALLET_CHAIN_ID;
          fire("connect", r);
          return r;
        } catch (e) {
          if (e && e.pending && Date.now() < deadline) {
            await new Promise((res) => setTimeout(res, 1200));
            continue;
          }
          throw e;
        }
      }
    }
    function callGoby(dappMethod, params) {
      return rpc(normalizeMethod(dappMethod), remapGobyParams(dappMethod, params));
    }
    async function fetchAddress() {
      const r = await rpc("chia_getAddress", {});
      const addr = typeof r === "string" ? r : r && r.address;
      if (addr) _selectedAddress = addr;
      return addr ? [addr] : [];
    }
    async function requestAccounts() {
      await connect(false);
      return fetchAddress();
    }
    function accounts() {
      if (!_connected) {
        const e = new Error("DIG wallet is not connected \u2014 call connect() first");
        e.code = PROVIDER_ERROR_CODES.DISCONNECTED;
        return Promise.reject(e);
      }
      return fetchAddress();
    }
    function walletSwitchChain(params) {
      const target = params && params.chainId;
      if (target === WALLET_CHAIN_ID || target == null) return Promise.resolve(null);
      const e = new Error("DIG wallet supports only Chia mainnet");
      e.code = PROVIDER_ERROR_CODES.UNSUPPORTED_METHOD;
      return Promise.reject(e);
    }
    const provider = {
      isDIG: true,
      // Goby identity flags — a Goby/Sage dApp feature-detects these (see loroco parity).
      isGoby: true,
      name: WALLET_PROVIDER_NAME,
      apiVersion: WALLET_API_VERSION,
      version: version || "unknown",
      info: PROVIDER_INFO,
      /** The Sage-parity method catalogue an agent can introspect without out-of-band knowledge. */
      methods: WALLET_METHODS,
      /** Stable thrown-error code enum (documented in the README provider section). */
      errorCodes: PROVIDER_ERROR_CODES,
      get chainId() {
        return _chainId;
      },
      get selectedAddress() {
        return _selectedAddress;
      },
      isConnected() {
        return _connected;
      },
      request(args) {
        const method = args && args.method;
        const params = args && args.params;
        if (method === "chip0002_getMethods" || method === "chia_getMethods" || method === "getMethods") {
          return Promise.resolve(WALLET_METHODS);
        }
        if (method === "connect" || method === "chip0002_connect") {
          return connect(params && params.eager);
        }
        if (method === "requestAccounts") return requestAccounts();
        if (method === "accounts") return accounts();
        if (method === "walletSwitchChain") return walletSwitchChain(params);
        return callGoby(method, params);
      },
      // Goby-legacy DIRECT methods. dApps built against Goby's pre-CHIP-0002 surface
      // (dexie.space, tibetswap, …) call these on the object instead of via request().
      connect,
      walletSwitchChain,
      walletWatchAsset(params) {
        return callGoby("walletWatchAsset", params);
      },
      getPublicKeys(params) {
        return callGoby("getPublicKeys", params);
      },
      filterUnlockedCoins(params) {
        return callGoby("filterUnlockedCoins", params);
      },
      getAssetCoins(params) {
        return callGoby("getAssetCoins", params);
      },
      getAssetBalance(params) {
        return callGoby("getAssetBalance", params);
      },
      signCoinSpends(params) {
        return callGoby("signCoinSpends", params);
      },
      signMessage(params) {
        return callGoby("signMessage", params);
      },
      signMessageByAddress(params) {
        return callGoby("signMessageByAddress", params);
      },
      transfer(params) {
        return callGoby("transfer", params);
      },
      sendTransaction(params) {
        return callGoby("sendTransaction", params);
      },
      createOffer(params) {
        return callGoby("createOffer", params);
      },
      takeOffer(params) {
        return callGoby("takeOffer", params);
      },
      cancelOffer(params) {
        return callGoby("cancelOffer", params);
      },
      getNFTs(params) {
        return callGoby("getNFTs", params);
      },
      getNFTInfo(params) {
        return callGoby("getNFTInfo", params);
      },
      requestAccounts,
      accounts,
      on(ev, fn) {
        (listeners[ev] = listeners[ev] || []).push(fn);
      },
      off(ev, fn) {
        listeners[ev] = (listeners[ev] || []).filter((x) => x !== fn);
      },
      removeListener(ev, fn) {
        listeners[ev] = (listeners[ev] || []).filter((x) => x !== fn);
      }
    };
    return provider;
  }

  // dig_provider.entry.mjs
  (function() {
    if (window.chia) return;
    var PROVIDER_VERSION = "{{VERSION}}";
    if (PROVIDER_VERSION === "{{VERSION}}") PROVIDER_VERSION = "0.0.0-dev";
    function bridgeCall(method, params) {
      return new Promise(function(resolve) {
        var b = window.__digWalletRpc;
        if (!b || typeof b.request !== "function") {
          resolve(null);
          return;
        }
        var reqJson = JSON.stringify({ method, params: params || {} });
        try {
          b.request(reqJson, function(resp) {
            if (!resp) {
              resolve(null);
              return;
            }
            var env;
            try {
              env = JSON.parse(resp);
            } catch (_) {
              env = null;
            }
            if (!env) {
              resolve(null);
              return;
            }
            resolve({ status: env.status, body: env.body });
          });
        } catch (e) {
          resolve(null);
        }
      });
    }
    var provider = buildProvider({ bridgeCall, version: PROVIDER_VERSION });
    provider.info = {
      isDIG: true,
      transport: "native",
      edition: "browser",
      scheme: "chia",
      providerVersion: provider.info.providerVersion,
      version: PROVIDER_VERSION
    };
    window.chia = provider;
    window.dispatchEvent(new Event("chia#initialized"));
  })();
})();
