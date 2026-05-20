# Implementation Plan: Security Upgrade (Phase 8)

## Overview

本实现计划将 Arthas 加密聊天系统的安全升级分解为可增量执行的编码任务。包含两项核心增强：加密 Typing 状态（AES-256-GCM）和 Ed25519 消息签名。实现覆盖 Web 客户端（TypeScript）和 CLI 客户端（Go），保持跨客户端互操作性，零服务器变更。

## Tasks

- [x] 1. Implement Canonical JSON serialization (both clients)
  - [x] 1.1 Create `src/crypto/canonicalJson.ts` with recursive canonical JSON serialization
    - Implement `canonicalJsonStringify` function with recursive key sorting at every nesting level
    - Implement `computeSignableBytes` function that removes `sig` field and returns UTF-8 bytes
    - Include file-level comment explaining role in cross-client interoperability
    - Add `📚 学习要点` comment explaining why `JSON.stringify` array replacer cannot be used (nested field loss)
    - Hardcode Test Vectors 1-3 from design document for validation
    - _Requirements: 4.2, 7.4_

  - [x] 1.2 Create `internal/crypto/canonical.go` with recursive canonical JSON serialization
    - Implement `CanonicalJSON` function using `map[string]interface{}` with sorted keys (recursive)
    - Implement `ComputeSignableBytes` function that removes `sig` key and returns UTF-8 bytes
    - Add GoDoc comments explaining why `json.Marshal` cannot be used (struct field order ≠ alphabetical)
    - Hardcode same Test Vectors for cross-client validation
    - _Requirements: 4.2, 7.4_

  - [x] 1.3 Write property tests for canonical JSON (Web)
    - **Property 4: Canonical JSON determinism with recursive sorted keys**
    - **Validates: Requirements 4.2, 7.4**
    - Create `src/crypto/canonicalJson.property.test.ts` using fast-check
    - Generate arbitrary payload objects with nested `reply` fields, verify determinism and key ordering

  - [x] 1.4 Write property tests for canonical JSON (CLI)
    - **Property 4: Canonical JSON determinism with recursive sorted keys**
    - **Validates: Requirements 4.2, 7.4**
    - Create `internal/crypto/canonical_property_test.go` using pgregory.net/rapid
    - Generate arbitrary payload maps, verify determinism and key ordering

  - [x] 1.5 Write unit tests for canonical JSON with Test Vectors (Web)
    - Create `src/crypto/canonicalJson.test.ts`
    - Test all 3 Test Vectors from design (exact hex comparison)
    - Test edge cases: empty object, nested arrays, unicode strings
    - **Property 9: Cross-client canonical JSON byte equivalence (via shared vectors)**
    - **Validates: Requirements 7.4, 7.5**

  - [x] 1.6 Write unit tests for canonical JSON with Test Vectors (CLI)
    - Create `internal/crypto/canonical_test.go`
    - Test all 3 Test Vectors from design (exact hex comparison)
    - Test edge cases: empty map, nested structures, unicode strings
    - **Property 9: Cross-client canonical JSON byte equivalence (via shared vectors)**
    - **Validates: Requirements 7.4, 7.5**

- [x] 2. Implement Ed25519 signing module (both clients)
  - [x] 2.1 Create `src/crypto/signing.ts` with Ed25519 key generation, signing, and verification
    - Implement `generateSigningKeyPair` with Ed25519 feature detection (returns null if unsupported)
    - Implement `isEd25519Supported` helper using try/catch on `crypto.subtle.generateKey`
    - Implement `signPayload` (returns base64url 64-byte signature)
    - Implement `verifySignature` (accepts cached CryptoKey)
    - Implement `importVerifyKey` (raw bytes → CryptoKey for verification)
    - Implement `encodePublicKey` / `decodePublicKey` (base64url ↔ Uint8Array)
    - Add `📚 学习要点` comment on Ed25519 vs ECDSA choice and browser compatibility
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 4.1, 5.1_

  - [x] 2.2 Create `internal/crypto/signing.go` with Ed25519 key generation, signing, and verification
    - Implement `SigningKeyPair` struct with `GenerateSigningKeyPair`, `Sign`, `ZeroKeyPair` methods
    - Implement `VerifySignature` package-level function
    - Use `crypto/ed25519` standard library
    - Add `📚 学习要点` comment on memory zeroing best-effort in Go (GC limitations)
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.7, 4.1, 5.1_

  - [x] 2.3 Write property tests for Ed25519 signing (Web)
    - **Property 3: Ed25519 keypair validity and sign/verify round-trip**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.1, 5.1**
    - Create `src/crypto/signing.property.test.ts` using fast-check
    - Generate arbitrary byte sequences, verify sign→verify round-trip always succeeds
    - Verify key sizes (32-byte public key, 32-byte seed)

  - [x] 2.4 Write property tests for tamper detection (Web)
    - **Property 5: Tamper detection — modifying any field invalidates signature**
    - **Validates: Requirements 4.6**
    - In `src/crypto/signing.property.test.ts`, add test that mutates payload fields post-signing
    - Verify that verification always fails after any modification

  - [x] 2.5 Write property tests for Ed25519 signing (CLI)
    - **Property 3: Ed25519 keypair validity and sign/verify round-trip**
    - **Validates: Requirements 2.1, 2.2, 2.4, 2.5, 4.1, 5.1**
    - Create `internal/crypto/signing_property_test.go` using pgregory.net/rapid
    - Generate arbitrary byte slices, verify sign→verify round-trip

  - [x] 2.6 Write property tests for tamper detection (CLI)
    - **Property 5: Tamper detection — modifying any field invalidates signature**
    - **Validates: Requirements 4.6**
    - In `internal/crypto/signing_property_test.go`, add test that mutates payload after signing

  - [x] 2.7 Write unit tests for Ed25519 with Appendix A Test Vector (Web)
    - Create `src/crypto/signing.test.ts`
    - Test fixed seed → fixed public key derivation
    - Test fixed signable bytes → fixed signature
    - Test verify with correct key → true, modified bytes → false
    - _Requirements: 2.1, 2.4, 2.5_

  - [x] 2.8 Write unit tests for Ed25519 with Appendix A Test Vector (CLI)
    - Create `internal/crypto/signing_test.go`
    - Test fixed seed → fixed public key derivation
    - Test fixed signable bytes → fixed signature
    - Test verify with correct key → true, modified bytes → false
    - _Requirements: 2.2, 2.4, 2.5_

- [x] 3. Implement Typing encryption module (Web client)
  - [x] 3.1 Create `src/crypto/typingEncrypt.ts` with AES-256-GCM typing encryption/decryption
    - Implement `encryptTypingStatus(roomKey, typing)` → `{iv, ciphertext}` (base64url)
    - Implement `decryptTypingStatus(roomKey, iv, ciphertext)` → boolean
    - Reuse existing `toBase64Url`/`fromBase64Url` from `src/crypto/utils.ts`
    - Generate unique 96-bit random IV per encryption call
    - Add `📚 学习要点` comment on why typing metadata leaks are a privacy concern
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 3.2 Write property tests for typing encryption (Web)
    - **Property 1: Typing encryption round-trip**
    - **Validates: Requirements 1.1, 1.5**
    - Create `src/crypto/typingEncrypt.property.test.ts` using fast-check
    - Generate arbitrary AES-256 keys and boolean values, verify encrypt→decrypt round-trip

  - [x] 3.3 Write property tests for IV uniqueness (Web)
    - **Property 2: IV uniqueness and correct length**
    - **Validates: Requirements 1.3**
    - In `src/crypto/typingEncrypt.property.test.ts`, verify each IV is 12 bytes and all IVs in a batch are distinct

  - [x] 3.4 Write unit tests for typing encryption (Web)
    - Create `src/crypto/typingEncrypt.test.ts`
    - Test encrypt/decrypt with `true` and `false` values
    - Test that different encryptions of same value produce different ciphertexts (IV randomness)
    - _Requirements: 1.1, 1.2, 1.5_

- [x] 4. Checkpoint — Verify all crypto module tests pass
  - Run Web crypto tests: `cd arthas-client && npx vitest run src/crypto/`
  - Run CLI crypto tests: `cd arthas-cli && go test ./internal/crypto/...`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Extend payload module with signing support (Web client)
  - [x] 5.1 Extend `src/utils/payload.ts` with `buildSignedPayload` and `parseSignedPayload`
    - Add `SignedMessagePayload` interface with `text`, `sig?`, `reply?`, `type?`, `pubkey?` fields
    - Implement async `buildSignedPayload(text, privateKey, reply?, type?, pubkey?)`:
      1. Build payload object (without sig)
      2. Compute Signable_Bytes via `computeSignableBytes`
      3. Sign with Ed25519 (skip if privateKey is null)
      4. Insert sig into payload
      5. Return JSON.stringify of complete payload
    - Implement `parseSignedPayload(plaintext)` → `SignedMessagePayload`
    - Maintain backward compatibility with existing `buildPayload`/`parsePayload`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 6.3, 6.5, 6.6_

  - [x] 5.2 Write property tests for payload round-trip (Web)
    - **Property 6: Signed_Payload JSON serialization round-trip**
    - **Validates: Requirements 6.5**
    - Create `src/utils/payload.property.test.ts` using fast-check
    - Generate arbitrary payload objects with optional fields, verify serialize→parse round-trip

  - [x] 5.3 Write property tests for base64url encoding (Web)
    - **Property 7: Base64url encoding round-trip and RFC 4648 compliance**
    - **Validates: Requirements 3.7, 6.7, 7.5**
    - In `src/crypto/utils.property.test.ts` (extend existing), test 32-byte and 64-byte arrays
    - Verify round-trip and character set compliance (only `[A-Za-z0-9_-]`)

- [x] 6. Extend CLI payload struct definitions (struct-only, no logic)
  - [x] 6.1 Extend `internal/chat/session.go` struct definitions for signing support
    - Add `Sig`, `Type`, `PubKey` fields to `MessagePayload` struct with `json:"...,omitempty"` tags
    - Add `signingKeyPair` field (`*crypto.SigningKeyPair`) to `Session` struct
    - Add `publicKeyMap` field (`map[string]*PublicKeyEntry`) to `Session` struct
    - Add `PublicKeyEntry` struct with `PublicKey ed25519.PublicKey` and `FirstSeen time.Time` fields
    - Initialize `publicKeyMap` in `RunCreate` and `RunJoin` (alongside existing `members` map init)
    - **Note**: This task only adds struct definitions and field initialization. All signing/verification LOGIC is implemented in Tasks 10.1–10.3.
    - _Requirements: 6.4, 6.5_

  - [x] 6.2 Write property tests for typing/message encryption (CLI)
    - **Property 1: Typing encryption round-trip (extended to CLI encrypt module)**
    - **Property 2: IV uniqueness and correct length**
    - **Validates: Requirements 1.1, 1.3**
    - Extend `internal/crypto/encrypt_property_test.go` with typing payload round-trip tests

  - [x] 6.3 Write property tests for payload round-trip (CLI)
    - **Property 6: Signed_Payload JSON serialization round-trip**
    - **Validates: Requirements 6.5**
    - Add property test in new file `internal/chat/session_property_test.go` for MessagePayload marshal/unmarshal round-trip

- [x] 7. Checkpoint — Verify signing and payload tests pass
  - Run Web tests: `cd arthas-client && npx vitest run src/crypto/ src/utils/`
  - Run CLI tests: `cd arthas-cli && go test ./internal/...`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Integrate encrypted typing into Web client chatStore
  - [x] 8.1 Modify `src/stores/chatStore.ts` to encrypt typing events and decrypt received typing
    - Modify `setTyping` function to be async: encrypt typing status with Room_Key before sending
    - Adapt debounce logic to handle async encryption (use last-write-wins strategy: if a new typing event arrives while encryption is in-flight, discard the stale result and encrypt the latest state)
    - Modify typing message receive handler in `MSG_MEMBER_TYPING` case: detect `{iv, ciphertext}` format → decrypt
    - Add backward compatibility: if received typing message has plain `typing` field (no `iv`/`ciphertext`), handle as before
    - Silently ignore decryption failures (don't break typing indicator)
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.8_

  - [x] 8.2 Write unit tests for encrypted typing integration
    - Test encrypt→send→receive→decrypt flow
    - Test backward compatibility with plaintext typing messages
    - Test decryption failure handling (silent ignore)
    - Test debounce race condition: rapid typing events only send latest state
    - _Requirements: 1.1, 1.5, 1.8_

- [x] 9. Integrate Ed25519 signing into Web client chatStore
  - [x] 9.1 Create `src/crypto/verifyMessage.ts` helper module and add keypair lifecycle to chatStore
    - **New file `src/crypto/verifyMessage.ts`**: Extract verification logic into a dedicated module to keep chatStore focused on state management (consistent with fileTransferStore delegation pattern):
      - `verifyMessageSignature(publicKey, payload)` → `'verified' | 'failed'`
      - `DeferredVerificationQueue` class: manages pending messages per sender (max 20/sender, 60s timeout)
      - `processDeferredQueue(senderId, publicKey, messages)` → batch verify and return results
    - **Modify `src/stores/chatStore.ts`**:
      - Add `signingKeyPair` and `publicKeyMap` state fields
      - Add `PublicKeyEntry` interface with `raw`, `cryptoKey`, `firstSeen` fields
      - Modify `createRoom`/`joinRoom`: generate Ed25519 keypair (null if unsupported), broadcast Public_Key_Announcement
      - Modify `leaveRoom`: discard keypair, clear publicKeyMap, clear deferred queue
      - Handle reconnection: generate new keypair, clear publicKeyMap, re-broadcast
      - Add Ed25519 unsupported fallback: when `generateSigningKeyPair()` returns null (browser doesn't support Ed25519), set `signingKeyPair = null`, skip signing on send, skip pubkey broadcast. All messages sent as `no-sig`. Entire signing flow gracefully degrades without errors.
    - **Ed25519 unsupported fallback test**: Write a unit test that mocks `crypto.subtle.generateKey` to throw `NotSupportedError`, verify that `createRoom`/`joinRoom` still succeeds, `signingKeyPair` is null, no pubkey announcement is sent, and `sendMessage` works without signing.
    - _Requirements: 2.1, 2.3, 2.6, 3.1, 3.2, 3.6, 5.6_

  - [x] 9.2 Modify `src/stores/chatStore.ts` for message signing on send
    - Replace `buildPayload` calls with `buildSignedPayload` (async) in `sendMessage`
    - Pass `signingKeyPair.privateKey` (or null) to `buildSignedPayload`
    - If signing fails, send without sig + console.warn
    - Set `verificationStatus: 'verified'` on locally rendered own messages (own messages are inherently trusted)
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [x] 9.3 Modify `src/stores/chatStore.ts` for signature verification on receive
    - In `MSG_RELAY_MESSAGE` handler: parse with `parseSignedPayload`, check for `sig` field
    - If `sig` present and sender's public key known: call `verifyMessageSignature` from helper module (pass the **cached CryptoKey** from `publicKeyMap[senderId].cryptoKey` — never re-import raw bytes on every message), set `verificationStatus`
    - If `sig` present but public key unknown: add to `DeferredVerificationQueue`
    - If no `sig`: set `verificationStatus = 'no-sig'`
    - Add `verificationStatus` field to `ChatMessage` interface: `'verified' | 'failed' | 'unknown' | 'no-sig'`
    - **Performance note**: `importVerifyKey` is called ONCE per sender (in Task 9.4 when pubkey announcement arrives), the resulting CryptoKey is cached in `publicKeyMap[senderId].cryptoKey`. All subsequent verifications use the cached CryptoKey directly — no repeated import overhead.
    - _Requirements: 5.1, 5.2, 5.4, 5.6, 5.7_

  - [x] 9.4 Implement public key announcement handling in Web client
    - In `MSG_RELAY_MESSAGE` handler: detect `type="pubkey"` messages after decryption
    - Self-verify announcement signature using embedded pubkey (via `verifyMessageSignature`)
    - If self-verification passes: store in `publicKeyMap` (import as CryptoKey via `importVerifyKey`, cache)
    - If self-verification fails: discard announcement, log warning
    - Suppress pubkey announcements from chat UI (don't display as messages)
    - Handle public key conflict (TOFU key change): accept new key, show system warning message ("⚠️ {name} 的签名密钥已变更"), update `firstSeen`
    - On new key arrival: call `DeferredVerificationQueue.processDeferredQueue` to batch verify pending messages
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 10. Integrate Ed25519 signing into CLI client session
  - [x] 10.1 Modify `internal/chat/session.go` for keypair generation, broadcast, and cleanup
    - Generate keypair via `crypto.GenerateSigningKeyPair()` in `RunCreate`/`RunJoin` after `processRoomJoined` succeeds
    - Build Public_Key_Announcement payload: `{"type":"pubkey","text":"","pubkey":"<base64url>"}`
    - Sign the announcement with the new keypair, encrypt with Room_Key, send via MSG_SEND_MESSAGE
    - Zero-fill keypair on `sendLeaveRoom` / session end (extend existing roomKey zeroing pattern)
    - _Requirements: 2.2, 2.7, 3.1, 3.2_

  - [x] 10.2 Modify `internal/chat/session.go` for receiving and storing public keys
    - In `handleRelayMessage`: after decryption and JSON parse, check for `type == "pubkey"`
    - Self-verify announcement: use embedded `pubkey` to verify `sig` field
    - If valid: store in `publicKeyMap` with `FirstSeen = time.Now()`
    - If invalid: log warning, discard
    - Handle public key conflict: accept new key, display `[⚠ key changed] {name}` system message
    - Suppress pubkey messages from chat display (return early, don't call ShowMessage)
    - _Requirements: 3.3, 3.4, 3.5_

  - [x] 10.3 Modify `internal/chat/session.go` for message signing on send
    - In `handleUserInput`: after JSON marshal, compute `ComputeSignableBytes` on the payload map
    - Sign with `signingKeyPair.Sign(signableBytes)`, insert `sig` field into payload
    - Re-marshal the complete payload (with sig) before encryption
    - If signingKeyPair is nil (error condition): send without sig, log warning
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

  - [x] 10.4 Modify `internal/chat/session.go` for signature verification on receive
    - In `handleRelayMessage`: after decryption and JSON parse (for non-pubkey messages)
    - If `sig` field present and sender's public key known: verify via `crypto.VerifySignature`
    - If verification fails: display `[⚠ unverified]` prefix before sender name
    - If no public key for sender: display message normally (TOFU — trust established on next signed message)
    - If no `sig` field: display message normally (backward compatible with unsigned messages)
    - _Requirements: 5.1, 5.3, 5.5, 5.7_

  - [x] 10.5 Write unit tests for CLI session signing integration
    - Test keypair generation on room join
    - Test pubkey announcement broadcast format and encryption
    - Test pubkey announcement receive and self-verification
    - Test signature verification success (normal display) and failure (`[⚠ unverified]` prefix)
    - Test public key conflict handling (accept new key + warning message)
    - Test backward compatibility with unsigned messages
    - _Requirements: 2.2, 3.1, 3.3, 5.1, 5.5_

- [x] 11. Checkpoint — Verify full integration tests pass
  - Run all Web tests: `cd arthas-client && npx vitest run`
  - Run all CLI tests: `cd arthas-cli && go test ./...`
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement verification UI indicators (Web client)
  - [x] 12.1 Add verification status display to `src/components/MessageBubble.tsx`
    - Show subtle ✓ icon for `verified` status (non-intrusive, e.g., small green checkmark near timestamp)
    - Show ⚠️ icon with tooltip for `failed` status: "Signature verification failed — this message may have been tampered with."
    - No indicator for `unknown` and `no-sig` status (clean display)
    - Display system message for public key change warnings ("⚠️ {name} 的签名密钥已变更")
    - Ensure icons are accessible (aria-label for screen readers)
    - _Requirements: 5.2, 5.4, 5.6, 5.7_

  - [x] 12.2 Write unit tests for verification UI states
    - Test rendering of each verification status in MessageBubble
    - Test tooltip content for failed verification
    - Test system message display for key change
    - Test that `unknown` and `no-sig` show no indicator
    - _Requirements: 5.2, 5.4_

- [x] 13. Implement public key announcement self-verification property test
  - [x] 13.1 Write property test for public key announcement round-trip (Web)
    - **Property 8: Public key announcement round-trip with self-verification**
    - **Validates: Requirements 3.2, 3.3**
    - In `src/crypto/signing.property.test.ts`, generate arbitrary keypairs
    - Build announcement payload, sign it, then self-verify using embedded pubkey
    - Verify stored key is byte-identical to original

  - [x] 13.2 Write property test for public key announcement round-trip (CLI)
    - **Property 8: Public key announcement round-trip with self-verification**
    - **Validates: Requirements 3.2, 3.3**
    - In `internal/crypto/signing_property_test.go`, generate arbitrary keypairs
    - Build announcement, sign, self-verify, compare stored key bytes

  - [x] 13.3 Write cross-client signing integration test
    - **Validates: Requirement 7.6** (cross-client integration test)
    - Create `arthas-cli/internal/crypto/crossclient_test.go`:
      - Use Appendix A fixed seed to generate keypair in Go
      - Sign Test Vector 1 payload ("Hello") with Go Ed25519
      - Verify the signature matches the expected hex from Appendix A
    - Create `src/crypto/signing.crossclient.test.ts`:
      - Use same Appendix A fixed seed to generate keypair in Web Crypto
      - Sign same Test Vector 1 payload
      - Verify the signature matches the same expected hex
    - Both tests produce identical signatures for identical inputs → proves cross-client interop
    - _Requirements: 7.1, 7.2, 7.6_

- [x] 14. Final checkpoint — Verify all tests pass
  - Run all Web tests: `cd arthas-client && npx vitest run`
  - Run all CLI tests: `cd arthas-cli && go test ./...`
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation with specific test commands
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples, edge cases, and Test Vectors
- Web client uses TypeScript with Vitest + fast-check for testing
- CLI client uses Go with standard testing + pgregory.net/rapid for property tests
- Server requires zero changes — all enhancements are client-side only
- Both clients must produce byte-identical canonical JSON for interoperability (verified via shared Test Vectors)
- Verification logic is extracted to `src/crypto/verifyMessage.ts` to keep chatStore focused on state management (delegation pattern consistent with fileTransferStore)
- Task 6.1 is intentionally struct-only; all CLI signing/verification logic lives in Tasks 10.1–10.4

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "2.2", "3.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "1.5", "1.6", "2.3", "2.4", "2.5", "2.6", "2.7", "2.8", "3.2", "3.3", "3.4"] },
    { "id": 2, "tasks": ["5.1", "6.1"] },
    { "id": 3, "tasks": ["5.2", "5.3", "6.2", "6.3"] },
    { "id": 4, "tasks": ["8.1", "9.1", "10.1", "10.2"] },
    { "id": 5, "tasks": ["8.2", "9.2", "9.3", "9.4", "10.3", "10.4"] },
    { "id": 6, "tasks": ["10.5", "12.1", "13.1", "13.2", "13.3"] },
    { "id": 7, "tasks": ["12.2"] }
  ]
}
```
