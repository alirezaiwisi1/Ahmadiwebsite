(function () {
  "use strict";

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

  /* ---------- Close other open FAQ items when one opens ---------- */
  var faqList = document.querySelector(".faq-list");
  if (faqList) {
    var items = faqList.querySelectorAll("details");
    items.forEach(function (item) {
      item.addEventListener("toggle", function () {
        if (!item.open) return;
        items.forEach(function (other) {
          if (other !== item) other.open = false;
        });
      });
    });
  }
})();
