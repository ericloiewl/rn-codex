# RN Codex — Agent instructions

Single-page React + Vite app for viewing & correcting OCR results (scanned documents with bounding-box overlays). Deployed to GitHub Pages.

## Commands

| Command | Action |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build to `dist/` |
| `npm run lint` | ESLint (`.js`, `.jsx` only) |
| `npm run preview` | Serve built `dist/` locally |
| `npm run deploy` | `gh-pages -d dist` — publish to GitHub Pages |

CI (`.github/workflows/deploy.yml`): `npm ci` → `npm run build` → `configure-pages` → `upload-pages-artifact` on push to `main`.

## Architecture

- **No router** — single-page, state-driven views
- **Entry:** `src/main.jsx` → `src/App.jsx`
- **Components:** `BookGallery.jsx` (dataset gallery), `TranslateTool.jsx` (translation workflow)
- **Data:** `public/manifest.json` lists available datasets (`name`, `pdf`, `json`, `thumbnail`). Fetched from `import.meta.env.BASE_URL + 'manifest.json'`
- **Deploy base:** `vite.config.js` sets `base: '/rn-codex/'`
- **Mobile:** tab-based toggle between Image (檢視) and Text (文字) panels on `<768px` via `mobileTab` state; side-by-side 60/40 split on desktop

## Key conventions

- **No TypeScript** — all files are `.jsx` / `.js`
- **Tailwind CSS v4** — uses `@import "tailwindcss"` in `index.css` (no `tailwind.config.js` or `@tailwind` directives)
- **No formatter config** — no Prettier or other formatter
- **No tests** — no test runner or test files

## OCR JSON format

Expected shape:
```
layoutParsingResults[].prunedResult.{
  width, height,
  parsing_res_list[].{
    block_id, block_content, block_label,
    block_bbox, block_polygon_points (4 pts), group_id,
    translated_text  (added after translation workflow)
  }
}
```

## Translation workflow

1. Click "翻譯工具" → exports `to_translate.json` (array of `{key, src}`)
2. Translate externally, produce array of `{key, dst}`
3. Upload translated JSON → "套用到檢視器" merges into `translated_text` field

## Notable details

- PDF.js worker loaded dynamically: `pdfjs-dist/build/pdf.worker.min.mjs`
- Math rendering via KaTeX + `marked-katex-extension`
- Thumbnails in gallery fall back to icon on error (`onError` → `setFailed`)
- Zoom: Ctrl+wheel on desktop, pinch-to-zoom on mobile; "重置視角" resets to auto-fit
- Mobile tab switches preserve scroll position (`savedScrollTop`) and prevent `containerWidth` collapse via ResizeObserver guard (`if (w > 0)`)
- Edit buttons always visible on mobile (`max-md:opacity-100` override on `group-hover:opacity-100`)
- Text edits stored in-memory only; export JSON/TXT to persist
- Search has 500ms debounce; match highlighting via regex-escaped query
- Copy-to-clipboard via `Copy` icon on text rows
- Toast auto-dismisses after 4s; positioned at top-center on mobile, bottom-right on desktop
- Header secondary actions (export, translate) collapse into a `⋮` dropdown on mobile
