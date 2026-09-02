/* pdf-reader.js — client-side PDF reader for Ahmadiwebsite.
 *
 * Experience adapted from Veil (https://github.com/simoneamico-ux-dev/veil, MIT):
 *  - Two-layer dark mode: base canvas softly inverted via CSS
 *    (invert(0.86) hue-rotate(180deg)), overlay canvas repaints original
 *    image pixels so photos/charts/diagrams keep their true colors.
 *  - Already-dark pages are detected and skip inversion.
 *  - Everything runs in the browser; no server, no upload.
 *
 * Rendering: PDF.js (Mozilla) loaded as an ES module from cdnjs.
 * Virtual-scroll style rendering: only pages near the viewport keep live
 * canvases; far pages are evicted to keep memory flat on mobile.
 */

import {
  extractImageRegions,
  compositeImageRegions,
  detectAlreadyDark,
  normalizeLigatures,
  normalizeForSearch,
} from "./pdf-core.js";

const PDFJS_VERSION = "5.4.149";
const PDFJS_BASE = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/`;

/* Max concurrent page renders (desktop 2, mobile 1). */
const MAX_CONCURRENT = Math.min((navigator.hardwareConcurrency || 2), 2) >= 2 ? 2 : 1;
const RENDER_MARGIN = 1.5;   // viewports above/below kept rendered
const MAX_RENDERED = 12;     // rendered pages kept in memory
const GAP = 1.25;            // rem between pages

const faNum = (n) => Number(n).toLocaleString("fa-IR", { useGrouping: false });
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

const reduceMotion = window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- DOM ---------- */

const $ = (id) => document.getElementById(id);

const root = $("pr");
const titleEl = $("pr-title");
const viewport = $("pr-viewport");
const docEl = $("pr-doc");
const pageInput = $("pr-page-input");
const pageTotal = $("pr-page-total");
const btnPrev = $("pr-prev");
const btnNext = $("pr-next");
const btnZoomIn = $("pr-zoom-in");
const btnZoomOut = $("pr-zoom-out");
const btnZoomReset = $("pr-zoom-reset");
const zoomLabel = $("pr-zoom-label");
const btnDark = $("pr-dark");
const btnSearch = $("pr-search-toggle");
const btnFs = $("pr-fs");
const searchBox = $("pr-search");
const searchInput = $("pr-search-input");
const searchStatus = $("pr-search-status");
const searchNext = $("pr-search-next");
const searchPrev = $("pr-search-prev");
const searchClose = $("pr-search-close");
const progressFill = $("pr-progress-fill");
const loadingEl = $("pr-loading");
const loadingTitle = $("pr-loading-title");
const errorEl = $("pr-error");
const errorActions = $("pr-error-actions");
const toastEl = $("pr-toast");

/* ---------- State ---------- */

const state = {
  pdfjs: null,
  doc: null,
  book: null,
  numPages: 0,
  pagesMeta: [],      // {pw, ph, ratio} PDF units
  offsets: [],        // top position of each page (px)
  docHeight: 0,
  zoom: 1,
  page: 1,            // 1-based current page
  rendered: new Map(),// pageNum -> {wrapper, frame, base, overlay, text, task, regions:{scale, regions}, textBuilt}
  rendering: new Set(),
  pending: new Set(),
  alreadyDark: new Map(),
  regionsCache: new Map(),   // pageNum -> {scale, regions}
  textCache: new Map(),      // pageNum -> Promise<textContent>
  pageText: [],              // normalized text per page (search index)
  dark: null,                // null = follow site theme
  dpr: 1,
  search: { query: "", hits: [], at: -1 },
  posTimer: 0,
  lastWidth: 0,
};

/* ---------- Small helpers ---------- */

function toast(message, ms = 2600) {
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add("is-visible");
  clearTimeout(toast.__t);
  toast.__t = setTimeout(() => toastEl.classList.remove("is-visible"), ms);
}

function storageGet(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

function posStore() { return storageGet("ahmadi-reader-pos", {}); }

function savedPosition(bookId) {
  const all = posStore();
  return (bookId && all[bookId]) || null;
}

function savePosition() {
  if (!state.book) return;
  const all = posStore();
  all[state.book.id] = { page: state.page };
  storageSet("ahmadi-reader-pos", all);
}

function scrollBehavior() { return reduceMotion ? "auto" : "smooth"; }

/* ---------- Books ---------- */

const FALLBACK_BOOK = {
  id: "manifesto-fa",
  title: "مانیفست مهدی",
  author: "عبدالله هاشم (ابا الصادق)",
  sources: [
    "assets/pdf/The_Mahdis_Manifesto_Booklet_Farsi.pdf",
    "https://theahmadireligion.org/download/42616/?tmstv=1765124110",
  ],
  download: "https://theahmadireligion.org/download/42616/?tmstv=1765124110",
};

async function resolveBook() {
  const params = new URLSearchParams(location.search);
  const srcParam = params.get("src");

  if (srcParam) {
    const name = decodeURIComponent(srcParam.split("/").pop() || "document.pdf");
    return {
      id: "src:" + srcParam,
      title: name.replace(/\.pdf$/i, ""),
      author: "",
      sources: [srcParam],
      download: srcParam,
    };
  }

  let books = [];
  try {
    const res = await fetch("assets/pdf/index.json", { cache: "no-cache" });
    if (res.ok) books = await res.json();
  } catch { /* offline/fallback below */ }

  const wanted = params.get("book");
  const found = books.find((b) => b.id === wanted)
    || books.find((b) => b.alias && b.alias.includes(wanted))
    || books[0];

  if (found && !found.sources) {
    /* registry entries store a filename; build the candidate source list:
       local copy first (works on the deployed site and in local previews),
       then the official download URL as fallback. */
    found.sources = [];
    if (found.file) found.sources.push("assets/pdf/" + found.file);
    if (found.download) found.sources.push(found.download);
  }

  return found || FALLBACK_BOOK;
}

/* ---------- PDF.js bootstrap ---------- */

async function loadPdfjs() {
  const lib = await import(/* webpackIgnore: true */ PDFJS_BASE + "pdf.min.mjs");
  lib.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.min.mjs";
  return lib;
}

/* ---------- Document loading ---------- */

async function loadBook(book) {
  state.book = book;
  document.title = `${book.title} | کتاب‌خوان — دین صلح و نور احمدی`;
  if (titleEl) titleEl.textContent = book.title;
  if (loadingTitle) loadingTitle.textContent = `در حال آماده‌سازی «${book.title}»…`;

  let lastError = null;
  for (const src of book.sources) {
    try {
      await openDocument(src);
      return;
    } catch (err) {
      lastError = err;
      console.warn("[reader] source failed:", src, err);
    }
  }

  showError(lastError);
}

async function openDocument(src) {
  const pdfjs = await loadPdfjs();
  state.pdfjs = pdfjs;

  const task = pdfjs.getDocument({ url: src });
  const doc = await task.promise;

  state.doc = doc;
  state.numPages = doc.numPages;

  /* page sizes at scale 1 */
  state.pagesMeta = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    state.pagesMeta.push({ pw: vp.width, ph: vp.height, ratio: vp.height / vp.width });
  }

  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  state.page = 1;
  state.zoom = 1;
  state.pageText = [];
  state.alreadyDark.clear();
  state.regionsCache.clear();
  state.rendered.clear();
  state.rendering.clear();
  state.pending.clear();

  if (pageTotal) pageTotal.textContent = faNum(doc.numPages);

  buildLayout();
  applyInitialDark();

  loadingEl.hidden = true;

  /* resume position */
  const saved = savedPosition(book.id);
  if (saved && saved.page > 1 && saved.page <= doc.numPages) {
    gotoPage(saved.page, "auto");
    toast(`ادامه مطالعه از صفحه ${faNum(saved.page)}`);
  } else {
    viewport.scrollTop = 0;
    updatePageUi(1);
  }

  scheduleRender();

  /* build the search index in the background */
  buildSearchIndex();
}

function showError(err) {
  if (loadingEl) loadingEl.hidden = true;
  if (!errorEl) return;
  errorEl.hidden = false;

  if (errorActions) {
    errorActions.innerHTML = "";
    const add = (href, label, cls, external) => {
      const a = document.createElement("a");
      a.className = "btn " + cls;
      a.href = href;
      a.textContent = label;
      if (external) { a.target = "_blank"; a.rel = "noopener"; }
      errorActions.appendChild(a);
    };
    if (state.book && state.book.download) {
      add(state.book.download, "دانلود مستقیم کتاب", "btn--primary", true);
    }
    add("index.html", "بازگشت به خانه", "btn--ghost", false);
  }

  console.error("[reader] failed to open PDF:", err);
}

/* ---------- Layout ---------- */

function pageScale(i) {
  const meta = state.pagesMeta[i - 1];
  /* fit-width baseline against the document column (which is capped at
     64rem in CSS, so the viewport width would overshoot on desktop) */
  const base = Math.max(meta ? (docEl.clientWidth - 24) / meta.pw : 0.5, 0.1);
  return base * state.zoom;
}

function buildLayout() {
  const gapPx = GAP * parseFloat(getComputedStyle(document.documentElement).fontSize || "16");

  let y = 12; /* breathing room above the first page */
  state.offsets = [];

  for (let i = 1; i <= state.numPages; i++) {
    const meta = state.pagesMeta[i - 1];
    const scale = pageScale(i);
    const h = meta.ph * scale;
    state.offsets.push(y);
    y += h + gapPx;
  }

  state.docHeight = y + 20;
  docEl.style.height = state.docHeight + "px";

  /* (re)create page wrappers */
  docEl.querySelectorAll(".pr-page").forEach((el) => el.remove());
  state.rendered.clear();

  for (let i = 1; i <= state.numPages; i++) {
    const wrapper = document.createElement("div");
    wrapper.className = "pr-page is-loading";
    wrapper.dataset.page = String(i);
    wrapper.style.top = state.offsets[i - 1] + "px";

    const frame = document.createElement("div");
    frame.className = "pr-frame";

    const base = document.createElement("canvas");
    base.className = "pr-canvas pr-canvas--base";

    const overlay = document.createElement("canvas");
    overlay.className = "pr-canvas pr-canvas--overlay";

    const text = document.createElement("div");
    text.className = "pr-text";

    frame.append(base, overlay, text);
    wrapper.append(frame);
    docEl.append(wrapper);
  }

  sizeAllFrames();
}

function sizeAllFrames() {
  for (let i = 1; i <= state.numPages; i++) {
    const wrapper = docEl.querySelector(`.pr-page[data-page="${i}"]`);
    if (!wrapper) continue;
    const frame = wrapper.querySelector(".pr-frame");
    const scale = pageScale(i);
    const meta = state.pagesMeta[i - 1];
    const w = meta.pw * scale;
    const h = meta.ph * scale;
    frame.style.width = w + "px";
    frame.style.height = h + "px";
    const text = wrapper.querySelector(".pr-text");
    if (text) {
      text.style.width = w + "px";
      text.style.height = h + "px";
      text.style.setProperty("--total-scale-factor", scale);
    }
  }
}

/* ---------- Rendering pipeline ---------- */

function scheduleRender() {
  if (state.__renderQueued) return;
  state.__renderQueued = true;
  requestAnimationFrame(() => {
    state.__renderQueued = false;
    pumpQueue();
  });
}

function visibleRange() {
  const viewTop = viewport.scrollTop;
  const viewH = viewport.clientHeight;
  const from = viewTop - RENDER_MARGIN * viewH;
  const to = viewTop + viewH + RENDER_MARGIN * viewH;

  const first = [];
  for (let i = 1; i <= state.numPages; i++) {
    const top = state.offsets[i - 1];
    const meta = state.pagesMeta[i - 1];
    const bottom = top + meta.ph * pageScale(i);
    if (bottom >= from && top <= to) first.push(i);
  }
  return first;
}

function pumpQueue() {
  if (!state.doc) return;
  const range = visibleRange();

  for (const n of range) {
    if (!state.rendered.has(n) && !state.rendering.has(n) && !state.pending.has(n)) {
      state.pending.add(n);
    }
  }

  /* eviction */
  if (state.rendered.size > MAX_RENDERED) {
    const sorted = [...state.rendered.keys()].sort((a, b) => {
      const da = Math.abs(a - state.page);
      const db = Math.abs(b - state.page);
      return db - da;
    });
    while (state.rendered.size > MAX_RENDERED && sorted.length) {
      const victim = sorted.shift();
      if (range.includes(victim)) continue;
      clearPage(victim);
    }
  }

  let slots = MAX_CONCURRENT - state.rendering.size;
  const queue = [...state.pending].sort((a, b) => Math.abs(a - state.page) - Math.abs(b - state.page));

  for (const n of queue) {
    if (slots <= 0) break;
    state.pending.delete(n);
    state.rendering.add(n);
    renderPage(n).finally(() => {
      state.rendering.delete(n);
      scheduleRender();
    });
    slots--;
  }
}

async function renderPage(n) {
  const wrapper = docEl.querySelector(`.pr-page[data-page="${n}"]`);
  if (!wrapper || !state.doc) return;

  const frame = wrapper.querySelector(".pr-frame");
  const base = wrapper.querySelector(".pr-canvas--base");
  const overlay = wrapper.querySelector(".pr-canvas--overlay");
  const text = wrapper.querySelector(".pr-text");

  try {
    const page = await state.doc.getPage(n);

    const scale = pageScale(n);
    const renderScale = clampRenderScale(scale, n);
    const viewport2 = page.getViewport({ scale: renderScale });

    /* CSS size = PDF units * layout scale (independent of the device-pixel
       ratio used for the backing store); the canvas CSS box must match the
       frame box laid out by sizeAllFrames(). */
    const meta = state.pagesMeta[n - 1] || { pw: viewport2.width / renderScale, ph: viewport2.height / renderScale };
    const cssW = meta.pw * scale;
    const cssH = meta.ph * scale;

    base.width = Math.floor(viewport2.width);
    base.height = Math.floor(viewport2.height);
    base.style.width = cssW + "px";
    base.style.height = cssH + "px";

    /* stale guard: a zoom/resize may have rebuilt the layout mid-render */
    if (!wrapper.isConnected) return;

    const task = page.render({ canvasContext: base.getContext("2d", { willReadFrequently: true }), viewport: viewport2 });
    state.rendered.set(n, { wrapper, frame, base, overlay, text, task });
    await task.promise;

    /* stale guard: layout was rebuilt while rendering */
    const entry = state.rendered.get(n);
    if (!entry || entry.wrapper !== wrapper) return;

    /* image regions (scaled cache) */
    const ops = state.pdfjs.OPS;
    const regionsEntry = state.regionsCache.get(n);
    let regions;
    if (regionsEntry && Math.abs(regionsEntry.scale - renderScale) < 1e-6) {
      regions = regionsEntry.regions;
    } else {
      try {
        const opList = await page.getOperatorList();
        regions = extractImageRegions(opList, viewport2.transform, ops);
      } catch { regions = []; }
      state.regionsCache.set(n, { scale: renderScale, regions });
    }

    /* already-dark detection (cached per page) */
    if (!state.alreadyDark.has(n)) {
      try {
        const ctx = base.getContext("2d", { willReadFrequently: true });
        const data = ctx.getImageData(0, 0, base.width, base.height);
        state.alreadyDark.set(n, detectAlreadyDark(data.data, base.width, base.height));
      } catch {
        state.alreadyDark.set(n, false);
      }
    }

    state.rendered.get(n).regions = { scale: renderScale, regions };

    applyDarkToPage(n);

    /* text layer */
    const textContent = await getTextContent(page);

    const entry2 = state.rendered.get(n);
    if (!entry2 || entry2.wrapper !== wrapper) return;

    text.innerHTML = "";
    text.style.width = cssW + "px";
    text.style.height = cssH + "px";
    text.style.setProperty("--total-scale-factor", scale);

    const TextLayerCtor = state.pdfjs.TextLayer;
    if (TextLayerCtor) {
      const tl = new TextLayerCtor({ textContentSource: textContent, container: text, viewport: page.getViewport({ scale }) });
      await tl.render();
    }

    if (state.search.query) highlightPage(n);

    wrapper.classList.remove("is-loading");
  } catch (err) {
    if (err && err.name === "RenderingCancelledException") return;
    console.error("[reader] render failed for page", n, err);
    wrapper.classList.remove("is-loading");
  }
}

function clampRenderScale(scale, n) {
  /* Cap total canvas pixels (~4K area) so zooming stays safe on mobile GPUs. */
  const meta = state.pagesMeta[n - 1] || { pw: 612, ph: 792 };
  const w = meta.pw * scale;
  const h = meta.ph * scale;
  const area = w * h;
  const maxArea = 16_000_000;
  let s = scale * state.dpr;
  if (area * s * s > maxArea) {
    s = Math.sqrt(maxArea / area);
  }
  return s;
}

async function getTextContent(page) {
  const n = page.pageNumber || page._pageIndex + 1;
  if (!state.textCache.has(n)) {
    state.textCache.set(n, page.getTextContent());
  }
  return state.textCache.get(n);
}

function clearPage(n) {
  const entry = state.rendered.get(n);
  if (!entry) return;
  try { entry.task && entry.task.cancel(); } catch { /* ignore */ }
  if (entry.base) {
    entry.base.width = 0;
    entry.base.height = 0;
  }
  if (entry.overlay) {
    entry.overlay.width = 0;
    entry.overlay.height = 0;
  }
  if (entry.text) entry.text.innerHTML = "";
  entry.wrapper.classList.add("is-loading");
  state.rendered.delete(n);
}

/* ---------- Dark mode (Veil technique) ---------- */

function applyInitialDark() {
  const stored = storageGet("ahmadi-pdf-dark", null);
  if (stored === "dark" || stored === "light") {
    state.dark = stored === "dark";
  } else {
    state.dark = document.documentElement.getAttribute("data-theme") === "dark";
  }
  updateDarkButton();
}

function updateDarkButton() {
  if (!btnDark) return;
  btnDark.setAttribute("aria-pressed", state.dark ? "true" : "false");
  btnDark.classList.toggle("is-active", !!state.dark);
  const darkIcon = btnDark.querySelector(".pr-icon-dark");
  const lightIcon = btnDark.querySelector(".pr-icon-light");
  if (darkIcon) darkIcon.style.display = state.dark ? "none" : "";
  if (lightIcon) lightIcon.style.display = state.dark ? "" : "none";
}

function toggleDark() {
  state.dark = !state.dark;
  storageSet("ahmadi-pdf-dark", state.dark ? "dark" : "light");
  updateDarkButton();

  for (const n of [...state.rendered.keys()]) {
    applyDarkToPage(n);
  }
}

function applyDarkToPage(n) {
  const entry = state.rendered.get(n);
  if (!entry || !entry.base || !entry.base.width) return;

  const alreadyDark = state.alreadyDark.get(n) || false;
  const apply = state.dark && !alreadyDark;

  entry.base.classList.toggle("is-dark", apply);

  const overlay = entry.overlay;
  if (!overlay) return;

  if (apply && entry.regions) {
    overlay.width = entry.base.width;
    overlay.height = entry.base.height;
    const ctx = overlay.getContext("2d");
    ctx.clearRect(0, 0, overlay.width, overlay.height);
    compositeImageRegions(ctx, entry.base, entry.regions.regions, overlay.width, overlay.height);
  } else {
    overlay.width = 0;
    overlay.height = 0;
  }
}

/* ---------- Scroll sync ---------- */

function currentPageFromScroll() {
  const center = viewport.scrollTop + viewport.clientHeight * 0.4;
  let lo = 0, hi = state.numPages - 1, ans = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (state.offsets[mid] <= center) { ans = mid + 1; lo = mid + 1; }
    else hi = mid - 1;
  }
  return ans;
}

let scrollScheduled = false;
function onScroll() {
  if (scrollScheduled) return;
  scrollScheduled = true;
  requestAnimationFrame(() => {
    scrollScheduled = false;
    const page = currentPageFromScroll();
    if (page !== state.page) {
      state.page = page;
      updatePageUi(page);
      savePosition();
    }
    scheduleRender();
  });
}

function updatePageUi(page) {
  if (pageInput) pageInput.value = String(page);
  if (btnPrev) btnPrev.disabled = page <= 1;
  if (btnNext) btnNext.disabled = page >= state.numPages;

  if (progressFill && state.numPages > 1) {
    progressFill.style.width = ((page - 1) / (state.numPages - 1)) * 100 + "%";
  } else if (progressFill) {
    progressFill.style.width = "100%";
  }
}

function gotoPage(page, behavior) {
  if (!state.numPages) return; /* document not ready yet */
  page = clamp(page, 1, state.numPages);
  state.page = page;
  updatePageUi(page);
  const top = state.offsets[page - 1] - 8;
  viewport.scrollTo({ top, behavior: behavior || scrollBehavior() });
  scheduleRender();
  savePosition();
}

/* ---------- Zoom ---------- */

function setZoom(next) {
  const anchored = state.page;
  state.zoom = clamp(next, 0.5, 4);
  buildLayout();          /* rebuild offsets + wrappers */
  updateZoomUi();
  gotoPage(anchored, "auto");
  toast(`بزرگ‌نمایی: ${Math.round(state.zoom * 100)}٪`, 1400);
}

function updateZoomUi() {
  if (zoomLabel) zoomLabel.textContent = Math.round(state.zoom * 100) + "٪";
  if (btnZoomOut) btnZoomOut.disabled = state.zoom <= 0.5;
  if (btnZoomIn) btnZoomIn.disabled = state.zoom >= 4;
}

function zoomBy(factor) {
  setZoom(state.zoom * factor);
}

/* ---------- Search ---------- */

async function buildSearchIndex() {
  if (!state.doc) return;
  for (let i = 1; i <= state.numPages; i++) {
    if (state.pageText[i]) continue;
    try {
      const page = await state.doc.getPage(i);
      const tc = await page.getTextContent();
      const raw = tc.items.map((it) => (it.str || "")).join(" ");
      state.pageText[i] = normalizeForSearch(normalizeLigatures(raw));
    } catch {
      state.pageText[i] = "";
    }
    /* yield to the UI between pages */
    await new Promise((r) => (window.requestIdleCallback || setTimeout)(r, 0));
  }
  if (state.search.query) runSearch(state.search.query);
}

function runSearch(rawQuery) {
  const query = normalizeForSearch(rawQuery.trim());
  state.search = { query: rawQuery.trim(), hits: [], at: -1 };

  if (!query) {
    if (searchStatus) searchStatus.textContent = "";
    clearHighlights();
    return;
  }

  const hits = [];
  for (let i = 1; i <= state.numPages; i++) {
    const text = state.pageText[i];
    if (!text) continue;
    let from = 0, count = 0;
    while (count < 50) {
      const idx = text.indexOf(query, from);
      if (idx === -1) break;
      count++;
      from = idx + query.length;
    }
    if (count > 0) hits.push({ page: i, count });
  }

  state.search.hits = hits;
  if (searchStatus) {
    searchStatus.textContent = hits.length
      ? `${faNum(hits.reduce((a, h) => a + h.count, 0))} مورد در ${faNum(hits.length)} صفحه`
      : "چیزی یافت نشد";
  }

  if (hits.length) {
    state.search.at = 0;
    gotoPage(hits[0].page);
  }

  /* re-highlight already rendered pages */
  clearHighlights();
  for (const n of state.rendered.keys()) highlightPage(n);
}

/* Wrap query matches inside the pdf.js text layer with <mark>.
   Matching runs on normalized text with an index map back to the raw
   string, so Persian/Arabic variants (ی/ي، ک/ك) still match. */
function highlightPage(n) {
  const entry = state.rendered.get(n);
  if (!entry || !entry.text || !state.search.query) return;

  const q = normalizeForSearch(state.search.query);
  if (!q) return;

  for (const span of entry.text.querySelectorAll("span")) {
    if (span.dataset.marked === "1") continue;
    const raw = span.textContent;
    if (!raw) continue;

    const { norm, map } = mapNormalized(raw);
    if (!norm.includes(q)) continue;

    const frag = document.createDocumentFragment();
    let rawPos = 0;
    let i = 0;

    while (i <= norm.length - q.length) {
      const idx = norm.indexOf(q, i);
      if (idx === -1) break;
      const start = map[idx];
      const end = map[idx + q.length - 1] + 1;

      if (start > rawPos) frag.append(document.createTextNode(raw.slice(rawPos, start)));
      const mark = document.createElement("mark");
      mark.textContent = raw.slice(start, end);
      frag.append(mark);
      rawPos = end;
      i = idx + q.length;
    }
    if (rawPos < raw.length) frag.append(document.createTextNode(raw.slice(rawPos)));

    span.textContent = "";
    span.append(frag);
    span.dataset.marked = "1";
  }
}

function mapNormalized(raw) {
  const normChars = [];
  const map = [];
  let i = 0;
  for (const ch of raw) {
    const nch = normalizeForSearch(ch);
    if (nch) {
      for (const c of nch) {
        normChars.push(c);
        map.push(i);
      }
    }
    i += ch.length;
  }
  return { norm: normChars.join(""), map };
}

function clearHighlights() {
  docEl.querySelectorAll(".pr-text mark").forEach((mark) => {
    const parent = mark.parentNode;
    if (!parent) return;
    mark.replaceWith(...mark.childNodes);
    parent.normalize();
  });
  docEl.querySelectorAll('.pr-text span[data-marked]').forEach((span) => {
    delete span.dataset.marked;
  });
}

function stepSearch(dir) {
  const s = state.search;
  if (!s.hits.length) return;
  s.at = (s.at + dir + s.hits.length) % s.hits.length;
  const hit = s.hits[s.at];
  if (searchStatus) {
    searchStatus.textContent = `صفحه ${faNum(hit.page)} — ${faNum(hit.count)} مورد`;
  }
  gotoPage(hit.page);
  const entry = state.rendered.get(hit.page);
  if (entry && entry.text) {
    const marks = entry.text.querySelectorAll("mark");
    marks.forEach((m) => m.classList.remove("is-active"));
    if (marks[0]) marks[0].classList.add("is-active");
  }
}

function openSearch() {
  if (!searchBox) return;
  searchBox.hidden = false;
  searchInput.focus();
  searchInput.select();
}

function closeSearch() {
  if (!searchBox) return;
  searchBox.hidden = true;
  clearHighlights();
  state.search = { query: "", hits: [], at: -1 };
  if (searchStatus) searchStatus.textContent = "";
}

/* ---------- Fullscreen ---------- */

function toggleFullscreen() {
  const el = root || document.documentElement;
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => toast("حالت تمام‌صفحه در دسترس نیست"));
    } else {
      toast("مرورگر شما از تمام‌صفحه پشتیبانی نمی‌کند");
    }
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => { /* ignore */ });
  }
}

function onFsChange() {
  if (btnFs) btnFs.classList.toggle("is-active", !!document.fullscreenElement);
}

/* ---------- Keyboard ---------- */

function onKeydown(e) {
  const tag = (e.target && e.target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable;

  if (typing) {
    if (e.key === "Escape" && searchBox && !searchBox.hidden) {
      closeSearch();
      searchInput.blur();
    }
    return;
  }

  switch (e.key) {
    case "ArrowLeft":
      e.preventDefault();
      gotoPage(state.page + 1);
      break;
    case "ArrowRight":
      e.preventDefault();
      gotoPage(state.page - 1);
      break;
    case "+":
    case "=":
      e.preventDefault();
      zoomBy(1.25);
      break;
    case "-":
      e.preventDefault();
      zoomBy(1 / 1.25);
      break;
    case "0":
      e.preventDefault();
      setZoom(1);
      break;
    case "d":
    case "D":
      toggleDark();
      break;
    case "f":
    case "F":
      toggleFullscreen();
      break;
    case "/":
      e.preventDefault();
      openSearch();
      break;
    case "Escape":
      if (searchBox && !searchBox.hidden) closeSearch();
      break;
    default:
      break;
  }
}

/* ---------- Events ---------- */

function wireEvents() {
  viewport.addEventListener("scroll", onScroll, { passive: true });

  btnPrev && btnPrev.addEventListener("click", () => gotoPage(state.page - 1));
  btnNext && btnNext.addEventListener("click", () => gotoPage(state.page + 1));
  btnZoomIn && btnZoomIn.addEventListener("click", () => zoomBy(1.25));
  btnZoomOut && btnZoomOut.addEventListener("click", () => zoomBy(1 / 1.25));
  btnZoomReset && btnZoomReset.addEventListener("click", () => setZoom(1));
  btnDark && btnDark.addEventListener("click", toggleDark);
  btnSearch && btnSearch.addEventListener("click", openSearch);
  btnFs && btnFs.addEventListener("click", toggleFullscreen);

  pageInput && pageInput.addEventListener("change", () => {
    const v = parseInt(pageInput.value, 10);
    if (Number.isFinite(v)) gotoPage(v);
  });

  searchInput && searchInput.addEventListener("input", debounce(() => {
    if (searchInput.value.trim().length >= 2) runSearch(searchInput.value);
  }, 320));

  searchInput && searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); stepSearch(1); }
    if (e.key === "Escape") { closeSearch(); }
  });

  searchNext && searchNext.addEventListener("click", () => stepSearch(1));
  searchPrev && searchPrev.addEventListener("click", () => stepSearch(-1));
  searchClose && searchClose.addEventListener("click", closeSearch);

  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("keydown", onKeydown);

  /* ctrl + wheel zoom */
  viewport.addEventListener("wheel", (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  /* keep layout fresh on resize */
  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (Math.abs(docEl.clientWidth - state.lastWidth) < 24) return;
      state.lastWidth = docEl.clientWidth;
      const anchored = state.page;
      buildLayout();
      gotoPage(anchored, "auto");
    }, 220);
  });

  state.lastWidth = docEl.clientWidth;
}

function debounce(fn, ms) {
  let t = 0;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/* ---------- Boot ---------- */

async function init() {
  wireEvents();
  updateZoomUi();

  try {
    const book = await resolveBook();
    await loadBook(book);
  } catch (err) {
    showError(err);
  }
}

init();
