# AGENTS.md — Ahmadiwebsite

Persian-first (RTL) static site for «دین صلح و نور احمدی». Plain HTML/CSS/JS — no
build step, no framework. Deployed to GitHub Pages from `main` via
`.github/workflows/deploy.yml`.

## Commands

There is no package manager or bundler. To preview locally (a server is
required for ES modules and PDF fetching — `file://` will not work):

```bash
python3 -m http.server 8080
# then open http://localhost:8080/
```

Deploy: push to `main` (workflow deploys automatically). The workflow aborts if
`sources/` ever exists in the checkout — `sources/` is the private working
folder and is gitignored.

## Architecture

- `assets/css/style.css` — the whole design system (orange identity, RTL,
  light/dark via `[data-theme]` tokens) plus the `pr-*` reader styles.
- `assets/js/main.js` — site behavior: theme toggle (`ahmadi-theme` in
  localStorage), mobile nav, accordion groups, reveal-on-scroll, reading
  progress, back-to-top, service-worker registration (HTTPS only).
- `assets/js/pdf-core.js` — pure functions adapted from **Veil**
  (https://github.com/simoneamico-ux-dev/veil, MIT): image-region extraction
  from the PDF operator list, two-layer dark-mode compositing, already-dark
  page detection, Persian-aware search normalization.
- `assets/js/pdf-reader.js` — the in-site reader (`reader.html`): PDF.js
  5.4.149 loaded from the full `pdfjs-dist` npm package via jsDelivr (build,
  `cmaps/`, `standard_fonts/`, `iccs/`, `wasm/` — cdnjs only mirrors the build
  files and breaks Persian/Arabic glyph mapping), fit-width continuous scroll
  with page virtualization, Veil-style dark mode (base canvas
  `invert(0.86) hue-rotate(180deg)`, overlay canvas repaints original image
  pixels), text selection via pdf.js TextLayer, search with Persian
  normalization, zoom, fullscreen, position memory (`ahmadi-reader-pos` in
  localStorage).
- `assets/pdf/index.json` — book registry consumed by the reader
  (`?book=<id>`; `?src=<url>` reads any URL). Candidate sources per book:
  local file first, official download URL as fallback.
- `manifest.json` / `sw.js` — minimal PWA: network-first shell, PDFs are
  network-first (byte-range requests bypass the SW entirely), images/fonts are
  cache-first. Bump `VERSION` in `sw.js` on every deploy so stale reader JS
  and cached PDFs are evicted.

## Conventions

- All user-facing text is Persian (fa-IR); pages use `dir="rtl"`.
- Shared header/footer/icon-sprite markup is duplicated per page by design
  (static site, no templating). Keep edits in sync across all pages.
- Keep the existing legacy class vocabulary (`.card`, `.btn`, `.steps`,
  `.covenant-*`, `.faq-list`, …) when styling; new components use their own
  prefix (`.hero__*`, `.pr-*`, `.ornament`).
- Respect `prefers-reduced-motion` for any animation you add.
- Never commit PDFs into `sources/`; publishable book files live in
  `assets/pdf/` (see its README).

## Gotchas

- `index.html` and every page starts with an inline theme-boot script — keep
  it first in `<head>` to avoid theme flashing.
- The reader page is `noindex` and excluded from `sitemap.xml`.
- Telegram links (`t.me/...`) and official download links
  (`theahmadireligion.org/download/...`) must keep their existing URLs.
