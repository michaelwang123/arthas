[中文](protocol.md) | English

# Protocol Specification

This document defines the WebSocket communication protocol for Arthas.

---

## Overview

Arthas uses WebSocket for real-time communication, with messages serialized using MessagePack binary format.

- **Transport Layer**: WebSocket (WSS/TLS 1.3)
- **Serialization**: MessagePack
- **Message Pattern**: Request-Response + Server Push

---

## Message Envelope

All messages use a unified envelope format:

```
{
  type: uint8       // Message type ID
  data: object      // Message body
}
```

Encoded with MessagePack and sent as a WebSocket Binary Frame.

---

## Message Types

### Client → Server

| ID     | Name              | Description                    |
| --------| --------------------| ----------------------|
| `0x01` | CreateRoom        | Create a room                  |
| `0x02` | JoinRoom          | Join a room                    |
| `0x03` | SendMessage       | Send an encrypted message      |
| `0x04` | LeaveRoom         | Leave a room                   |
| `0x05` | Typing            | Typing status                  |
| `0x06` | Pong              | Heartbeat reply                |
| `0x08` | SendFileMeta      | Send encrypted file metadata   |
| `0x09` | SendFileChunk     | Send encrypted file chunk      |
| `0x0A` | SendFileComplete  | File transfer complete signal  |
| `0x0B` | SendFileCancel    | Cancel file transfer           |
| `0x0C` | SendFileAck       | File receive acknowledgment    |

### Server → Client

| ID     | Name              | Description                    |
| --------| --------------------| ----------------------|
| `0x10` | RoomCreated       | Room created successfully      |
| `0x11` | RoomJoined        | Joined room successfully       |
| `0x12` | MemberJoined      | New member joined              |
| `0x13` | MemberLeft        | Member left                    |
| `0x14` | RelayMessage      | Relay encrypted message        |
| `0x15` | MemberTyping      | Member typing status           |
| `0x16` | RoomClosed        | Room closed                    |
| `0x17` | Error             | Error response                 |
| `0x18` | Ping              | Heartbeat request              |
| `0x1A` | RelayFileMeta     | Relay file metadata            |
| `0x1B` | RelayFileChunk    | Relay file chunk               |
| `0x1C` | RelayFileComplete | Relay transfer complete signal |
| `0x1D` | RelayFileCancel   | Relay cancel signal            |
| `0x1E` | RelayFileAck      | Relay receive acknowledgment   |

---

## Detailed Message Definitions

### CreateRoom (0x01)

Create a new chat room.

**Request:**
```json
{
  "type": 1,
  "data": {
    "name": "Alice"        // Creator nickname (1-20 characters)
  }
}
```

**Response:** RoomCreated (0x10) + RoomJoined (0x11)

---

### JoinRoom (0x02)

Join an existing room.

**Request:**
```json
{
  "type": 2,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT",   // 21-character NanoID
    "name": "Bob"                           // Joiner nickname
  }
}
```

**Response:** RoomJoined (0x11)  
**Errors:** E001 (room not found), E002 (room full)

> Note: roomKey is never sent to the server; it is only parsed from the share code on the client side.

---

### SendMessage (0x03)

Send an encrypted message.

**Request:**
```json
{
  "type": 3,
  "data": {
    "iv": "base64url_encoded_12_bytes",           // 96-bit IV
    "ciphertext": "base64url_encoded_ciphertext"  // AES-GCM ciphertext
  }
}
```

**Server behavior:** Forwards as-is to other members in the room (does not parse content)  
**Errors:** E003 (not in a room), E004 (rate limited), E005 (malformed message)

---

### LeaveRoom (0x04)

Leave the current room.

**Request:**
```json
{
  "type": 4,
  "data": {}
}
```

**Server behavior:** Removes the member, broadcasts MemberLeft, destroys empty rooms

---

### Typing (0x05)

Notify typing status.

**Request:**
```json
{
  "type": 5,
  "data": {
    "typing": true    // true=typing, false=stopped typing
  }
}
```

**Server behavior:** Broadcasts MemberTyping to other members in the room

> Note: Typing status is unencrypted metadata visible to the server.

---

### Pong (0x06)

Heartbeat reply.

**Request:**
```json
{
  "type": 6,
  "data": {
    "t": 1704067200000    // Echo back the timestamp from Ping
  }
}
```

---

### RoomCreated (0x10)

Room creation success notification.

**Response:**
```json
{
  "type": 16,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT"    // Server-generated room ID
  }
}
```

---

### RoomJoined (0x11)

Successfully joined a room; returns the current member list.

**Response:**
```json
{
  "type": 17,
  "data": {
    "roomId": "V1StGXR8_Z5jdHi6B-myT",
    "members": [
      {"id": "a1b2c3d4", "name": "Alice", "color": "#4a7fbf"},
      {"id": "e5f6g7h8", "name": "Bob", "color": "#bf4a7f"}
    ]
  }
}
```

---

### MemberJoined (0x12)

New member joined notification (broadcast to existing room members).

**Response:**
```json
{
  "type": 18,
  "data": {
    "id": "e5f6g7h8",
    "name": "Bob",
    "color": "#bf4a7f"
  }
}
```

---

### MemberLeft (0x13)

Member left notification.

**Response:**
```json
{
  "type": 19,
  "data": {
    "id": "e5f6g7h8"
  }
}
```

---

### RelayMessage (0x14)

Encrypted message relayed by the server.

**Response:**
```json
{
  "type": 20,
  "data": {
    "senderId": "a1b2c3d4",
    "senderName": "Alice",
    "iv": "base64url_encoded_12_bytes",
    "ciphertext": "base64url_encoded_ciphertext",
    "t": 1704067200000    // Server receive timestamp (Unix ms)
  }
}
```

> The server does not parse iv or ciphertext; they are forwarded as-is.

---

### MemberTyping (0x15)

Member typing status notification.

**Response:**
```json
{
  "type": 21,
  "data": {
    "id": "a1b2c3d4",
    "typing": true
  }
}
```

---

### RoomClosed (0x16)

Room closed notification (triggered when the last member leaves).

**Response:**
```json
{
  "type": 22,
  "data": {}
}
```

---

### Error (0x17)

Error response.

**Response:**
```json
{
  "type": 23,
  "data": {
    "code": "E001",
    "msg": "room not found"
  }
}
```

---

### Ping (0x18)

Server heartbeat request (sent every 25 seconds).

**Response:**
```json
{
  "type": 24,
  "data": {
    "t": 1704067200000    // Server current timestamp (Unix ms)
  }
}
```

The client should reply with Pong (0x06) upon receiving this.

---

## File Transfer Protocol

> 📚 Learning Note: Numbering Scheme
> File transfer messages use two ID ranges:
> - `0x08-0x0C`: Client → Server (following existing 0x01-0x06, with 0x07 reserved)
> - `0x1A-0x1E`: Server → Client (following existing 0x10-0x18, with 0x19 reserved)
>
> This numbering scheme maintains directional grouping consistency:
> - 0x0_ range = client-initiated messages
> - 0x1_ range = server-initiated/relayed messages

### Design Principles

- **Zero-Knowledge Relay**: The server does not decrypt, store, or inspect any file content; it only performs immediate forwarding
- **Binary Transport**: Encrypted data uses msgpack `bin` format to transmit raw bytes, avoiding the 33% overhead of base64 encoding
- **Chunk Encryption**: Fixed 64KB chunks, each independently encrypted with AES-256-GCM (unique IV), enabling streaming
- **Sequential Transport**: Relies on TCP ordering; no out-of-order handling logic needed
- **Backpressure Awareness**: File transfers use blocking sends with timeouts to avoid silent packet drops when the send buffer is full

### Message Flow Diagram

```
Complete file transfer lifecycle:

  Sender                    Server                   Receiver
    |                         |                         |
    |--- SendFileMeta ------->|                         |
    |                         |--- RelayFileMeta ------>|
    |                         |                         |
    |--- SendFileChunk[0] --->|                         |
    |                         |--- RelayFileChunk[0] -->|
    |--- SendFileChunk[1] --->|                         |
    |                         |--- RelayFileChunk[1] -->|
    |        ...              |        ...              |
    |--- SendFileChunk[N-1]-->|                         |
    |                         |--- RelayFileChunk[N-1]->|
    |                         |                         |
    |--- SendFileComplete --->|                         |
    |                         |--- RelayFileComplete -->|
    |                         |                         |
    |                         |<-- SendFileAck ---------|
    |<-- RelayFileAck --------|                         |
    |                         |                         |

Cancel transfer flow:

  Sender                    Server                   Receiver
    |                         |                         |
    |--- SendFileCancel ----->|                         |
    |                         |--- RelayFileCancel ---->|
    |                         |                         |

Sender disconnect flow:

  Sender                    Server                   Receiver
    |                         |                         |
    | [WebSocket disconnected]|                         |
    X                         |--- RelayFileCancel ---->|
                              |    (auto-generated by server)
```

### Binary Format Details

> 📚 Learning Note: msgpack bin format vs base64 strings
> Encrypted data in file transfers (IV, ciphertext) uses msgpack's `bin` format:
> - `bin` format: stores raw bytes directly, with only 1-5 bytes of length prefix overhead
> - `base64` string: encodes binary as ASCII, inflating by 33% (3 bytes → 4 characters)
>
> For a 64KB encrypted chunk:
> - bin format: 65,552 bytes (data) + 3 bytes (bin32 header) = 65,555 bytes
> - base64 string: 87,404 bytes (encoded) + 5 bytes (str32 header) = 87,409 bytes
> - Savings: ~21,854 bytes/chunk (25% reduction)
>
> Note: The IV in File_Metadata uses a base64url string (sent only once, convenient for debugging),
> while the IV in Chunks uses bin format (sent frequently, optimized for performance).

Size of a single SendFileChunk message encoded with msgpack:

```
- type field: 1 byte (fixint 0x09)
- data map header: 1 byte (fixmap, 4 fields)
- "transferId" key + 21 char value: ~25 bytes
- "index" key + uint16 value: ~8 bytes
- "iv" key + 12 bytes bin: ~16 bytes
- "data" key + (65536 + 16) bytes bin: ~65,558 bytes
- msgpack envelope overhead: ~10 bytes
─────────────────────────────────────────────
Total: ~65,620 bytes ≈ 64KB

maxMessageSize = 100KB (102,400 bytes) — provides sufficient headroom
ReadBufferSize = WriteBufferSize = 128KB (131,072 bytes)
```

---

### SendFileMeta (0x08)

Send encrypted file metadata. Sent before the transfer begins, containing encrypted file information (filename, size, MIME type, total chunks, etc.).

**Direction:** Client → Server

**Request:**
```json
{
  "type": 8,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT",   // 21-character NanoID, uniquely identifies this transfer
    "iv": "base64url_encoded_12_bytes",        // 96-bit IV (base64url encoded, for metadata encryption)
    "ciphertext": <bin>                        // msgpack bin: AES-256-GCM encrypted FileMetadata JSON
  }
}
```

**Decrypted ciphertext structure (FileMetadata):**
```json
{
  "transferId": "V1StGXR8_Z5jdHi6B-myT",
  "fileName": "photo.png",
  "fileSize": 327680,
  "mimeType": "image/png",
  "totalChunks": 5,
  "thumbnail": <Uint8Array | null>,    // Optional: pre-encryption thumbnail (≤50KB, JPEG)
  "chunkHashes": ["a1b2c3...", ...]    // Optional: SHA-256 hash of each chunk's plaintext
}
```

**Server behavior:**
1. Verify the client has joined a room (otherwise return E003)
2. Verify the client has no other active transfer (`activeTransferID == ""`, otherwise return E005)
3. Set `client.activeTransferID = transferId`
4. Forward to other online members in the room via `BroadcastFileData` (appending senderId, senderName, timestamp)

**Errors:** E003 (not in a room), E005 (already has an active transfer)

> Note: File transfer messages are not subject to the text message rate limit (E004); instead they use a "max 1 active transfer per client" constraint.

---

### SendFileChunk (0x09)

Send an encrypted file chunk. Each chunk is independently encrypted with a unique IV.

**Direction:** Client → Server

**Request:**
```json
{
  "type": 9,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT",   // Transfer ID
    "index": 0,                                // Chunk index (uint16, 0-based)
    "iv": <bin 12 bytes>,                      // msgpack bin: 96-bit IV (raw bytes, not base64)
    "data": <bin ~65552 bytes>                 // msgpack bin: AES-256-GCM encrypted chunk data
  }
}
```

**Field descriptions:**

| Field | Type | Size | Description |
|------|------|------|------|
| transferId | string | 21 chars | Transfer session identifier |
| index | uint16 | 0-65535 | Chunk index, starting from 0, max `ceil(5MB/64KB)-1 = 79` |
| iv | bin | 12 bytes | AES-256-GCM initialization vector (unique per chunk, randomly generated) |
| data | bin | ≤65552 bytes | Encrypted chunk = plaintext(≤64KB) + GCM tag(16B) |

**Server behavior:**
1. Verify `transferId` matches the client's `activeTransferID`
2. Forward to other online members in the room via `BroadcastFileData` (appending senderId)

> 📚 Learning Note: IV Format Choice
> The chunk IV uses msgpack bin format (raw 12 bytes) rather than a base64url string.
> Reason: Chunks are sent frequently (up to 80 times per file), avoiding the overhead of base64 encoding/decoding each time.
> msgpack uses bin format for Uint8Array, which is more compact than string (12 bytes vs 16 chars).

---

### SendFileComplete (0x0A)

File transfer complete signal. Sent by the sender after all chunks have been transmitted.

**Direction:** Client → Server

**Request:**
```json
{
  "type": 10,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Server behavior:**
1. Verify `transferId` matches the client's `activeTransferID`
2. Clear `client.activeTransferID` (release the transfer slot)
3. Forward to other online members in the room via `BroadcastFileData`

---

### SendFileCancel (0x0B)

Cancel file transfer. The sender actively cancels an in-progress transfer.

**Direction:** Client → Server

**Request:**
```json
{
  "type": 11,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Server behavior:**
1. Verify `transferId` matches the client's `activeTransferID`
2. Clear `client.activeTransferID` (release the transfer slot)
3. Forward to other online members in the room via `BroadcastFileData`

> Note: When the sender disconnects, the server also automatically generates a RelayFileCancel broadcast to room members.

---

### SendFileAck (0x0C)

File receive acknowledgment. Sent by the receiver after successfully receiving and reassembling the complete file.

**Direction:** Client → Server

**Request:**
```json
{
  "type": 12,
  "data": {
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Server behavior:**
1. Verify `transferId` is non-empty
2. Find the original sender among room members (matching `activeTransferID` or the client that recently completed this transfer)
3. Send the ACK only to the original sender (directed relay, not broadcast)

> 📚 Learning Note: Directed ACK Relay
> Unlike other file transfer messages (broadcast to all members), ACK is sent only to the original sender.
> This avoids N receivers' ACKs being broadcast to everyone (N² message amplification).
> The sender uses the ACK count to update the UI: "Delivered (2/5)".

---

### RelayFileMeta (0x1A)

Server-relayed file metadata. The receiver learns about a new file transfer starting through this message.

**Direction:** Server → Client

**Response:**
```json
{
  "type": 26,
  "data": {
    "senderId": "a1b2c3d4",                    // Sender Client ID
    "senderName": "Alice",                     // Sender nickname
    "transferId": "V1StGXR8_Z5jdHi6B-myT",    // Transfer ID
    "iv": "base64url_encoded_12_bytes",        // Metadata encryption IV
    "ciphertext": <bin>,                       // msgpack bin: encrypted FileMetadata
    "t": 1704067200000                         // Server receive timestamp (Unix ms)
  }
}
```

**Receiver behavior:**
1. Decrypt ciphertext using Room_Key + IV to obtain FileMetadata
2. Prepare `chunks[]` buffer (size = totalChunks)
3. Insert a file message placeholder in the chat list
4. Start a 60-second timeout timer

---

### RelayFileChunk (0x1B)

Server-relayed file chunk. The receiver decrypts each chunk and stores it in the buffer.

**Direction:** Server → Client

**Response:**
```json
{
  "type": 27,
  "data": {
    "senderId": "a1b2c3d4",                    // Sender Client ID
    "transferId": "V1StGXR8_Z5jdHi6B-myT",    // Transfer ID
    "index": 0,                                // Chunk index
    "iv": <bin 12 bytes>,                      // msgpack bin: chunk encryption IV
    "data": <bin ~65552 bytes>                 // msgpack bin: encrypted chunk data
  }
}
```

**Receiver behavior:**
1. Verify `transferId` exists in active transfers (silently discard unknown IDs)
2. Verify `index` is within valid range (`0 ≤ index < totalChunks`)
3. Check for duplicate chunks (silently ignore if already received)
4. Decrypt chunk data using Room_Key + IV
5. Store in `chunks[index]`, update progress
6. Reset the 60-second timeout timer

---

### RelayFileComplete (0x1C)

Server-relayed transfer complete signal. The receiver performs file reassembly upon receipt.

**Direction:** Server → Client

**Response:**
```json
{
  "type": 28,
  "data": {
    "senderId": "a1b2c3d4",
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Receiver behavior:**
1. Verify all chunks have been received (`receivedChunks === totalChunks`)
2. Reassemble chunks into the complete file in index order
3. Sanitize filename (remove path separators, null bytes, limit to 255 characters)
4. Create a Blob URL for user download
5. Send SendFileAck (0x0C) to confirm receipt
6. Update transfer status to complete

---

### RelayFileCancel (0x1D)

Server-relayed cancel signal. Triggered when the sender actively cancels or disconnects.

**Direction:** Server → Client

**Response:**
```json
{
  "type": 29,
  "data": {
    "senderId": "a1b2c3d4",
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Receiver behavior:**
1. Discard all received chunk buffers for this transfer
2. Clear the timeout timer
3. Display "Sender cancelled the transfer" or "Sender left, transfer interrupted"
4. Update transfer status to cancelled

> Note: This message may be triggered by the sender actively (SendFileCancel) or auto-generated by the server when the sender disconnects.

---

### RelayFileAck (0x1E)

Server-relayed receive acknowledgment. Sent only to the original file sender.

**Direction:** Server → Client (sender only)

**Response:**
```json
{
  "type": 30,
  "data": {
    "receiverId": "e5f6g7h8",                  // ID of the member confirming receipt
    "transferId": "V1StGXR8_Z5jdHi6B-myT"
  }
}
```

**Sender behavior:**
1. Increment the ACK count for this transfer
2. Update UI to display "Delivered (N/M)" (N = confirmed count, M = total room members - 1)

---

## File Transfer Constraints

| Parameter | Value | Description |
|------|------|------|
| Max_File_Size | 5MB (5,242,880 bytes) | Maximum single file size |
| Chunk_Size | 64KB (65,536 bytes) | Fixed chunk size (last chunk may be smaller) |
| Max_Chunks | 80 | `ceil(5MB / 64KB)` |
| Transfer_Timeout | 60s | Transfer marked as failed if no new chunks arrive |
| Server_Transfer_Timeout | 90s | Server-side fallback timeout cleanup |
| Max_Active_Transfers | 1/client | Only 1 active transfer per client at a time |
| Max_Queue_Size | 3 | Maximum pending items in the send queue |
| Max_Concurrent_Receives | 5 | Maximum concurrent incoming transfers |
| Inter_Chunk_Delay | 10ms (base) | Base delay between chunks (adaptively adjusted) |
| SendFileData_Timeout | 5s | Server-side per-receiver send timeout |
| maxMessageSize | 100KB (102,400 bytes) | WebSocket maximum single message size |
| ReadBufferSize | 128KB (131,072 bytes) | WebSocket read buffer |
| WriteBufferSize | 128KB (131,072 bytes) | WebSocket write buffer |

---

## Connection Lifecycle

```
1. Client initiates WebSocket connection → ws://host/ws
2. Server assigns Client ID (first 8 characters of UUID)
3. Server starts 25s interval Ping
4. Client sends CreateRoom/JoinRoom to enter a room
5. Normal message exchange
6. Client sends LeaveRoom or disconnects
7. Server cleans up connection and room state
```

---

## Reconnection Strategy

The client automatically reconnects after disconnection:

| Retry Count | Wait Time |
|----------|----------|
| 1 | 1s |
| 2 | 2s |
| 3 | 4s |
| 4 | 8s |
| 5 | 16s |
| 6+ | 30s (maximum) |

After a successful reconnection, the backoff time resets to 1s.

---

## Next Steps

- [Security Model](security.md) — Encryption scheme details
- [Configuration Reference](configuration.md) — Parameter tuning
