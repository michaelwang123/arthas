[中文](random-match.md)

# Random Match

## Overview

Random Match is an encrypted Omegle-style random pairing feature that connects strangers for ephemeral, end-to-end encrypted conversations.

**Core experience:**

- **No registration** — Jump straight into matching without creating an account
- **End-to-end encryption** — AES-256 key exchange ensures the server never sees plaintext
- **Ephemeral chat** — Conversations are destroyed when the session ends

## Matching Flow

The matching process follows three stages:

1. **Enter matching queue** — User clicks "Match" to join the server-side waiting queue
2. **Interest tag priority matching** — Users with overlapping interest tags are paired first
3. **60-second timeout + cold-start fallback** — If no match is found within 60 seconds, the system falls back to FIFO pairing or suggests an invite link

Once paired, both parties enter an encrypted chat room with a 30-minute default expiry.

## Interest Tag System

Users can select interest tags to improve match relevance:

- **Predefined tags:** `#tech` `#music` `#gaming` `#random` `#language` `#movies`
- **Selection limit:** Up to 3 tags per session
- **Matching priority:** Tag overlap is prioritized for the first 10 seconds; after that, the system falls back to FIFO order

Tags are optional — users without tags are matched purely by queue position.

## Invite Link (Cold Start)

When the matching queue is empty or wait times are long, users can generate an invite link to bring in a specific partner:

- **Generation mechanism:** Client generates a one-time token and registers it with the server
- **Link format:** `{baseUrl}/match/{token}`
- **Validity:** 5 minutes / single use only

The invite link bypasses the queue entirely — when the invitee clicks it, both parties are immediately paired.

## "Next" Session Loop

After a conversation ends (or the user chooses to move on):

- **Re-enter matching** without leaving the flow — no page reload required
- **Excludes recently paired partner** to avoid being matched with the same person
- **10-second cooldown** between consecutive "Next" requests to prevent queue spam

This creates a continuous discovery loop similar to Omegle's "Next" button.

## Room Extension (Mutual Consent)

Match rooms have a 30-minute default lifetime. When time is running out:

- **Triggered at 5 minutes remaining** — Both parties see an "Extend" prompt
- **Both parties must click Extend** — Extension requires mutual consent
- **Maximum 3 extensions** — Total session duration capped at 2 hours

If only one party clicks Extend, the room expires as scheduled.

## Report & Block

Users can report inappropriate behavior during a session:

- **Report categories:** Harassment, spam, inappropriate content, underage user
- **IP-level 24-hour ban** — Reported users are blocked at the IP level for 24 hours
- **3-report threshold** — A user receiving 3 reports within a rolling window triggers an automatic ban

Reports are processed server-side. The reporter's session continues uninterrupted.

## Security Model

Random Match maintains the same zero-knowledge guarantee as standard Arthas rooms:

- **Client A generates AES-256 key** — The encryption key is created entirely on the client side
- **Server only relays, never stores key material** — The key passes through the server in transit but is never persisted or logged
- **Zero-knowledge guarantee** — The pairing mechanism does not downgrade E2EE; the server cannot read matched conversations
- **Match rooms are NOT registered in HubRegistry** — Random match rooms are invisible in the public Hub directory for privacy

The key exchange model ensures that even if the server is compromised, past and current match conversations remain encrypted.

## Server Configuration

| Parameter | Default | Description |
|-----------|---------|-------------|
| match timeout | 60s | Queue wait timeout |
| room expiry | 30min | Room lifetime |
| cooldown | 10s | Request cooldown period |
| rate limit | 20/h | Per-IP hourly limit |
| max queue | 100 | Maximum queue size |
| block duration | 24h | Ban duration |
| max extensions | 3 | Maximum extension count |
| --disable-random-match | false | Disable feature flag |

All parameters are configurable at server startup. See the [Configuration Guide](configuration.en.md) for details.

## Flow Diagram

<img src="../docs/diagrams/random-match-flow.svg" alt="Random Match Flow" width="900"/>
