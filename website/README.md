# Arthas Website

Arthas 项目官网 — 基于 Astro + @astrojs/starlight 构建的静态文档与营销站点，部署在 GitHub Pages (`michaelwang123.github.io/arthas`)。

## Prerequisites

- **Node.js** 18+ ([download](https://nodejs.org/))
- **pnpm** 9+ ([install guide](https://pnpm.io/installation))

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Sync documentation

Before running the dev server or building, sync the docs from `official_doc/` into the Starlight content collection:

```bash
node scripts/sync-docs.mjs
```

> **Windows note:** `sync-docs.mjs` is cross-platform, no bash required. It uses Node.js `fs` APIs and works natively on Windows, macOS, and Linux.

### Start the dev server

```bash
pnpm dev
```

The dev server starts at `http://localhost:4321/arthas/` with hot-reload enabled — file changes reflect in the browser within 1 second.

### Production build

```bash
pnpm build
```

Output is generated in `website/dist/`. The build must complete with zero warnings.

### Preview the production build

```bash
pnpm preview
```

Serves the built site locally for final verification before deployment.

## Documentation Sync

The `official_doc/` directory at the repository root contains the source Markdown files. The sync script maps them into Starlight's content collection:

| Source | Destination | Notes |
|--------|-------------|-------|
| `official_doc/*.en.md` | `src/content/docs/` | English docs (`.en` suffix stripped) |
| `official_doc/*.md` (excluding `.en.md`) | `src/content/docs/zh/` | Chinese docs |

Run `node scripts/sync-docs.mjs` before every build to ensure docs are up-to-date. The CI workflow handles this automatically.

## Project Structure

```
website/
├── astro.config.mjs       # Astro + Starlight configuration
├── package.json           # Dependencies (pnpm)
├── tsconfig.json          # TypeScript config
├── public/                # Static assets (favicon, robots.txt)
├── scripts/
│   └── sync-docs.mjs     # Cross-platform doc sync script
└── src/
    ├── assets/            # Images, logos (processed by Astro)
    ├── components/        # Astro components (Hero, FeatureCards, etc.)
    ├── content/docs/      # Generated — do not edit directly
    ├── i18n/              # Locale strings (en.json, zh.json)
    ├── layouts/           # Page layouts (Landing.astro)
    ├── pages/             # Route pages
    └── styles/            # Global CSS (dark theme variables)
```

## Deployment

Deployment is automated via GitHub Actions (`.github/workflows/deploy-website.yml`). The workflow triggers on pushes to `main` when files in `website/` or `official_doc/` change.

Pipeline steps: checkout → pnpm install → sync-docs → build → deploy to GitHub Pages.
