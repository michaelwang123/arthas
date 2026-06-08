# Implementation Plan: Room Templates

## Overview

Implement a "Quick Create" section in the Arthas Hub page with animated template cards that let users create rooms with pre-configured parameters. The implementation is pure frontend TypeScript/React — a static template configuration drives the UI, which pre-fills the existing `createRoom()` API. New components live in an isolated `src/hub/templates/` directory.

## Tasks

- [x] 1. Set up template module and core configuration
  - [x] 1.1 Create `templateConfig.ts` with `TemplateConfig` interface and `ROOM_TEMPLATES` constant
    - Create `src/hub/templates/templateConfig.ts`
    - Define `TemplateThemeColor` type union and `TemplateConfig` interface with strict typing (no `any`)
    - Define `ROOM_TEMPLATES` readonly array with all 7 templates and their exact preset values
    - Ensure all fields match the design: id, emoji, nameKey, descriptionKey, tags, expirySeconds, ephemeralSeconds, passwordRecommended, themeColor
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 1.2 Write property test for template config completeness
    - **Property 1: Template Config Completeness**
    - Use `fast-check` to generate random indices into ROOM_TEMPLATES and verify all fields are present with valid types/values
    - Assert: non-empty emoji, non-empty nameKey, non-empty descriptionKey, tags array with ≥1 string, expirySeconds ≥ 0, ephemeralSeconds ≥ 0, boolean passwordRecommended, valid themeColor
    - Create test in `src/hub/templates/templateConfig.test.ts`
    - **Validates: Requirements 1.3**

- [x] 2. Add i18n translations for all template strings
  - [x] 2.1 Add template translation keys to locale files (en, zh, ja) and update type definitions
    - Add all `hub.templates.*` keys to `en.json` with English text
    - Add all `hub.templates.*` keys to `zh.json` with Chinese text
    - Add all `hub.templates.*` keys to `ja.json` with English fallback text (satisfies compile-time type checking)
    - Keys include: sectionTitle, each template's name/desc, badge labels (expiry, ephemeral, password), createButton, cancel, error.timeout
    - Update the i18n type definition file (e.g., `src/i18n/types.ts` or the `TranslationKey` type in `locales/index.ts`) to include the new keys, ensuring TypeScript compile-time enforcement across all locales
    - Run `npx tsc --noEmit` to verify no type errors with new keys
    - _Requirements: 6.1, 6.2_

- [x] 3. Add Tailwind animation configuration
  - [x] 3.1 Add keyframes and animation utilities to `tailwind.config.js`
    - Add `fade-in-up` keyframe (opacity 0 → 1, translateY 20px → 0)
    - Add `pulse-glow` keyframe (box-shadow cycling with CSS variable `--glow-color`)
    - Add `shimmer` keyframe (backgroundPosition sweep -200% → 200%)
    - Add corresponding animation utility classes with appropriate durations
    - _Requirements: 3.1, 3.3, 3.4_

- [x] 4. Implement TemplateCard component
  - [x] 4.1 Create `TemplateCard.tsx` with animations, badges, and accessibility
    - Create `src/hub/templates/TemplateCard.tsx`
    - Render emoji icon with pulse-glow animation using theme color as `--glow-color` CSS variable
    - Display translated template name and description via `useTranslation`
    - Show preset indicator badges (expiry time, ephemeral, password)
    - Apply shimmer background animation cycling every 3-4 seconds
    - Apply hover transform (translateY -4px, border brighten, gradient overlay) with 200-300ms transition
    - Accept `index` prop and apply staggered `animation-delay` via inline style for fade-in-up
    - Set initial `opacity: 0` class to prevent flash before animation
    - Make card focusable (tabIndex=0), handle Enter/Space key to trigger onSelect
    - Apply ARIA attributes: role="listitem", aria-label with template name, aria-hidden="true" on emoji
    - Apply `motion-reduce:animate-none` for prefers-reduced-motion compliance
    - **Done when:** card renders with all 7 templates showing emoji + name + description + badges; keyboard Enter/Space triggers onSelect; ARIA attributes present; animations visible (pulse-glow on emoji, shimmer on background, hover lift); `motion-reduce:animate-none` applied
    - _Requirements: 2.2, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 4.2 Write property test for accessibility structure
    - **Property 4: Accessibility Structure**
    - Render each template card, verify: element is focusable (tabIndex 0 or interactive), has role="listitem", has aria-label containing template name, emoji element has aria-hidden="true"
    - Create test in `src/hub/templates/TemplateCard.test.tsx`
    - **Validates: Requirements 7.1, 7.4, 7.5**

  - [x] 4.3 Write property test for keyboard activation equivalence
    - **Property 5: Keyboard Activation Equivalence**
    - For each template card, simulate Enter and Space keypresses on focused card, verify handler called same as click
    - Mock strategy: pass a `vi.fn()` as `onSelect` prop, fire keyboard events via `@testing-library/react`'s `fireEvent.keyDown`
    - **Validates: Requirements 7.3**

  - [x] 4.4 Write property test for reduced-motion compliance
    - **Property 6: Reduced-Motion Compliance**
    - Mock `prefers-reduced-motion: reduce` via `vi.stubGlobal('matchMedia', ...)` or `window.matchMedia` mock
    - Render each template card, verify continuous animations (pulse-glow, shimmer) are disabled and transitions have near-zero duration
    - **Validates: Requirements 3.5**

- [x] 5. Implement TemplateNicknamePrompt component
  - [x] 5.1 Create `TemplateNicknamePrompt.tsx` with nickname input, optional password, and validation
    - Create `src/hub/templates/TemplateNicknamePrompt.tsx`
    - Display selected template emoji and name for context
    - Render nickname input with localStorage persistence (key: `arthas_hub_nickname`)
    - Conditionally render password input when `template.passwordRecommended` is true (password is optional — user may leave the field empty and still submit)
    - Validate nickname (1-20 chars, non-empty) — disable confirm until valid. Password has no minimum length requirement (empty is valid).
    - Handle Enter key submission
    - Disable confirm button and show loading spinner when `isCreating` is true
    - Display `createError` inline in red below confirm button when non-null
    - Render cancel button to dismiss prompt
    - _Requirements: 4.1, 4.3, 4.4, 4.5_

- [x] 6. Implement TemplateGrid component
  - [x] 6.1 Create `TemplateGrid.tsx` with responsive grid layout and prompt state management
    - Create `src/hub/templates/TemplateGrid.tsx`
    - Render translated section header ("Quick Create" / "快速创建")
    - Map `ROOM_TEMPLATES` to `TemplateCard` components with stagger index
    - Use responsive grid: `grid-cols-2 md:grid-cols-3 lg:grid-cols-4`
    - Apply `role="list"` to the grid container
    - Manage internal state: `selectedTemplate` (null or TemplateConfig)
    - When `selectedTemplate` is set, render `TemplateNicknamePrompt`
    - Pass `isCreating`, `createError`, `onConfirm`, `onCancel` to prompt
    - Reset `selectedTemplate` to null on cancel
    - _Requirements: 2.1, 2.3, 2.4, 7.4_

- [x] 7. Checkpoint — verify components compile and render
  - Run `npx tsc --noEmit` in `arthas-client/` to verify no TypeScript errors in `src/hub/templates/`
  - Run `npm run test` in `arthas-client/` to verify all existing and new tests pass
  - Render TemplateGrid in a quick test (e.g., `render(<TemplateGrid ... />)` in a test file) to confirm no runtime throws

- [x] 8. Integrate TemplateGrid into Hub page with room creation logic
  - [x] 8.1 Wire `TemplateGrid` into `Hub.tsx` with createRoom handler, error detection, and navigation
    - Read current `Hub.tsx` to understand the existing layout and import patterns
    - Import `TemplateGrid` from `'../hub/templates/TemplateGrid'`
    - Import `TemplateConfig` from `'../hub/templates/templateConfig'` (type-only import)
    - Import `createRoom` from chatStore (currently Hub only uses `joinRoom` — this adds room CREATION to the Hub page)
    - Render `<TemplateGrid>` between the daily topic nickname prompt section and `<HubFilters />` section
    - Implement `handleCreateFromTemplate` callback: calls `chatStore.createRoom()` with template parameters mapped correctly
    - Add `isCreating` state and 10-second timeout safety net (resets state, shows timeout error)
    - **CRITICAL: Guard roomId navigation with `if (roomId && isCreating)`** — roomId may be non-null from a previous session; only navigate when we are actively creating a room from a template
    - Add `useEffect` to detect `roomId` becoming non-null **while `isCreating` is true** → navigate to chat via `pageStore`
    - Add `useEffect` to detect system error messages from chatStore → set error state
    - Clear timeout on success or error detection
    - _Requirements: 4.2, 4.4, 4.5, 4.6, 4.7_

  - [x] 8.2 Write property test for template-to-createRoom parameter mapping
    - **Property 2: Template-to-CreateRoom Parameter Mapping**
    - Use `fast-check` to generate random valid nicknames (1-20 chars) × random template selection
    - Verify `createRoom()` is called with: nickname as name, template.ephemeralSeconds as ephemeral, template.expirySeconds as expiry, publicData with translated nameKey as title, translated descriptionKey as description, template.tags as tags
    - Mock strategy: use `vi.mock('../stores/chatStore')` to mock the zustand store, or use `useChatStore.setState()` to inject a mocked `createRoom` function
    - **Validates: Requirements 4.2**

  - [x] 8.3 Write property test for i18n key completeness
    - **Property 3: i18n Key Completeness**
    - For each template, resolve nameKey and descriptionKey through the translation system for both `zh` and `en` locales
    - Assert all resolved strings are non-empty
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. Final checkpoint — verify full feature integration
  - Run `npx tsc --noEmit` in `arthas-client/` to confirm zero TypeScript errors across the project
  - Run `npm run test` in `arthas-client/` to confirm all tests pass (including new property tests)
  - Verify no console errors when rendering Hub page with template grid (render Hub in a test with mocked stores)

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP (except 8.2 which is mandatory — it validates the core createRoom parameter mapping)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation with concrete commands
- Property tests validate universal correctness properties from the design document
- The design uses TypeScript/React — all implementation uses these languages
- No backend changes required; this is a pure frontend feature
- All new code goes in `src/hub/templates/` directory, isolated from existing logic
- Follow existing project patterns: `useTranslation` hook, `chatStore` for room creation, `pageStore` for navigation
- **Zustand mocking strategy for tests**: Use `useChatStore.setState({ createRoom: vi.fn() })` to inject mocks without full module mocking, or `vi.mock()` for isolation
- **Hub.tsx currently only uses `joinRoom`** — Task 8.1 introduces `createRoom` import, which is an architectural addition to the Hub page

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "4.1", "5.1"] },
    { "id": 2, "tasks": ["4.2", "4.3", "4.4", "6.1"] },
    { "id": 3, "tasks": ["8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3"] }
  ]
}
```
