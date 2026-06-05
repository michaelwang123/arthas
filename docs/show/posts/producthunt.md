# Product Hunt Launch — Arthas

## Submission Details

| Field | Content |
|-------|---------|
| **Product Name** | Arthas |
| **Tagline** (≤60 chars) | E2EE ephemeral chat — no signup, no logs, everything disappears |
| **Website** | https://michaelwang123.github.io/arthas/ |
| **Live Demo** | https://arthas-blush.vercel.app/ |
| **GitHub** | https://github.com/michaelwang123/arthas |
| **Pricing** | Free / Open Source (AGPL-3.0) |
| **Status** | Production Ready |

---

## Topics / Categories

- Privacy
- Open Source
- Developer Tools
- Messaging
- Cybersecurity

---

## Description (≤260 chars)

Create a room, share a key, chat with end-to-end encryption. The server is a blind relay — it never sees your messages. No accounts needed. Self-hostable single binary. Supports web, CLI, Chrome extension, and AI agents.

---

## Longer Description (for "About" section)

Arthas is an open-source, end-to-end encrypted ephemeral chat application. It's designed for people who need secure, temporary communication without creating accounts or trusting a third party with their data.

**How it works:**
1. Create a room — a unique AES-256 encryption key is generated in your browser
2. Share the key with your conversation partner (via QR code, link, or copy-paste)
3. Chat — all messages are encrypted before leaving your device
4. Leave — the room and all messages cease to exist

**What makes Arthas different:**
- **Zero Knowledge** — The server only relays encrypted blobs. It physically cannot read messages.
- **No Signup** — No emails, no phone numbers, no accounts. Open and use.
- **Ephemeral** — Nothing persists. Close the tab and it's gone.
- **Self-Hostable** — One binary, zero dependencies. Run your own instance in 30 seconds.
- **Multi-Client** — Web app, CLI tool, Chrome extension, and AI agent channel — all interoperable.
- **Arthas Hub** — Public room directory for open conversations (like IRC channels, but E2EE).

**Tech highlights:**
- AES-256-GCM encryption + Ed25519 message signatures
- WebSocket + MessagePack binary protocol
- Go backend (~8MB binary, 50MB RAM for 100 connections)
- React frontend (326KB gzipped)
- Docker image < 30MB

---

## Maker Comment (First Comment)

Hey Product Hunt! 👋

I built Arthas because I was frustrated with the false choice between convenience and privacy in messaging.

**The problem:** Every time I needed to share something sensitive — a password, a private key, a confidential document — I had to choose: use a convenient tool that stores everything on someone's server, or jump through hoops with PGP/GPG.

**My solution:** What if encrypted chat was as easy as opening a link? No signup. No app install. No data stored anywhere. Just share a key and talk.

The server is mathematically incapable of reading your messages — it's a blind relay that only sees encrypted noise. When everyone leaves, the room vanishes completely.

I've been using it for:
- Sharing deployment credentials with teammates
- Quick private conversations that shouldn't exist in Slack history
- On-boarding new team members with temporary access info
- AI-assisted conversations where I don't want the provider to see my prompts (via OpenClaw channel)

The new **Arthas Hub** feature adds a public room directory — think IRC channel listings, but every room is still fully encrypted. Great for open-source project discussions or AMAs.

It's fully open source (AGPL-3.0), and you can self-host it with a single binary download or `npx @arthas-chat/create-arthas`.

I'd love to hear your feedback! What privacy use cases would you use this for?

🔗 Try it now: https://arthas-blush.vercel.app/
📖 GitHub: https://github.com/michaelwang123/arthas

---

## Gallery Images (screenshots needed)

You'll need 3-5 images for the Product Hunt gallery. Recommended shots:

1. **Hero shot** — Home page with "Create Room" and "Browse Public Rooms" buttons visible
2. **Chat in action** — Two users chatting with encrypted messages, showing the share code
3. **Arthas Hub** — The public room directory with room cards, tags, and member counts
4. **Multi-client** — Split screen showing web + CLI + Chrome extension all in the same room
5. **Self-hosting** — Terminal showing single binary download and immediate startup

**Image specs:**
- Minimum: 1270×760px
- Recommended: 1920×1080px (16:9)
- Format: PNG or GIF (for animated demos)
- Dark background preferred (matches the app's dark theme)

**Tip:** An animated GIF showing the full flow (create room → share code → friend joins → messages appear encrypted) would be the most compelling gallery item.

---

## Launch Timing Strategy

**Best days:** Tuesday, Wednesday, or Thursday
**Best time:** 00:01 AM Pacific Time (the PH day resets at midnight PT)

**Pre-launch checklist:**
- [ ] Post teaser on Twitter/X 1-2 days before
- [ ] Notify friends/colleagues to upvote on launch day
- [ ] Have the maker comment ready to post immediately after launch
- [ ] Prepare answers for common questions (privacy, vs Signal, self-hosting)
- [ ] Ensure demo site (arthas-blush.vercel.app) is responsive and working

**Post-launch:**
- Respond to every comment within 1 hour
- Share the PH link on Reddit (r/privacy, r/selfhosted), Twitter, and relevant Discord servers
- Update the README badge if you get a "Product of the Day" award

---

## Anticipated Questions & Answers

**Q: How is this different from Signal?**
A: Signal requires phone number signup and stores messages persistently. Arthas is for throwaway, anonymous conversations — no accounts, no history, no metadata. Different use cases.

**Q: If it's encrypted, how does Arthas Hub (public rooms) work?**
A: Public rooms still use E2EE — the encryption key is simply published alongside the room listing. The server still cannot decrypt. Think of it like posting a padlock combination publicly: the lock is still there, you just chose to share the key.

**Q: Can I trust the encryption?**
A: The code is fully open source. It uses Web Crypto API (AES-256-GCM) — the same primitives used by your browser for HTTPS. The server never touches the key. You can verify this by inspecting network traffic.

**Q: What happens if the server restarts?**
A: Everything is gone. By design. There's no database, no persistence layer. This is a feature, not a bug — it guarantees that conversations truly disappear.

**Q: How do I self-host it?**
A: Download one file, run it. `curl -L .../arthas-server-all-linux-amd64 -o arthas && chmod +x arthas && ./arthas` — that's it. Or use Docker: `docker run -p 8080:8080 ghcr.io/michaelwang123/arthas`.
