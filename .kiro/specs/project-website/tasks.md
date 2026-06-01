# Implementation Plan: Arthas Project Website

## Overview

Build the Arthas project website using Astro + @astrojs/starlight, deployed on GitHub Pages at `michaelwang123.github.io/arthas`. Implementation is split into Phase A (MVP: homepage + docs + SEO + deployment) and Phase B (download page + roadmap + animations + full i18n).

**Existing workflow note:** The repository already has `.github/workflows/release.yml` for Go binary releases. The new `deploy-website.yml` is independent and will not conflict (different trigger paths, different deployment targets).

## Tasks

- [x] 1. Phase A — Project Scaffolding & Configuration (~3h)
  - [x] 1.1 Initialize Astro + Starlight project structure
    - Create `website/` directory with `package.json` (pnpm, Astro 4.x, @astrojs/starlight, @astrojs/sitemap)
    - Create `astro.config.mjs` with site, base `/arthas`, Starlight integration (defaultLocale `en`, locales `en`/`zh`, sidebar autogenerate), and `@astrojs/sitemap` integration configured to output at `/arthas/sitemap.xml`
    - Create `tsconfig.json` extending Astro strict config
    - _Requirements: 1.1, 1.7, 9.3, 11.1_

  - [x] 1.2 Create global styles and dark theme
    - Create `src/styles/global.css` with CSS custom properties (--color-bg-primary: #0d0d1a, --color-bg-surface: #1a0a2e, --color-accent: #ffd700, etc.)
    - Override Starlight CSS variables (--sl-color-bg, --sl-color-bg-nav, etc.) for both `:root[data-theme='light']` and `:root[data-theme='dark']`
    - Set font stack: Inter + CJK fallbacks (Noto Sans SC, PingFang SC, etc.)
    - Add CSS transitions (150-400ms ease-out) for interactive elements
    - Create `src/components/ThemeSelectOverride.astro` as empty component to hide theme toggle
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x] 1.3 Set up i18n infrastructure
    - Create `src/i18n/en.json` with all English UI strings (hero, features, trust, footer, 404, how-it-works)
    - Create `src/i18n/zh.json` with all Chinese UI strings
    - Create `src/i18n/utils.ts` with `t()` helper function and `getLocaleFromUrl()` utility
    - _Requirements: 5.1, 5.5, 5.7_

  - [x] 1.4 Create static assets and favicon
    - Create `public/favicon.svg` (lock icon SVG)
    - Create `src/assets/logo.svg` (Arthas lock icon + text)
    - Create `public/robots.txt` with sitemap reference (`Sitemap: https://michaelwang123.github.io/arthas/sitemap.xml`)
    - _Requirements: 1.10, 9.3_

  - [x] 1.5 Update root .gitignore
    - Add `website/node_modules/`, `website/dist/`, `website/src/content/docs/` (symlink targets) to `.gitignore`
    - _Requirements: 11.1_

- [x] 2. Phase A — Landing Page Layout & Homepage Components (~4h)
  - [x] 2.1 Create Landing layout (HTML skeleton)
    - Create `src/layouts/Landing.astro` with full HTML structure: `<head>` with slot for per-page meta, hreflang generation logic, canonical URL computation, favicon link
    - Include language detection inline script in `<head>` (redirect to `/arthas/zh/` if `navigator.language` starts with "zh")
    - Include semantic HTML structure (header/nav/main/footer)
    - **Scope boundary:** This task creates the layout skeleton with meta tag _slots_. Actual per-page meta content (titles, descriptions) is filled in task 5.1.
    - _Requirements: 5.2, 9.5, 9.6, 9.7_

  - [x] 2.2 Implement Hero component
    - Create `src/components/Hero.astro` with product name, tagline, and Launch App button (44x44px min tap target)
    - Launch App button links to `https://arthas-blush.vercel.app` with `target="_blank" rel="noopener"`
    - Use `import.meta.env.BASE_URL` for all internal links (never hardcode `/arthas/`)
    - Include CSS-only placeholder animation with `@media (prefers-reduced-motion: reduce)` support
    - _Requirements: 2.1, 2.2_

  - [x] 2.3 Implement FeatureCards component
    - Create `src/components/FeatureCards.astro` with 6 feature cards (E2EE, No Signup, Self-Destruct, File Sharing, Voice Messages, CLI Client)
    - Each card: icon + title (≤30 chars) + description (≤120 chars)
    - CSS Grid layout: 3 columns desktop, 2 columns tablet, 1 column mobile
    - _Requirements: 2.3, 4.1_

  - [x] 2.4 Implement HowItWorks component
    - Create `src/components/HowItWorks.astro` with 4-5 sequential steps (Create → Share → Chat → Gone)
    - Each step: icon + descriptive label
    - Responsive horizontal layout (desktop) / vertical stack (mobile)
    - _Requirements: 2.6_

  - [x] 2.5 Implement TrustSection component
    - Create `src/components/TrustSection.astro` with 4 trust indicators
    - Open-source badge (GitHub stars link), zero-knowledge architecture SVG diagram, AGPL-3.0 badge, "server sees nothing" explanation
    - _Requirements: 2.7_

  - [x] 2.6 Implement Footer component
    - Create `src/components/Footer.astro` with links to GitHub repo, License (AGPL-3.0), and Launch App button
    - Ensure Launch App opens in new tab
    - _Requirements: 10.2, 10.4_

  - [x] 2.7 Create homepage pages (English + Chinese)
    - Create `src/pages/index.astro` using Landing layout, composing Hero + FeatureCards + HowItWorks + TrustSection + Footer
    - Create `src/pages/zh/index.astro` as Chinese version using same components with locale='zh'
    - _Requirements: 2.1, 5.6_

- [x] 3. Phase A — Navigation & 404 Page (~3h)
  - [x] 3.1a Implement header structure and navigation links
    - Add fixed-position header with logo + navigation links (Home, Docs, GitHub) + GitHub star link
    - Visually distinguish active navigation item (color/underline/font-weight)
    - Ensure header uses semantic `<nav>` element
    - _Requirements: 10.1, 10.3, 10.5, 9.5_

  - [x] 3.1b Implement language switcher
    - Add language switcher component in header, visible without scrolling
    - Persist language selection to localStorage (`arthas-locale` key)
    - On switch, navigate to corresponding language route
    - _Requirements: 5.3, 5.5_

  - [x] 3.1c Implement mobile hamburger menu
    - Hamburger menu button for viewport < 768px, horizontal nav for ≥ 768px
    - Full-screen navigation drawer on mobile (use Starlight's built-in mobile nav if possible)
    - Ensure 44x44px min touch targets on all interactive elements
    - _Requirements: 4.2, 4.3, 4.4_

  - [x] 3.2 Create 404 page
    - Create `src/pages/404.astro` with Arthas logo, friendly error message, and link back to homepage
    - Use `import.meta.env.BASE_URL` for home link
    - _Requirements: 1.9_

- [x] 4. Phase A — Documentation Integration (~2h)
  - [x] 4.1 Create documentation sync script
    - Create `website/scripts/sync-docs.mjs` (Node.js for cross-platform compatibility) that copies `official_doc/` files into `src/content/docs/`
    - English docs (`.en.md`) → `src/content/docs/` (strip `.en` suffix)
    - Chinese docs (`.md`, excluding `.en.md`) → `src/content/docs/zh/`
    - Works on Windows (no bash/symlink dependency)
    - _Requirements: 6.1, 11.7_

  - [x] 4.2 Configure Starlight documentation sidebar
    - Configure sidebar in `astro.config.mjs` using `autogenerate` mode from `docs/` directory
    - Ensure Starlight infers page titles from first H1 heading (no frontmatter modification needed)
    - Verify Pagefind search integration is enabled (built-in)
    - _Requirements: 6.2, 6.7, 6.8_

  - [x] 4.3 Verify documentation rendering features
    - Ensure fenced code blocks render with syntax highlighting (go, typescript, bash, json, yaml) and copy button
    - Verify internal cross-reference links resolve correctly under base path
    - Verify table of contents generation from h2/h3 headings
    - Handle missing/empty markdown files gracefully (Starlight default behavior)
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.9_

- [x] 5. Phase A — SEO & Deployment (~2h)
  - [x] 5.1 Fill per-page SEO meta content
    - Define unique meta title (30-60 chars) and description (50-160 chars) for each page via Landing layout props
    - Ensure canonical URL is generated correctly on every page
    - Ensure hreflang tags (en, zh, x-default) render on every page
    - **Scope boundary:** Layout skeleton (slots, hreflang logic) was created in 2.1. This task fills the actual content values.
    - _Requirements: 9.1, 9.6, 9.7_

  - [x] 5.2 Create GitHub Actions deployment workflow
    - Create `.github/workflows/deploy-website.yml` with build + deploy jobs
    - Trigger on push to `main` branch when `website/**` or `official_doc/**` change
    - Steps: checkout → pnpm setup → install → sync-docs → build → upload artifact → deploy to Pages
    - Fail pipeline with non-zero exit on build errors
    - Note: Coexists with existing `release.yml` (different paths trigger, different targets)
    - _Requirements: 1.2, 1.3, 1.4, 11.4, 11.6_

  - [x] 5.3 Create website README.md
    - Create `website/README.md` with prerequisites (Node.js 18+, pnpm), install command, dev server command, build command, docs sync setup
    - Include Windows-specific note: "sync-docs.mjs is cross-platform, no bash required"
    - _Requirements: 11.3_

- [x] 6. Phase A — Verification & Quality Assurance (~2h)
  - [x] 6.1 Ensure responsive layout across all components
    - Verify no layout overflow from 320px to 2560px viewport widths
    - Ensure vertical stacking and 16px min font on mobile (<768px)
    - Ensure all interactive elements have 44x44px min touch targets on mobile
    - Constrain images/media to max-width: 100%
    - No horizontal scrolling on any viewport
    - _Requirements: 4.1, 4.3, 4.4, 4.5, 4.6_

  - [x] 6.2 Verify build correctness and link integrity
    - Run `pnpm build` — must complete with zero warnings
    - Verify all internal links resolve correctly under `/arthas/` base path (manual spot-check or grep dist/)
    - Verify sync-docs.mjs correctly maps files from `official_doc/`
    - Verify `dist/sitemap.xml` exists and contains expected URLs
    - _Requirements: 1.5, 1.7, 9.3, 11.5_

  - [x] 6.3 Verify performance and accessibility budgets
    - Check JS bundle size on documentation pages: must be < 50KB (inspect dist/ output)
    - Verify color contrast ratios meet WCAG AA (4.5:1 body, 3:1 large text) using browser DevTools or contrast checker
    - Verify hot-reload works in dev mode (change a component, confirm browser updates within 1s)
    - _Requirements: 1.8, 3.6, 11.2_

  - [x] 6.4 Write automated link validation script (optional)
    - Script to crawl dist/ and verify all href/src attributes resolve to existing files
    - Can be a simple Node.js script or use `linkinator` package
    - _Requirements: 1.7_

- [x] 7. Checkpoint — Phase A Complete
  - **Verification commands:**
    ```
    cd website
    node scripts/sync-docs.mjs          # Sync documentation
    pnpm build                           # Must exit 0, zero warnings
    npx astro check                      # TypeScript type validation
    ls dist/sitemap.xml                  # Sitemap exists
    # Manual: open dist/index.html, verify homepage renders
    # Manual: open dist/404.html, verify 404 page renders
    # Manual: check dist/docs/ pages exist with sidebar
    ```
  - Verify: all pages render correctly, navigation works, docs are accessible, 404 page displays properly, base path `/arthas/` resolves everywhere.

- [x] 8. Phase B — Download Page & GitHub Release Integration (~3h)
  - [x] 8.1 Create GitHub Release fetch script
    - Create `website/scripts/fetch-release.mjs` that fetches latest release from GitHub API
    - Write result to `src/data/release.json` (version, assets with download URLs, publishedAt)
    - Implement fallback: hardcoded version + warning log if API unreachable
    - Update `package.json` build script: `"build": "node scripts/fetch-release.mjs && node scripts/sync-docs.mjs && astro build"`
    - _Requirements: 7.2, 7.6, 7.7_

  - [x] 8.2 Implement Download page
    - Create `src/pages/download.astro` with download links for all platforms (Linux amd64/arm64, macOS amd64/arm64, Windows amd64)
    - Display both arthas-server and arthas-cli binaries
    - Show current version number prominently near download buttons
    - Include Docker self-hosting instructions with copy-to-clipboard buttons
    - Quick-start section: ≤3 steps per tier (Tier 1: Single Binary, Tier 2: Docker Compose)
    - Include fallback link to GitHub Releases page
    - Create `src/pages/zh/download.astro` for Chinese version
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 8.3 Write unit tests for fetch-release script
    - Test successful API response parsing
    - Test fallback behavior when API is unreachable
    - Test JSON output format
    - _Requirements: 7.2, 7.6_

- [x] 9. Phase B — Roadmap Visualization (~3h)
  - [x] 9.1 Create roadmap data file
    - Create `src/data/roadmap.json` with all 11 phases (name, nameEn, status, percentage, features array)
    - Each feature: name, nameEn, done boolean
    - _Requirements: 8.1, 8.4, 8.5_

  - [x] 9.2 Implement Roadmap page
    - Create `src/pages/roadmap.astro` rendering all phases with progress bars, status icons (✅/⏳/📋), and distinct colors per status
    - Each phase: name, completion percentage, status label, up to 10 features with checked/unchecked indicators
    - Handle missing/unparseable data file with error message
    - Ensure keyboard navigability and accessible labels (aria-valuenow, aria-valuemax, screen reader text)
    - Create `src/pages/zh/roadmap.astro` for Chinese version
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

- [x] 10. Phase B — Scroll Animations & Hero Enhancement (~2h)
  - [x] 10.1 Implement scroll animations for Feature Cards
    - Add IntersectionObserver-based fade-and-translate entrance animation
    - Stagger delay of 100-150ms between consecutive cards
    - Respect `prefers-reduced-motion` (disable animations when preferred)
    - Keep JS payload minimal (~2KB)
    - _Requirements: 2.5_

  - [x] 10.2 Enhance Hero section animation
    - Implement looping CSS animation (encryption particle effect) that begins within 1s of page load
    - Pause animation when `prefers-reduced-motion: reduce` is active
    - _Requirements: 2.4_

- [x] 11. Phase B — Full i18n & Navigation Enhancements (~2h)
  - [x] 11.1 Implement full language switching for all pages
    - Ensure language switcher navigates between corresponding language routes for download and roadmap pages
    - Persist language preference in localStorage across visits
    - _Requirements: 5.4, 5.6_

  - [x] 11.2 Add Phase B navigation items
    - Add Download and Roadmap links to header navigation
    - Implement "Back to top" button (appears after scrolling past first viewport height, smooth scroll to top)
    - _Requirements: 10.1, 10.6, 10.7_

- [x] 12. Phase B — Advanced SEO & Social Sharing (~1h)
  - [x] 12.1 Add Open Graph image and Twitter Card meta
    - Create/add `public/og-image.png` (1200x630px) for social sharing
    - Add og:image and Twitter Card meta tags to all pages
    - _Requirements: 9.2_

  - [x] 12.2 Add JSON-LD structured data
    - Add schema.org/SoftwareApplication JSON-LD to homepage
    - Include name, description, url, applicationCategory, operatingSystem, license, offers
    - _Requirements: 9.4_

- [x] 13. Checkpoint — Phase B Complete
  - **Verification commands:**
    ```
    cd website
    node scripts/fetch-release.mjs       # Fetch release (or fallback)
    node scripts/sync-docs.mjs           # Sync docs
    pnpm build                           # Must exit 0, zero warnings
    npx astro check                      # TypeScript validation
    ls dist/download/index.html          # Download page exists
    ls dist/roadmap/index.html           # Roadmap page exists
    ls dist/zh/download/index.html       # Chinese download exists
    ls dist/zh/roadmap/index.html        # Chinese roadmap exists
    # Manual: verify download links point to valid GitHub Release URLs
    # Manual: verify roadmap renders all 11 phases with correct status
    # Manual: verify language switching works on download/roadmap pages
    # Manual: verify scroll animations respect prefers-reduced-motion
    ```

- [x] 14. Final Integration & Wiring (~1h)
  - [x] 14.1 Wire all Phase B components into navigation and layout
    - Ensure all pages are linked from navigation and footer
    - Verify sitemap.xml includes all new pages (download, roadmap, zh variants)
    - Verify hreflang tags are correct on all pages
    - Verify all internal links resolve under `/arthas/` base path
    - _Requirements: 9.3, 9.7, 10.1_

  - [x] 14.2 Write end-to-end build validation tests
    - Test full build pipeline (fetch-release → sync-docs → astro build) completes successfully
    - Validate all generated HTML pages have required meta tags
    - Validate sitemap.xml contains all expected URLs
    - _Requirements: 1.2, 9.3, 11.5_

- [x] 15. Final Checkpoint — All Phases Complete
  - **Verification commands:**
    ```
    cd website
    pnpm build                           # Full build pipeline
    npx astro check                      # Type check
    # Verify JS budget: find dist -name "*.js" | Get-ChildItem | Measure-Object -Property Length -Sum
    # (docs pages JS total must be < 50KB)
    # Manual: Lighthouse audit on homepage (target ≥95 performance)
    # Manual: test on 320px and 2560px viewports
    # Manual: verify all hreflang, canonical, og:* meta tags
    # Manual: test language detection (clear localStorage, set browser to zh)
    ```
  - Verify complete site: homepage, docs, download, roadmap all render correctly in both languages with proper SEO, responsive design, and accessibility.

## Notes

- Tasks marked with `*` are optional enhancements (not required for requirement compliance)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each phase
- Phase A can be deployed independently — Phase B builds on top without breaking Phase A
- All internal links must use `import.meta.env.BASE_URL` (never hardcode `/arthas/`)
- The `sync-docs.mjs` script must run before every build to ensure docs are up-to-date
- Follow Arthas code-quality steering: file-level comments, 📚 学习要点 annotations, semantic HTML
- **Windows compatibility:** All build scripts use Node.js (`.mjs`), no bash dependency. `sync-docs.mjs` replaces the original `sync-docs.sh` design to ensure cross-platform operation on the developer's Windows machine.
- **Time budget:** Phase A ~16h (tasks 1-7), Phase B ~12h (tasks 8-15). Total ~28h (~3.5 working days).

## Dependency Rationale

| Wave | Tasks | Why this order |
|------|-------|----------------|
| 0 | 1.1, 1.4, 1.5 | Independent bootstrapping: project init, assets, gitignore have zero deps |
| 1 | 1.2, 1.3 | Styles and i18n need `astro.config.mjs` (from 1.1) to reference customCss path |
| 2 | 2.1, 4.1 | Landing layout needs i18n utils (1.3); sync-docs needs project directory (1.1) |
| 3 | 2.2–2.6, 3.2, 4.2 | All components slot into Landing layout (2.1); sidebar config needs content (4.1) |
| 4 | 2.7, 3.1a, 3.1b, 4.3 | Homepage assembles components (wave 3); header needs layout; docs verification needs sidebar |
| 5 | 3.1c, 5.1, 5.2, 5.3 | Mobile nav needs header structure (3.1a); SEO content needs pages to exist; deployment needs buildable site |
| 6 | 6.1, 6.2, 6.3 | Verification requires all Phase A pages built and deployable |
| 7 | Checkpoint 7 | Gate: Phase A must pass before Phase B starts |
| 8 | 8.1, 9.1 | Phase B data preparation: independent of each other |
| 9 | 8.2, 9.2 | Pages consume data from wave 8 |
| 10 | 10.1, 10.2, 11.1 | Animations and full i18n enhance existing pages (waves 8-9) |
| 11 | 11.2, 12.1, 12.2 | Nav updates and advanced SEO after all Phase B pages exist |
| 12 | 14.1, 14.2 | Final wiring verifies everything together |

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.4", "1.5"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["2.1", "4.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "3.2", "4.2"] },
    { "id": 4, "tasks": ["2.7", "3.1a", "3.1b", "4.3"] },
    { "id": 5, "tasks": ["3.1c", "5.1", "5.2", "5.3"] },
    { "id": 6, "tasks": ["6.1", "6.2", "6.3"] },
    { "id": 7, "tasks": ["checkpoint-7"] },
    { "id": 8, "tasks": ["8.1", "9.1"] },
    { "id": 9, "tasks": ["8.2", "9.2"] },
    { "id": 10, "tasks": ["10.1", "10.2", "11.1"] },
    { "id": 11, "tasks": ["11.2", "12.1", "12.2"] },
    { "id": 12, "tasks": ["14.1", "14.2", "checkpoint-15"] }
  ]
}
```
