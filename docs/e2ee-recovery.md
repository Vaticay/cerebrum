# E2EE recovery — how it works and what it doesn't promise

> **This integration is not independently audited.** It is real
> encryption (Olm sessions via vendored vodozemac WASM, AES-GCM at rest),
> reviewed in-tree, but no outside cryptographer has signed off on it. Treat
> it accordingly.

## The recovery story

1. When you enable encrypted messaging on a device, the client generates a
   24-word recovery phrase. **Write it down.** It is the only way back.
2. The phrase derives (Argon2id) a key that decrypts your encrypted backup
   (`e2ee_backups`), which holds your Olm identity keys.
3. On a new device, entering the phrase rehydrates the identity: old
   contacts can verify you by the same safety number, and you can read
   history your old device received.

If you lose the phrase AND your devices, the messages are unrecoverable.
That is not a bug — it is what end-to-end encryption means. The server
never holds a copy of the key.

## Nonce discipline

Every message uses a **fresh, unique nonce per encryption** (AES-GCM and the
Olm ratchet both require it). Nonces are drawn from `crypto.getRandomValues`
— never reused, never derived from predictable state. Reusing a nonce under
the same key would catastrophically leak plaintext; the client generates a
new one for every single encryption operation, including message resends
(a resend re-encrypts with a new nonce rather than replaying bytes).

## Revocation is sticky

Revoking a device (`e2ee-revoke-device`, server-confirmed) sets `revoked_at`.
A revoked device cannot come back by re-publishing its keys — the server
keeps the revocation and clients fail closed on `revoked: true`. Revocation
requires explicit confirmation (`confirm: true`); it is irreversible by
design.

## What the server sees

Ciphertext, device ids, and key-directory metadata (which device keys exist,
which are revoked). Never plaintext, never recovery phrases, never private
keys. A database breach exposes who talked to which device ids and when —
not what was said.
