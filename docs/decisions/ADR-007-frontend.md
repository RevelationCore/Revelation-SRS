# ADR-007: Frontend Framework and UI

**Status**: Accepted
**Date**: 2026-06-04

## Context

Phase 10 requires a student-facing portal and a staff administrative interface. Both must meet WCAG 2.1 Level AA (principle §15). The frontend stack must be open source, TypeScript-based (consistent with ADR-001), and produce accessible, responsive interfaces. Server-side rendering is not a hard requirement at this stage; a client-side single-page application consuming the REST APIs is appropriate.

## Decision

**React 18 + TypeScript + Vite** as the frontend framework and build toolchain.
**Radix UI** as the accessible headless component primitive library.
**Tailwind CSS** for styling.

## Rationale

**React 18 + TypeScript**
- Widest contributor pool of any frontend framework; maximises open source participation.
- Mature, stable ecosystem with TypeScript support as a first-class concern.
- Component model aligns well with the role-based UI surfaces required (student portal vs staff admin).
- Free and open source (MIT licence).

**Vite**
- Fast development server and production build toolchain; TypeScript-first.
- Replaces Create React App (deprecated); the current community standard.
- Free and open source (MIT licence).

**Radix UI**
- Headless accessible component primitives; WCAG 2.1 AA accessibility is built into the primitives (keyboard navigation, ARIA attributes, focus management).
- Unstyled by default — full visual control via Tailwind without fighting default styles.
- Covers all required component types: dialogs, menus, forms, tables, date pickers.
- Free and open source (MIT licence).

**Tailwind CSS**
- Utility-first CSS; predictable, purge-safe output; no global style side effects.
- Works naturally with Radix UI's unstyled primitives.
- Free and open source (MIT licence).

## Alternatives Considered

| Option | Reason rejected |
|---|---|
| Next.js | Server-side rendering adds deployment complexity not yet required; React remains an option to migrate to Next.js later if SSR is needed |
| SvelteKit | Lighter and arguably more elegant; smaller contributor pool; fewer accessible component libraries |
| Angular | TypeScript-native but heavy framework; low contributor appeal for open source |
| MUI / Ant Design | Styled component libraries; opinionated visual design harder to adapt to institutional branding; accessibility less controllable |

## Consequences

- All UI components are built on Radix UI primitives; no custom focus trap, ARIA role, or keyboard handler logic is written from scratch.
- Automated accessibility scanning (`axe-core` via `@axe-core/react`) runs in development and in CI against all rendered component trees.
- Tailwind configuration defines a design token system (colours, spacing, typography) that supports institutional theme customisation per tenant.
- The frontend application is a static build served from a CDN or web server container; it communicates exclusively with the SRS REST API.
- Shared TypeScript types between the frontend and backend are published from the API service's OpenAPI spec via code generation, keeping the frontend in sync with the API contract.
