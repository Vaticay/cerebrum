# Vendored vodozemac WASM bridge — review note

**Package:** `@dtelecom/vodozemac-wasm` 0.3.0 (npm, Apache-2.0)
**Vendored:** 2026-09-16 — `lib.rs`, `Cargo.toml`, `LICENSE` copied verbatim
from the published tarball. The prebuilt `pkg-web` WASM binary served at
`public/wasm/vodozemac_bg.wasm` is byte-identical to the tarball's
`pkg-web/dtelecom_vodozemac_wasm_bg.wasm`.
**Upstream:** https://github.com/dTelecom/vodozemac-wasm (builds on the
`vodozemac` 0.10 Rust crate, maintained by Matrix.org, audited by Least
Authority May 2022).

## Why this package instead of a self-built bridge

The E2EE plan recommended owning the wasm-bindgen bridge. This environment
has no Rust toolchain, so the pragmatic equivalent: use the thinnest
community bridge over the audited crate, and vendor its full Rust source
in-repo so the FFI boundary is reviewable and the build is reproducible
later (`npm run build:web` in the tarball, once a toolchain exists).

## Focused dependency review (2026-09-16)

1. **Randomness** — `Cargo.toml` sets `getrandom 0.2` with the `js` feature:
   all RNG routes through the Web Crypto API in browser builds. No
   `Math.random` anywhere in the path. ✓
2. **FFI boundary** — public keys cross as base64 strings; one-time keys and
   identity keys cross as JSON. Private key material crosses the boundary in
   exactly one place: `Account.pickle()` / `Session.pickle()`. Those pickles
   are **not** passphrase-encrypted (verified: `pickle()` serializes the raw
   vodozemac pickle struct, private bytes in the clear). Mitigation is in our
   code, not the bridge: `src/e2ee/store.js` AES-GCM-encrypts every pickle
   before IndexedDB, and `src/e2ee/recovery.js` encrypts the server backup
   bundle with an Argon2id key from the recovery phrase. `crypto.js`
   documents the plaintext-pickle hazard at each call site.
3. **Error paths** — all fallible calls map through `js_err`, which renders
   vodozemac's `Display` errors into JS strings. Those error types are static
   enum variants (bad key length, decryption failure, unknown message type);
   they do not embed key bytes. `from_base64` failures can echo the *input*,
   which is always public key material or ciphertext, never private keys.
4. **Zeroization** — secrets live in vodozemac's zeroizing types; `free()`
   drops the Rust struct and runs its `Zeroize` impl. JS-side we never hold
   private bytes in variables longer than a single encrypt/decrypt call.
5. **Inbound sessions** — `createInboundSession` extracts the sender identity
   key from the prekey message itself (libolm-compatible). We do NOT trust it
   blindly: the messaging layer (server turn) verifies it against the device
   list the server published for that user, and surfaces new-device warnings.
6. **Scope** — bridge exposes Olm only (account, one-time keys, fallback
   key, sessions, sign). No Megolm in this build; group DMs (Phase 2) will
   need a bridge bump.

## Reproducibility

To rebuild from source later (needs Rust + wasm-pack + wasm32 target):

```
npm run build:web   # from the tarball root; emits pkg-web/
```

Then replace `public/wasm/vodozemac_bg.wasm` with the fresh
`pkg-web/dtelecom_vodozemac_wasm_bg.wasm` and pin the new version here.
