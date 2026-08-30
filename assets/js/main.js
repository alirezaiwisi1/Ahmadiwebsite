(function () {
  "use strict";

  /* ---------- Theme (dark / light) ---------- */
  var root = document.documentElement;
  var themeToggle = document.getElementById("theme-toggle");
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  var DARK_BG = "#0f1421";
  var LIGHT_BG = "#faf8f2";

  function currentTheme() {
    return root.getAttribute("data-theme") === "dark" ? "dark" : "light";
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
      root.setAttribute("data-theme", next);
      try {
        localStorage.setItem("ahmadi-theme", next);
      } catch (error) {
        /* storage unavailable — theme still applies for this visit */
      }
      setToggleState(next);
      applyThemeMeta(next);
    });
  }

  /* ---------- Mobile navigation ---------- */
  var nav = document.querySelector(".site-nav");
  var toggle = document.querySelector(".site-nav__toggle");
  var list = document.querySelector(".site-nav__list");

  if (nav && toggle && list) {
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

    window.addEventListener("resize", function () {
      if (window.innerWidth >= 1024 && nav.classList.contains("is-open")) {
        closeNav();
      }
    });
  }

  /* ---------- Current year in footer ---------- */
  var yearEl = document.getElementById("footer-year");
  if (yearEl) {
    yearEl.textContent = new window.Date().toLocaleDateString("fa-IR", {
      year: "numeric"
    });
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

  /* ---------- Scroll reveal ---------- */
  var revealEls = document.querySelectorAll("[data-reveal]");
  var reduceMotion =
    window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function revealAll() {
    revealEls.forEach(function (el) {
      el.classList.add("is-visible");
    });
  }

  if (!revealEls.length || reduceMotion || !("IntersectionObserver" in window)) {
    revealAll();
  } else {
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

  /* ---------- Reading progress ---------- */
  var progressBar = document.querySelector(".reading-progress span");
  if (progressBar) {
    var ticking = false;
    var updateProgress = function () {
      var doc = document.documentElement;
      var max = doc.scrollHeight - window.innerHeight;
      var value = max > 0 ? Math.min(window.scrollY / max, 1) : 0;
      progressBar.style.transform = "scaleX(" + value + ")";
      ticking = false;
    };
    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(updateProgress);
          ticking = true;
        }
      },
      { passive: true }
    );
    updateProgress();
  }

  /* ---------- Back to top ---------- */
  var toTop = document.createElement("button");
  toTop.className = "to-top";
  toTop.type = "button";
  toTop.setAttribute("aria-label", "بازگشت به بالای صفحه");
  toTop.textContent = "↑";
  document.body.appendChild(toTop);

  var toTopShown = false;
  window.addEventListener(
    "scroll",
    function () {
      var show = window.scrollY > 600;
      if (show !== toTopShown) {
        toTopShown = show;
        toTop.classList.toggle("is-visible", show);
      }
    },
    { passive: true }
  );

  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  });
})();
