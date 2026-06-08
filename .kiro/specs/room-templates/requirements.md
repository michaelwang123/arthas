# Requirements Document

## Introduction

Room Templates is a frontend-focused feature for the Arthas Hub that provides pre-configured room creation shortcuts. Instead of manually filling out creation parameters each time, users can select a visually engaging template card in the Hub page to instantly create a room with sensible defaults (title, tags, expiry, ephemeral mode, password settings). This lowers the barrier to room creation and makes the Hub feel more guided and inviting.

The template cards use advanced CSS animations (pulse-glow, shimmer, hover transforms, staggered fade-in) from the project's animation system to create a visually impressive, engaging UI section in the Hub. The implementation is pure frontend — templates simply pre-fill the `createRoom()` parameters with no backend protocol changes required.

## Glossary

- **Template_Card**: A visually distinct, animated UI card in the Hub page representing a room template that users can click to create a room with pre-filled parameters
- **Template_Config**: A static data structure defining a room template's preset parameters (title, tags, expiry duration, ephemeral time, password requirement, theme color, emoji icon)
- **Template_Grid**: The responsive grid layout section in the Hub page that displays all available Template_Cards
- **Hub_Client**: The React web client (arthas-client) extended with the template selection UI
- **Room_Creator**: A user who clicks a Template_Card to create a room from the template
- **Animation_System**: The set of CSS keyframe animations (pulse-glow, shimmer, fade-in-up, hover transforms) used to enhance Template_Card visual presentation
- **Pre-fill**: The action of populating the room creation parameters from a Template_Config, allowing the user to optionally modify values before confirming creation

## Requirements

### Requirement 1: Template Data Configuration

**User Story:** As a developer, I want room templates defined as a static configuration, so that templates can be easily added, modified, or removed without code changes to multiple components.

#### Acceptance Criteria

1. THE Hub_Client SHALL define a template configuration array containing all available room templates as a single source of truth.
2. THE Hub_Client SHALL include the following templates: 💼 面试模拟 (Interview Prep), 🐛 Debug 求助 (Debug Help), 🔄 团队回顾 (Team Retro), 💭 匿名反馈 (Anonymous Feedback), 🎓 Study Room, ☕ Coffee Chat, 🎮 Game Night.
3. WHEN defining each Template_Config, THE Hub_Client SHALL specify: emoji icon, display name (i18n key), description (i18n key), preset tags, expiry duration in seconds, ephemeral time in seconds (0 for disabled), and whether password protection is recommended.
4. THE Hub_Client SHALL store template configurations as a TypeScript constant with strict typing (no `any` types).

### Requirement 2: Template Card Display in Hub

**User Story:** As a user, I want to see room templates displayed as visually distinct cards in the Hub page, so that I can quickly identify and select a template to create a room.

#### Acceptance Criteria

1. THE Hub_Client SHALL display the Template_Grid section in the Hub page above the public room listings and below the Daily Topic card.
2. THE Hub_Client SHALL render each Template_Card showing: the emoji icon, template name, a short description, and key preset indicators (e.g., expiry time badge, ephemeral badge, password badge).
3. THE Hub_Client SHALL use a responsive grid layout: 2 columns on mobile (sm), 3 columns on medium screens (md), 4 columns on large screens (lg).
4. THE Hub_Client SHALL display a section header (e.g., "快速创建" / "Quick Create") above the Template_Grid to distinguish it from the public room listings.

### Requirement 3: Template Card Animations and Visual Effects

**User Story:** As a user, I want the template cards to have impressive animations and visual effects, so that the Hub feels engaging and polished.

#### Acceptance Criteria

1. WHEN the Template_Grid first appears in the viewport, THE Hub_Client SHALL animate each Template_Card with a staggered fade-in-up effect (each card delayed by 100-150ms from the previous one).
2. WHEN a user hovers over a Template_Card, THE Hub_Client SHALL apply a hover transform: translate upward by 4px, brighten the border color, and display a gradient overlay with a smooth 200-300ms transition.
3. THE Hub_Client SHALL apply a subtle pulse-glow animation to the emoji icon area of each Template_Card, using the card's theme color for the glow effect.
4. THE Hub_Client SHALL apply a shimmer sweep animation across the Template_Card background that cycles every 3-4 seconds to add visual interest.
5. WHILE the user has `prefers-reduced-motion: reduce` set in their operating system preferences, THE Hub_Client SHALL disable all continuous animations (pulse-glow, shimmer) and reduce transition durations to near-zero.
6. THE Hub_Client SHALL primarily use `transform` and `opacity` properties for animations to ensure GPU-accelerated rendering. The exception is `box-shadow` animation, which SHALL be limited to small icon areas (≤64px) for the pulse-glow effect.

### Requirement 4: Template Selection and Room Creation Flow

**User Story:** As a user, I want to click a template card and quickly create a room with the template's preset parameters, so that I can start a room without manual configuration.

#### Acceptance Criteria

1. WHEN a user clicks a Template_Card, THE Hub_Client SHALL prompt the user for a nickname (using the existing Hub nickname prompt pattern with localStorage persistence).
2. WHEN the user confirms their nickname after selecting a template, THE Hub_Client SHALL call `createRoom()` with the template's preset parameters: the user's nickname as their display name, the template's expiry duration, the template's ephemeral time, and the template's public listing data (title from template name, description from template description, tags from template preset tags).
3. WHEN a template has password protection recommended (e.g., Team Retro), THE Hub_Client SHALL show a password input field in the nickname prompt, allowing the user to optionally set a password.
4. IF the room creation fails (e.g., server error, Hub full), THEN THE Hub_Client SHALL display a descriptive error message inline in the nickname prompt area without navigating away from the Hub page.
5. WHILE the room creation is in progress (async operation), THE Hub_Client SHALL disable the confirm button and display a loading indicator to prevent duplicate submissions.
6. WHEN the room creation succeeds (chatStore.roomId becomes non-null), THE Hub_Client SHALL reactively navigate the user to the chat view via the existing pageStore routing mechanism.
7. IF room creation does not succeed within 10 seconds, THE Hub_Client SHALL reset the loading state and display a timeout error message, allowing the user to retry.

### Requirement 5: Template Preset Parameters

**User Story:** As a user, I want each template to have sensible default parameters for its use case, so that the created room is immediately suitable for my intended activity.

#### Acceptance Criteria

1. THE Hub_Client SHALL configure the "💼 面试模拟" template with: 60-minute expiry, ephemeral mode enabled (60s), no password, tags ["interview", "practice"].
2. THE Hub_Client SHALL configure the "🐛 Debug 求助" template with: no expiry, ephemeral mode disabled, no password, tags ["debug", "help"].
3. THE Hub_Client SHALL configure the "🔄 团队回顾" template with: no expiry, ephemeral mode disabled, password recommended, tags ["team", "retro"].
4. THE Hub_Client SHALL configure the "💭 匿名反馈" template with: 24-hour expiry, ephemeral mode enabled (30s), no password, tags ["anonymous", "feedback"].
5. THE Hub_Client SHALL configure the "🎓 Study Room" template with: 2-hour expiry, ephemeral mode disabled, no password, tags ["study", "focus"].
6. THE Hub_Client SHALL configure the "☕ Coffee Chat" template with: 30-minute expiry, ephemeral mode disabled, no password, tags ["chat", "casual"].
7. THE Hub_Client SHALL configure the "🎮 Game Night" template with: no expiry, ephemeral mode disabled, no password, tags ["game", "fun"].

### Requirement 6: Internationalization Support

**User Story:** As a user in a non-English locale, I want template names and descriptions shown in my language, so that I can understand and use templates without a language barrier.

#### Acceptance Criteria

1. THE Hub_Client SHALL use the existing i18n translation system (`useTranslation` hook) for all template display text (names, descriptions, section headers, button labels).
2. THE Hub_Client SHALL provide Chinese (zh) and English (en) translations for all template names and descriptions. Japanese (ja) locale keys SHALL be added with English fallback text to satisfy the compile-time type checking constraint.
3. WHEN the user's locale changes, THE Hub_Client SHALL immediately re-render Template_Cards with the updated language.

### Requirement 7: Accessibility Compliance

**User Story:** As a user relying on assistive technology, I want the template cards to be keyboard-navigable and screen reader accessible, so that I can use the feature without a mouse.

#### Acceptance Criteria

1. THE Hub_Client SHALL make each Template_Card focusable via keyboard navigation (Tab key).
2. WHEN a Template_Card receives keyboard focus, THE Hub_Client SHALL display a visible focus indicator (focus ring).
3. WHEN a user presses Enter or Space on a focused Template_Card, THE Hub_Client SHALL trigger the same action as a click (open nickname prompt).
4. THE Hub_Client SHALL assign appropriate ARIA attributes to the Template_Grid (role="list") and each Template_Card (role="listitem") with an accessible label describing the template name and key properties.
5. THE Hub_Client SHALL mark decorative emoji icons with `aria-hidden="true"` to prevent screen reader verbosity.

