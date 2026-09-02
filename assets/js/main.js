(function () {
  "use strict";

  var doc = document.documentElement;
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Theme (dark / light) ---------- */
  var themeToggle = document.getElementById("theme-toggle");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var DARK_BG = "#151009";
  var LIGHT_BG = "#faf6ef";

  function currentTheme() {
    return doc.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setToggleState(theme) {
    if (themeToggle) {
      themeToggle.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    }
  }

  function applyThemeMeta(theme) {
    if (themeMeta) {
      themeMeta.setAttribute("content", theme === "dark" ? DARK_BG : LIGHT_BG);
    }
  }

  if (themeToggle) {
    setToggleState(currentTheme());
    applyThemeMeta(currentTheme());
    themeToggle.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  function applyTheme(next) {
    doc.setAttribute("data-theme", next);
    try {
      localStorage.setItem("ahmadi-theme", next);
    } catch (e) {
      /* storage unavailable — theme still applies for this visit */
    }
    setToggleState(next);
    applyThemeMeta(next);
  }

  /* Follow the OS theme only while the visitor has not chosen manually. */
  if (window.matchMedia) {
    var mq = window.matchMedia("(prefers-color-scheme: dark)");
    var onSystemChange = function (e) {
      var stored = null;
      try { stored = localStorage.getItem("ahmadi-theme"); } catch (err) { /* ignore */ }
      if (!stored) applyTheme(e.matches ? "dark" : "light");
    };
    if (mq.addEventListener) mq.addEventListener("change", onSystemChange);
  }

  /* ---------- Mobile navigation ---------- */
  var nav = document.querySelector(".site-nav");
  var toggle = document.querySelector(".site-nav__toggle");

  if (nav && toggle) {
    var closeNav = function () {
      nav.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    };

    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav();
        toggle.focus();
      }
    });

    document.addEventListener("click", function (event) {
      if (
        nav.classList.contains("is-open") &&
        !nav.contains(event.target) &&
        !toggle.contains(event.target)
      ) {
        closeNav();
      }
    });

    nav.querySelectorAll(".site-nav__list a").forEach(function (link) {
      link.addEventListener("click", closeNav);
    });

    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024 && nav.classList.contains("is-open")) {
        closeNav();
      }
    });
  }

  /* ---------- Current year in footer (Persian calendar) ---------- */
  var yearEl = document.getElementById("footer-year");
  if (yearEl) {
    try {
      yearEl.textContent = new window.Date().toLocaleDateString("fa-IR", {
        year: "numeric"
      });
    } catch (e) {
      yearEl.textContent = "۱۴۰۵";
    }
  }

  /* ---------- Accordion groups (FAQ + covenant timeline) ---------- */
  var accordionGroups = document.querySelectorAll("[data-accordion]");
  accordionGroups.forEach(function (group) {
    var items = group.querySelectorAll("details");
    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        items.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  });

  /* ---------- Scroll reveal with gentle stagger ---------- */
  var revealEls = Array.prototype.slice.call(
    document.querySelectorAll("[data-reveal]")
  );

  function revealAll() {
    revealEls.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  if (!revealEls.length || reduceMotion || !("IntersectionObserver" in window)) {
    revealAll();
  } else {
    /* siblings revealed together get a small cascade delay */
    var groups = new Map();
    revealEls.forEach(function (el) {
      var parent = el.parentElement;
      if (!groups.has(parent)) groups.set(parent, 0);
      var idx = groups.get(parent);
      el.style.setProperty("--reveal-delay", Math.min(idx * 70, 420) + "ms");
      groups.set(parent, idx + 1);
    });

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) {
      observer.observe(el);
    });
    /* Safety net: never leave content hidden */
    setTimeout(revealAll, 3000);
  }

  /* ---------- Shared scroll handler (progress + header shadow + to-top) ---------- */
  var progressBar = document.querySelector(".reading-progress span");
  var header = document.querySelector(".site-header");
  var toTop = null;

  if (!reduceMotion) {
    toTop = document.createElement("button");
    toTop.className = "to-top";
    toTop.type = "button";
    toTop.setAttribute("aria-label", "بازگشت به بالای صفحه");
    toTop.innerHTML =
      '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="18 15 12 9 6 15"/></svg>';
    document.body.appendChild(toTop);

    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  var ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () {
      var y = window.scrollY;
      var docEl = document.documentElement;
      var max = docEl.scrollHeight - window.innerHeight;

      if (progressBar) {
        var value = max > 0 ? Math.min(y / max, 1) : 0;
        progressBar.style.transform = "scaleX(" + value + ")";
      }

      if (header) {
        header.classList.toggle("is-scrolled", y > 8);
      }

      if (toTop) {
        toTop.classList.toggle("is-visible", y > 600);
      }

      ticking = false;
    });
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ---------- Service worker (HTTPS only) ---------- */
  if ("serviceWorker" in navigator) {
    var isLocal = location.hostname === "localhost" || location.hostname === "127.0.0.1";
    if (location.protocol === "https:" || isLocal) {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {
          /* offline support is optional — ignore failures */
        });
      });
    }
  }
})();
