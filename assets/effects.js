/* C Mastery: visual polish layer. Independent of app.js; safe to remove. */
(function () {
  "use strict";
  var reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;

  function start() {
    // Spotlight that follows the pointer on cards.
    if (fine) {
      document.addEventListener("pointermove", function (event) {
        var card = event.target.closest && event.target.closest(".card, .source");
        if (!card) return;
        var box = card.getBoundingClientRect();
        card.style.setProperty("--mx", event.clientX - box.left + "px");
        card.style.setProperty("--my", event.clientY - box.top + "px");
      }, { passive: true });
    }

    // Gentle 3D tilt on the hero terminal.
    var terminal = document.querySelector(".hero .terminal");
    if (terminal && fine && !reduced) {
      terminal.addEventListener("pointermove", function (event) {
        var box = terminal.getBoundingClientRect();
        var x = (event.clientX - box.left) / box.width - 0.5;
        var y = (event.clientY - box.top) / box.height - 0.5;
        terminal.style.setProperty("--ry", (x * 5).toFixed(2) + "deg");
        terminal.style.setProperty("--rx", (-y * 5).toFixed(2) + "deg");
      });
      terminal.addEventListener("pointerleave", function () {
        terminal.style.setProperty("--ry", "0deg");
        terminal.style.setProperty("--rx", "0deg");
      });
    }

    // Hero output lines appear one after another, like a program running.
    var outputs = document.querySelectorAll(".hero .term-body .term-out");
    if (outputs.length && !reduced) {
      outputs.forEach(function (line) { line.classList.add("fx-wait"); });
      outputs.forEach(function (line, index) {
        setTimeout(function () { line.classList.remove("fx-wait"); }, 700 + index * 420);
      });
    }

    // Section headings draw their underline when they scroll into view.
    var sections = document.querySelectorAll(".section");
    if ("IntersectionObserver" in window) {
      var seen = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("fx-seen");
            seen.unobserve(entry.target);
          }
        });
      }, { rootMargin: "0px 0px -15% 0px" });
      sections.forEach(function (section) { seen.observe(section); });
    } else {
      sections.forEach(function (section) { section.classList.add("fx-seen"); });
    }

    // Reading-size control (A- / A+), remembered per browser.
    var SIZES = ["sm", "md", "lg", "xl"];
    var root = document.documentElement;
    var applySize = function (size) {
      if (size === "md") root.removeAttribute("data-size");
      else root.setAttribute("data-size", size);
    };
    var currentSize = "md";
    try { currentSize = localStorage.getItem("cMastery.size") || "md"; } catch (e) {}
    if (SIZES.indexOf(currentSize) === -1) currentSize = "md";
    applySize(currentSize);
    document.querySelectorAll("[data-size-step]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var i = SIZES.indexOf(currentSize) + Number(btn.getAttribute("data-size-step"));
        currentSize = SIZES[Math.max(0, Math.min(SIZES.length - 1, i))];
        applySize(currentSize);
        try { localStorage.setItem("cMastery.size", currentSize); } catch (e) {}
      });
    });

    // Hero backdrop: a slow, faint "memory dump" of hex bytes drifting down.
    var canvas = document.getElementById("hexRain");
    if (canvas && !reduced && canvas.getContext) {
      var ctx = canvas.getContext("2d");
      var cols = [], colW = 26, rowH = 20, dpr = Math.min(window.devicePixelRatio || 1, 2);
      var visible = true, last = 0;
      var hex = "0123456789ABCDEF";
      var resize = function () {
        var box = canvas.getBoundingClientRect();
        canvas.width = Math.max(1, box.width * dpr);
        canvas.height = Math.max(1, box.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        var n = Math.ceil(box.width / colW);
        cols = [];
        for (var i = 0; i < n; i++) cols.push({ y: Math.random() * box.height, speed: 8 + Math.random() * 22, hot: Math.random() < 0.12 });
      };
      resize();
      window.addEventListener("resize", resize);
      if ("IntersectionObserver" in window) {
        new IntersectionObserver(function (e) { visible = e[0].isIntersecting; }).observe(canvas);
      }
      var frame = function (now) {
        requestAnimationFrame(frame);
        if (!visible || document.hidden) { last = now; return; }
        var dt = Math.min(0.05, (now - last) / 1000 || 0);
        last = now;
        var h = canvas.height / dpr, w = canvas.width / dpr;
        ctx.clearRect(0, 0, w, h);
        ctx.font = "12px 'JetBrains Mono', Consolas, monospace";
        for (var i = 0; i < cols.length; i++) {
          var c = cols[i];
          c.y += c.speed * dt;
          if (c.y > h + rowH * 8) { c.y = -rowH * 4; c.hot = Math.random() < 0.12; }
          for (var k = 0; k < 8; k++) {
            var y = c.y - k * rowH;
            if (y < -rowH || y > h + rowH) continue;
            var seed = (i * 31 + Math.floor(y / rowH) * 17) & 255;
            var byte = hex[(seed >> 4) & 15] + hex[seed & 15];
            var alpha = (1 - k / 8) * (k === 0 ? 0.55 : 0.22);
            ctx.fillStyle = c.hot ? "rgba(255,180,84," + alpha + ")" : "rgba(61,220,151," + alpha + ")";
            ctx.fillText(byte, i * colW, y);
          }
        }
      };
      requestAnimationFrame(frame);
    }

    // Back-to-top button.
    var top = document.createElement("button");
    top.type = "button";
    top.className = "fx-top";
    top.setAttribute("aria-label", "الرجوع لأعلى الصفحة");
    top.textContent = "↑";
    top.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
    });
    document.body.appendChild(top);
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        top.classList.toggle("show", window.scrollY > 900);
        ticking = false;
      });
    }, { passive: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
