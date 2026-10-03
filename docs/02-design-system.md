# Design system

> **Sophisticated underneath. Extremely simple on the surface.**
>
> **Dark is the primary trading experience.**

Source: `packages/ui` (`@repo/ui`). Tokens live in `packages/ui/src/styles/tokens.css` (values) and
`packages/ui/src/styles.css` (Tailwind mapping, type, radius, motion, utilities).

## Brand identity

Simple, fast, trustworthy, modern, clear, premium, trader-focused. The product name comes only from
`brand` in `@repo/config`. The logo mark is an inline SVG (`apps/web/components/brand-logo.tsx`) that
uses the brand tokens, and `apps/web/app/icon.svg` is the favicon.

## Brand color architecture

Brand color is **Deep Teal**, defined once as a palette:

| Palette token            | Value     |
| ------------------------ | --------- |
| `--palette-brand-strong` | `#115E59` |
| `--palette-brand`        | `#0F766E` |
| `--palette-brand-accent` | `#14B8A6` |

Components only use semantic tokens (`brand`, `brand-hover`, `brand-active`, `brand-soft`,
`brand-soft-text`, `brand-contrast`), which each theme maps to the palette. **To re-brand, change the
three palette values.** No component changes are needed. Tailwind's default color palette is removed, so
`bg-teal-500`-style classes do not compile.

## Color tokens

Utilities: `bg-*`, `text-*`, `border-*`, e.g. `bg-surface`, `text-text-secondary`, `border-border`.

| Token              | Light     | Dark      | Use                                       |
| ------------------ | --------- | --------- | ----------------------------------------- |
| `background`       | `#F8FAFC` | `#0B0F14` | Page                                      |
| `surface`          | `#FFFFFF` | `#111820` | Cards, inputs, bottom nav                 |
| `surface-elevated` | `#FFFFFF` | `#17212B` | Dialogs, menus, toasts                    |
| `surface-muted`    | `#F1F5F9` | `#1A2530` | Hover fills, skeletons, disabled fields   |
| `text-primary`     | `#0F172A` | `#F8FAFC` | Main text                                 |
| `text-secondary`   | `#64748B` | `#94A3B8` | Supporting text                           |
| `text-muted`       | `#8A97AB` | `#6B7A8F` | Placeholders and decoration only (not AA) |
| `border`           | `#E2E8F0` | `#263340` | Default borders                           |
| `border-strong`    | `#CBD5E1` | `#36475A` | Inputs, secondary buttons                 |
| `brand`            | `#0F766E` | `#14B8A6` | Primary actions, active navigation        |
| `brand-contrast`   | `#FFFFFF` | `#04201D` | Text on brand (dark text keeps AA)        |
| `success` / `up`   | `#16A34A` | `#22C55E` | Success and UP: fills, icons, indicators  |
| `danger` / `down`  | `#DC2626` | `#EF4444` | Errors and DOWN: fills, icons, indicators |
| `warning`          | `#D97706` | `#F59E0B` | Warnings: fills, icons, indicators        |
| `info`             | `#0284C7` | `#38BDF8` | Information: fills, icons, indicators     |
| `success-text`     | `#14713A` | `#22C55E` | Success text (also `up-text`)             |
| `danger-text`      | `#B91C1C` | `#F87171` | Error text (also `down-text`)             |
| `warning-text`     | `#A44A08` | `#F59E0B` | Warning text                              |
| `info-text`        | `#0369A1` | `#38BDF8` | Information text                          |
| `danger-solid`     | `#DC2626` | `#DC2626` | Destructive button fill (white text)      |

The base status colors are the specified brand values. They are used for fills, icons (at least 3:1)
and indicators. The `*-text` tokens are darker in light mode (and lighter for danger in dark mode) so
status text meets WCAG AA on surfaces and status tints. `up`/`down` alias success/danger for trading
direction. Brand teal is never used for outcomes, and green and red are never used for branding.

## Themes

- **Light**, **Dark** and **System** (follows the OS).
- Defaults: the customer app (`/trade`, `/activity`, `/wallet`, `/profile`) defaults to **dark**, and
  public pages (`/`, `/blog`, `/faq`) default to **light**. A stored user choice overrides both. The
  admin app follows the system setting.
- Preference is stored in `localStorage` (`theme`). No API call is involved.
- **No flash:** `themeScript()` is inlined in `<head>` and sets `<html data-theme>` before first paint.
  `ThemeSync` re-applies it on navigation, on preference changes (including other tabs) and on OS theme
  changes. The script and runtime share one function (`applyTheme`).
- Switching is instant: transitions are suspended for one frame so all surfaces change together.
- `ThemeSelector` (Profile → Appearance) uses native radios, so it gets keyboard arrows for free.

## Typography

System font stack: no downloads. Semantic sizes only (Tailwind's default `text-*` scale is removed):

| Utility           | Size            | Weight | Use                         |
| ----------------- | --------------- | ------ | --------------------------- |
| `text-display`    | 32–40px (fluid) | 700    | Marketing headline          |
| `text-h1`         | 24px            | 650    | Page heading                |
| `text-h2`         | 18px            | 600    | Section heading             |
| `text-h3`         | 16px            | 600    | Card or sub heading         |
| `text-body`       | 16px            | 400    | Body, inputs (no iOS zoom)  |
| `text-body-small` | 14px            | 400    | Secondary text, buttons     |
| `text-caption`    | 13px            | 400    | Labels, captions            |
| `text-figure`     | 28px            | 650    | Important financial values  |

Vary weight before size. Use `tabular-nums` for numbers that change.

## Spacing

Tailwind's 4px scale (`gap-2` = 8px, `p-4` = 16px, …). Prefer 2, 3, 4, 6, 8, 10 and 16. `Stack` and
`Row` accept only `gap` values 0, 1, 2, 3, 4, 6, 8 and 10. Page content uses `Container` (16px mobile
padding, max 72rem).

## Radius

`rounded-sm` 8px (small controls, menu items) · `rounded-md` 12px (buttons, inputs) · `rounded-lg`
16px (cards, dialogs) · `rounded-full` (badges, avatars, pills). Nothing else.

## Elevation

Depth comes mostly from surface steps and borders: `background` → `surface` → `surface-elevated`.
Shadows are limited to two tokens, tuned per theme: `shadow-raised` (secondary buttons, selected
segments) and `shadow-overlay` (dialogs, menus, toasts, tooltips). No glassmorphism, no glow.

## Motion

| Token                                  | Use                                |
| -------------------------------------- | ---------------------------------- |
| `--duration-fast` (120ms)              | Hover, press, focus                |
| `--duration-base` (180ms)              | Dialogs, sheets, toasts, page fade |
| `--duration-slow` (240ms)              | Progress                           |
| `ease-standard`, `ease-out`, `ease-in` | Shared curves                      |

Utilities: `transition-control` (state transitions), `pressable` (0.97 scale on press), `focus-ring`.
Dialogs and sheets animate with CSS `@starting-style` (no animation library). Under
`prefers-reduced-motion`, animations and transitions become near-instant and press scaling is off.

## Components

`@repo/ui` exports: Button (variants `primary` · `secondary` · `tertiary` · `ghost` · `danger`, sizes
`md`/`lg`, `loading`, `icon`), `buttonStyles()` for links, IconButton, Input, PasswordInput,
NumberInput, Select, SearchInput, Tabs, Card, Badge, Dialog, BottomSheet, Dropdown, Tooltip,
ToastProvider/`useToast`, Separator, Divider, Avatar, Skeleton, Spinner, Progress, EmptyState,
ErrorState, PageHeader, Container, Stack, Row, ConnectionStatus, OfflineBanner/`useOnlineStatus`,
ThemeSelector, ThemeSync.

Principles:

- One component per concept with a small `variant` prop, rather than many components.
- Server-compatible by default; `"use client"` only where state or effects are required (inputs with
  toggles, Tabs, Dialog, Dropdown, Toast, theme, network).
- Every input requires a visible `label` (`hideLabel` keeps it for screen readers only). Placeholders
  are never labels. Errors set `aria-invalid` and are linked with `aria-describedby`.
- States: default, hover, focus-visible, pressed, disabled, loading, error. Loading buttons keep their
  width.
- Overlays use the native `<dialog>` (focus trap, Escape, inert background and top layer for free).
- **Icons:** Lucide only (`lucide-react`, imported per icon). Icon-only controls require a `label`.
  Important actions have text labels.
- **Feedback:** Skeleton for loading content, Spinner for short actions, Toast for results,
  ErrorState (`generic` | `network`) with a retry action, EmptyState that explains and offers a next
  step. Never show raw technical errors; log them (route error boundaries call `console.error`).
- **Network:** `ConnectionStatus` renders `connected` / `reconnecting` / `offline` for the future
  realtime layer; `OfflineBanner` shows the browser's offline state in the app shell.

## Accessibility

- Semantic landmarks (`header`, labelled `nav`, `main#main`), a skip link, and one `h1` per page.
- Visible `focus-visible` ring on every interactive element; keyboard support for Tabs (arrows,
  Home, End) and Dropdown (arrows, Home, End, Escape returns focus).
- Status never relies on color alone: badges and toasts have icons and text, Up/Down have arrows and
  words, and active navigation adds weight, an indicator and `aria-current="page"`.
- Contrast (measured): text tokens meet WCAG AA (at least 4.5:1) on their surfaces and status tints,
  except `text-muted` (decorative and placeholder only). Dark-theme brand buttons use dark text (6.9:1).
- Live regions: toasts (`aria-live="polite"`, errors as `role="alert"`), the offline banner, and
  spinners (`role="status"`).

## Responsive principles

Designed mobile-first from 320px, verified at 320, 375, 390, 430, 768, 1024 and 1440px.

- **Below 768px:** compact header (logo) and a fixed bottom navigation (icon + label, 64px tall,
  safe-area aware).
- **768px and up:** navigation moves into the header as labelled links; there is no bottom bar.
- Touch targets are at least 44px (`min-h-11`); large primary actions are 52px (`size="lg"`).
- Use fluid grids, `max-w-*` and `min-w-0` rather than fixed widths.

## Navigation

Customer app: Trade · Activity · Wallet · Profile (`apps/web/components/app-nav.tsx`, routes in
`apps/web/lib/routes.ts`). The public site has its own header (Blog, FAQ, Open app) and footer. The
trading screen will get its own compact header later.

## Performance rules

- Server Components by default; every page is statically prerendered.
- No web fonts, no animation library, no state-management library, and one icon library imported per
  icon.
- Tooltips, separators, cards, badges and layout primitives ship zero JavaScript.
- Images: `next/image` with explicit dimensions and AVIF/WebP (`apps/web/next.config.ts`). Keep large
  assets out of the repository.
- Page transitions: `loading.tsx` skeletons per route group and a 180ms fade from `(app)/template.tsx`.
