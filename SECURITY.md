# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | ✅ Security updates |
| < 1.0   | ❌ No longer supported |

## Reporting a Vulnerability

**Please do NOT open a public GitHub issue for security vulnerabilities.**

### Private Reporting

**Preferred:** Use GitHub's built-in [Private Vulnerability Reporting](https://github.com/michaelwang123/arthas/security/advisories/new) to submit reports directly on GitHub.

**Fallback:** If GitHub private reporting is unavailable, email the maintainer at the address listed in the GitHub profile.

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

### Response Timeline

| Step | Timeframe |
|------|-----------|
| Acknowledgment | Within 72 hours |
| Initial assessment | Within 1 week |
| Fix development | Depends on severity |
| Coordinated disclosure | After fix is released |

### Scope

The following areas are in scope for security reports:

- **E2EE implementation** — Key generation, AES-256-GCM encryption/decryption, IV handling
- **WebSocket protocol** — Message injection, replay attacks, protocol downgrade
- **Server relay logic** — Information leakage, unauthorized room access, denial of service
- **Authentication bypass** — Room password bypass, share code prediction
- **Client-side crypto** — Key exposure, side-channel attacks, weak randomness

Out of scope:
- Social engineering attacks
- Denial of service via resource exhaustion (known limitation of free-tier hosting)
- Issues in third-party dependencies (report upstream)

### Disclosure Policy

We follow coordinated disclosure:
1. Reporter submits vulnerability privately
2. We acknowledge and assess
3. We develop and test a fix
4. We release the fix and publish a security advisory
5. Reporter receives credit in the advisory (unless anonymity is requested)

### Credit

We believe in recognizing security researchers. Unless you request anonymity, you will be credited in:
- The GitHub Security Advisory
- The release notes for the fixing version
- The project's SECURITY.md acknowledgments section

## Acknowledgments

<!-- Security researchers who have responsibly disclosed vulnerabilities -->

*No vulnerabilities reported yet. Be the first responsible disclosure!*
