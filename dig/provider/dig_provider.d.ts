// Type declarations for the DIG Browser injected `window.chia` provider.
//
// The provider (dig/provider/dig_provider.js) is BUNDLED from the shared package
// @dignetwork/chia-provider (buildProvider) wrapped with the browser's native
// window.__digWalletRpc transport, so the DIG Browser and the dig-chrome-extension
// expose the IDENTICAL window.chia surface — one contract, two consumers. This
// `.d.ts` is the committed, machine-readable contract for what an agent or dapp
// drives in the native DIG Browser: identity, the method catalogue, the request
// surface, the Goby-legacy direct methods, the events, and the stable thrown-error
// codes — so a consumer can introspect capabilities and branch on failures WITHOUT
// reading the source. It mirrors @dignetwork/chia-provider's exported ChiaProvider
// type (the canonical source of truth); the browser-edition `info` reports
// transport:"native" / edition:"browser" / scheme:"chia".

/** CHIP-0002 core methods (asset-generic; any CAT by assetId). */
export type Chip0002Method =
  | "chip0002_chainId"
  | "chip0002_connect"
  | "chip0002_getPublicKeys"
  | "chip0002_filterUnlockedCoins"
  | "chip0002_signMessage"
  | "chip0002_signCoinSpends"
  | "chip0002_getAssetBalance"
  | "chip0002_getAssetCoins";

/** chia_* methods (addresses, sends, NFTs, DIDs, offers). */
export type ChiaMethod =
  | "chia_getAddress"
  | "chia_signMessageByAddress"
  | "chia_send"
  | "chia_getTransactions"
  | "chia_getNfts"
  | "chia_transferNft"
  | "chia_mintNft"
  | "chia_bulkMintNfts"
  | "chia_getDids"
  | "chia_createDidWallet"
  | "chia_transferDid"
  | "chia_getOfferSummary"
  | "chia_createOffer"
  | "chia_takeOffer"
  | "chia_cancelOffer";

/**
 * The full supported (namespaced) method surface. `chip0002_getMethods` is the
 * introspection RPC (answered locally, returns the catalogue as `string[]`);
 * `connect` is the bare alias of `chip0002_connect`. Bare Goby/Sage names (e.g.
 * `"getPublicKeys"`, `"transfer"`) are also accepted and routed via the alias
 * table (`transfer` → `chia_send`) or namespaced to `chip0002_*`.
 */
export type WalletMethod = Chip0002Method | ChiaMethod;

/**
 * Stable, documented thrown-error codes (EIP-1193 / CHIP-0002 aligned). These are
 * the shared @dignetwork/chia-provider codes — identical across the browser and
 * the extension.
 */
export interface DigProviderErrorCodes {
  /** 4001 — the user rejected the request / a connect is still pending approval. */
  USER_REJECTED: 4001;
  /** 4100 — origin not approved, or the wallet can't sign (watch-only/expired). */
  UNAUTHORIZED: 4100;
  /** 4200 — the wallet does not support the requested method (or chain). */
  UNSUPPORTED_METHOD: 4200;
  /** 4900 — the wallet bridge is disconnected / unreachable / malformed. */
  DISCONNECTED: 4900;
}

/** The numeric error code carried on a thrown {@link DigProviderError}. */
export type DigProviderErrorCode = 4001 | 4100 | 4200 | 4900;

/** Error thrown by `request()`/`connect()`/direct methods. `code` is stable; branch on it. */
export interface DigProviderError extends Error {
  /** Stable machine code from {@link DigProviderErrorCodes}. */
  code: DigProviderErrorCode;
  /** True when a connect is pending the user's per-origin approval (code 4001). */
  pending?: boolean;
  /** The raw wallet transport status (HTTP-like), when one was returned. */
  status?: number;
}

/** Provider identity, machine-readable. */
export interface DigProviderInfo {
  /** Always true for a DIG-supplied provider. */
  isDIG: true;
  /** How wallet calls are brokered: `"native"` in DIG Browser (in-process Mojo). */
  transport: "native";
  /** Which DIG surface injected this provider. */
  edition: "browser";
  /** The user-facing scheme the browser registers (SYSTEM.md canonical). */
  scheme: "chia";
  /** The shared provider-contract version. */
  providerVersion: number;
  /** The DIG Browser build version. */
  version: string;
}

/** Arguments to `window.chia.request`. */
export interface DigRequestArgs {
  /** A {@link WalletMethod}, a bare Goby/Sage name, `connect`, or `getMethods`. */
  method: WalletMethod | "connect" | "chip0002_getMethods" | "getMethods" | string;
  /** Method params (CHIP-0002 / chia_* / Goby shapes). */
  params?: unknown;
}

/**
 * The injected `window.chia` provider — a SUPERSET compatible with CHIP-0002, the
 * Goby provider conventions, and Sage's WalletConnect2 method names. A Goby dApp
 * feature-detects `isGoby`; a CHIP-0002 dApp uses `request({method, params})`; a
 * Goby-legacy dApp calls the direct methods on the object.
 */
export interface DigChiaProvider {
  /** Always true — distinguishes this from other injected providers. */
  readonly isDIG: true;
  /** Goby feature-detection flag — Goby dApps treat this provider as Goby-compatible. */
  readonly isGoby: true;
  /** The wallet display name (`"DIG"`). */
  readonly name: string;
  /** The DIG Browser build version (e.g. "149.0.7827.155"). */
  readonly version: string;
  /** The provider-contract API version (e.g. "1.0.0"). */
  readonly apiVersion: string;
  /** Machine-readable provider identity. */
  readonly info: DigProviderInfo;
  /** The supported method catalogue (also via `request({method:"chip0002_getMethods"})`). */
  readonly methods: WalletMethod[];
  /** The stable thrown-error code enum. */
  readonly errorCodes: DigProviderErrorCodes;
  /** The current chain id — `undefined` until connected, then `"mainnet"`. */
  readonly chainId?: string;
  /** The cached primary receive address (set by requestAccounts/accounts), else undefined. */
  readonly selectedAddress?: string;
  /** True once the active origin has been approved — a CALLABLE (Goby convention). */
  isConnected(): boolean;

  /**
   * CHIP-0002 entrypoint. Accepts bare, `chip0002_*`, `chia_*`, and Goby/Sage
   * alias names. Resolves with the wallet's result, or rejects with a
   * {@link DigProviderError}. `request({method:"chip0002_getMethods"})` resolves
   * with the method list locally without touching the wallet bridge.
   */
  request<T = unknown>(args: DigRequestArgs): Promise<T>;

  /**
   * Request per-origin approval. Resolves once the user approves (or with an eager
   * session); polls through pending approval; rejects with a {@link DigProviderError}
   * on reject/timeout.
   */
  connect(eager?: boolean): Promise<unknown>;
  /** Switch chain. `"mainnet"` (or absent) resolves; any other chain rejects 4200. */
  walletSwitchChain(params: { chainId: string }): Promise<null>;
  walletWatchAsset(params: unknown): Promise<unknown>;
  getPublicKeys(params?: unknown): Promise<unknown>;
  filterUnlockedCoins(params: unknown): Promise<unknown>;
  getAssetCoins(params: unknown): Promise<unknown>;
  getAssetBalance(params: unknown): Promise<unknown>;
  signCoinSpends(params: unknown): Promise<unknown>;
  signMessage(params: unknown): Promise<unknown>;
  signMessageByAddress(params: unknown): Promise<unknown>;
  /** Goby `transfer` — routed to `chia_send` with `{to}`→`{address}` remap. */
  transfer(params: { to?: string; address?: string; amount: number | string; assetId?: string; memos?: string[]; fee?: number | string }): Promise<unknown>;
  sendTransaction(params: unknown): Promise<unknown>;
  createOffer(params: unknown): Promise<unknown>;
  takeOffer(params: unknown): Promise<unknown>;
  cancelOffer(params: unknown): Promise<unknown>;
  getNFTs(params?: unknown): Promise<unknown>;
  getNFTInfo(params: unknown): Promise<unknown>;
  /** Prompt for approval (if needed), then resolve the address list; caches selectedAddress. */
  requestAccounts(): Promise<string[]>;
  /** Resolve the address list without prompting; rejects 4900 if not connected. */
  accounts(): Promise<string[]>;

  /** Subscribe to a provider event (`"connect"` | `"chainChanged"` | `"accountChanged"`). */
  on(event: string, handler: (data: unknown) => void): void;
  /** Unsubscribe a previously-registered handler. */
  off(event: string, handler: (data: unknown) => void): void;
  /** Alias of {@link off}. */
  removeListener(event: string, handler: (data: unknown) => void): void;
}

declare global {
  interface Window {
    /** Present in the DIG Browser (and the DIG extension); CHIP-0002 wallet. */
    chia?: DigChiaProvider;
  }
  /** Dispatched on `window` once `window.chia` is installed. */
  interface WindowEventMap {
    "chia#initialized": Event;
  }
}

export {};
