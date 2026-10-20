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
  Label workbench (`features/label`, layout in `labelWorkbench.css`), and the
  workspace-independent 图库与提示词 page (`features/gallery`, Chinese UI).

## Stylesheets

Every stylesheet sits in a cascade layer, declared once in `ui/layers.css`:

- `app` — tokens, base element styles, shared components and every feature page.
- `label` — the label workbench (`features/label/labelWorkbench.css`), which
  restyles the box-label editor it embeds. A later layer wins regardless of
  specificity, so no rule needs ids or `!important` to take precedence.

Load order: `main.tsx` imports the global sheets first (`ui/tokens.css`, `ui/base.css`,
`ui/components.css`, and `ui/tool-page.css` for the classes shared by the older tool
pages), so every component and feature stylesheet loads after them. Each component
imports its own folder's stylesheet (`shell.css`, `gallery.css`, `boxLabel.css`, …);
the image workspace pages share `features/image-workspace/imageWorkspace.css`.

Rules of thumb:

- A rule belongs to the folder that renders its first class; no stylesheet restyles
  another feature's classes.
- `ui/base.css` keeps element defaults at element-level specificity (`:where()` for
  its `:not()` chains), so any component class overrides them.
- `!important` is reserved for policies that must beat everything: the `[hidden]`
  attribute, the arrow cursor on controls, reduced motion, and print.

New code uses tokens only — no hex values. Remaining literals are intentional (e.g.
text on image thumbnails).

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

One CSS grid (`.label-workbench-body`): media rail | canvas column |
right column. The surface wrappers (`.label-content`, `.app`, `main.workspace`) use
`display: contents` so `BoxLabelView`'s sections land in that grid. Review actions
render in the canvas header via `previewHeaderActions`; sampling / auto-label /
stats live in the tabbed `WorkbenchDock` under the canvas.
