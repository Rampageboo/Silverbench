# UI design system (desktop app)

Replaces the earlier "liquid glass" layer. Applies to `apps/desktop`.

## Structure

- **Shell** (`src/app/WorkbenchBody.tsx`, `src/app/shell/`): labeled sidebar grouped by
  pipeline stage (Data → Annotate → Curate → Ship → Automate), workspace switcher
  (versions, open, new, recent), Ctrl+K command palette, status footer (backend,
  voice/gesture). Every tool is one click from the sidebar; there are no hub pages.
- **Navigation model** (`src/app/navigation.ts`): the only place that lists nav items.
  Tool registration stays in `src/types/tools.ts` + `src/app/toolRegistry.tsx`.
- **Pages**: Start (`features/home`), Overview and Classes (`features/library`),
  Label workbench (`features/label`, layout in `labelWorkbench.css`).

## CSS layers (load order in `main.tsx`)

1. `legacy-web.css` — vendored copy of `legacy/web/styles.css` (the legacy web/Qt
   mode keeps its own file). Layout rules for older tool pages.
2. `styles.css` — legacy React tool page layouts.
3. `ui/tokens.css` — all colors, type, spacing, radii. Also maps the old variable
   names (`--bg`, `--panel`, `--ink`, `--blue`…) onto the tokens.
4. `ui/base.css` — element defaults and the generic legacy classes (`.panel`,
   `.hint`, `button.primary`…).
5. `ui/components.css` — `ui-*` components (dialog, menu, seg, badge, field, page).
6. Feature CSS imported by the feature (`shell.css`, `library.css`, …).

New code uses tokens only — no hex values. Legacy files were swept from hard-coded
slate/blue colors to tokens; remaining literals are intentional (e.g. text on
image thumbnails).

## Tokens

Themes: `graphite` (dark, default) and `paper` (light), set on `<html data-theme>`.
Older stored values (`dark`, `obsidian`) map to graphite.

- Surfaces: `--c-sunken < --c-bg < --c-surface < --c-raised < --c-overlay`
- Text: `--c-text`, `--c-text-2`, `--c-text-3`, `--c-text-disabled`
- Accent (signal lime): `--c-accent`, `--c-accent-text` (for text), `--c-on-accent`
  (text on a filled accent), `--c-accent-soft`, `--c-accent-line`
- Status: `--c-danger|warn|ok|info` (+ `-soft`)
- Type: `--fs-2xs…--fs-2xl`, `--font-ui`, `--font-mono` (ids, paths, counts, timecodes)

## Button rules

- `button` — neutral.
- `button.primary` — tinted accent. Legacy pages use it liberally, so it is calm.
- `.ui-btn--solid` — filled accent; one per view, for the main action.
- `.danger`, `.ui-btn--ghost`, `.ui-btn--sm`, `.ui-btn--icon`.

## Label workbench

One CSS grid (`#labelWorkbench .label-workbench-body`): media rail | canvas column |
right column. The surface wrappers (`.label-content`, `.app`, `main.workspace`) use
`display: contents` so `BoxLabelView`'s sections land in that grid. Review actions
render in the canvas header via `previewHeaderActions`; sampling / auto-label /
stats live in the tabbed `WorkbenchDock` under the canvas.
