/* ============================================================
   C Mastery for Reverse Engineers — course engine
   Static (GitHub Pages friendly). Code runs on Compiler Explorer
   (godbolt.org, x86-64 gcc 15.2, Linux). Every example also ships
   with an output pre-verified by tools/build.py as an offline fallback.
   ============================================================ */
(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- Storage ---------------- */
  const STORE_KEY = "cMastery.v1";
  const THEME_KEY = "cMastery.theme";

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return {
        quizzes: raw.quizzes || {},
        challenges: raw.challenges || {},
        code: raw.code || {},
        projects: raw.projects || {},
        celebrated: Boolean(raw.celebrated)
      };
    } catch (e) {
      return { quizzes: {}, challenges: {}, code: {}, projects: {}, celebrated: false };
    }
  }
  const state = loadState();
  function saveState() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* blocked */ }
  }

  /* ---------------- Toast ---------------- */
  const toastEl = $("#toast");
  const toastTxt = $("#toastTxt");
  let toastTimer = null;
  function toast(message, icon = "✓") {
    if (!toastEl) return;
    const ico = toastEl.querySelector(".t-ico");
    if (ico) ico.textContent = icon;
    toastTxt.textContent = message;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  /* ---------------- Theme ---------------- */
  const themeBtn = $("#themeBtn");
  function applyTheme(theme, persist = true) {
    document.documentElement.dataset.theme = theme;
    if (themeBtn) {
      themeBtn.textContent = theme === "light" ? "☀️" : "🌙";
      themeBtn.setAttribute("aria-label", theme === "light" ? "تفعيل الوضع الداكن" : "تفعيل الوضع الفاتح");
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "light" ? "#f4f7fc" : "#050811");
    if (persist) { try { localStorage.setItem(THEME_KEY, theme); } catch (e) {} }
  }
  function initTheme() {
    let saved = "dark";
    try { saved = localStorage.getItem(THEME_KEY) || "dark"; } catch (e) {}
    applyTheme(saved === "light" ? "light" : "dark", false);
    if (themeBtn) themeBtn.addEventListener("click", () => {
      applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
    });
  }

  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  /* ---------------- Syntax highlighting ---------------- */
  const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const C_KEYWORDS = new Set(("auto break case const continue default do else enum extern for goto if inline " +
    "register restrict return sizeof static struct switch typedef union volatile while _Alignas _Alignof " +
    "_Atomic _Bool _Generic _Noreturn _Static_assert _Thread_local alignas alignof static_assert true false nullptr").split(" "));
  const C_TYPES = new Set(("void char short int long float double signed unsigned bool size_t ssize_t ptrdiff_t " +
    "intptr_t uintptr_t int8_t int16_t int32_t int64_t uint8_t uint16_t uint32_t uint64_t FILE va_list " +
    "BYTE WORD DWORD QWORD BOOL HANDLE LPVOID LPCSTR LPSTR LPCWSTR DWORD_PTR ULONG_PTR wchar_t errno_t").split(" "));
  const C_CONSTS = new Set("NULL EOF stdin stdout stderr SEEK_SET SEEK_CUR SEEK_END EXIT_SUCCESS EXIT_FAILURE CHAR_BIT INT_MAX INT_MIN UINT_MAX".split(" "));

  const C_TOKEN_RE = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*|^[ \t]*#[ \t]*\w+(?:[ \t]*<[^>\n]*>)?|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\b0[xX][0-9a-fA-F]+[uUlL]*\b|\b0[bB][01]+\b|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[uUlLfF]*\b|\b[A-Za-z_]\w*\b)/gm;

  function highlightC(code) {
    let out = "", last = 0;
    code.replace(C_TOKEN_RE, (m, _g, offset) => {
      out += escapeHtml(code.slice(last, offset));
      let cls = "";
      const c0 = m.charAt(0);
      if (m.startsWith("/*") || m.startsWith("//")) cls = "com";
      else if (/^[ \t]*#/.test(m)) cls = "dec";
      else if (c0 === '"' || c0 === "'") cls = "str";
      else if (/^\d/.test(m)) cls = "num";
      else if (C_KEYWORDS.has(m)) cls = "kw";
      else if (C_TYPES.has(m)) cls = "builtin";
      else if (C_CONSTS.has(m)) cls = "self";
      else if (/^\s*\(/.test(code.slice(offset + m.length))) cls = "fn";
      out += cls ? '<span class="tok-' + cls + '">' + escapeHtml(m) + "</span>" : escapeHtml(m);
      last = offset + m.length;
      return m;
    });
    return out + escapeHtml(code.slice(last));
  }

  const ASM_REGS = /^(?:[re]?[abcd]x|[abcd][lh]|[re]?(?:si|di|sp|bp|ip)|(?:si|di|sp|bp)l|r(?:[89]|1[0-5])[dwb]?|[xyz]mm\d+|[cdefgs]s|rflags|eflags)$/i;
  const ASM_TOKEN_RE = /(;[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|^[ \t]*[.\w$@?]+:|^[ \t]*\.[A-Za-z_]\w*|\b0x[0-9a-fA-F]+\b|\b[0-9a-fA-F]+h\b|-?\b\d+\b|\b[A-Za-z_.$@?][\w.$@?]*\b)/gm;
  const ASM_SIZE = new Set("BYTE WORD DWORD QWORD XMMWORD PTR OFFSET FLAT byte word dword qword ptr".split(" "));

  function highlightAsm(code) {
    let out = "", last = 0;
    code.replace(ASM_TOKEN_RE, (m, _g, offset) => {
      out += escapeHtml(code.slice(last, offset));
      let cls = "";
      const lineStart = code.lastIndexOf("\n", offset - 1) + 1;
      const isFirstWord = /^[ \t]*$/.test(code.slice(lineStart, offset));
      if (m.charAt(0) === ";" || m.charAt(0) === "#") cls = "com";
      else if (m.charAt(0) === '"') cls = "str";
      else if (/:$/.test(m)) cls = "fn";
      else if (/^[ \t]*\./.test(m)) cls = "dec";
      else if (/^-?\d/.test(m) || /^0x/i.test(m) || /^[0-9a-f]+h$/i.test(m)) cls = "num";
      else if (ASM_REGS.test(m)) cls = "self";
      else if (ASM_SIZE.has(m)) cls = "builtin";
      else if (isFirstWord) cls = "kw";
      out += cls ? '<span class="tok-' + cls + '">' + escapeHtml(m) + "</span>" : escapeHtml(m);
      last = offset + m.length;
      return m;
    });
    return out + escapeHtml(code.slice(last));
  }

  function buildGutter(block) {
    const body = block.querySelector(".code-body");
    const pre = body && body.querySelector("pre.code-pre");
    const code = pre && pre.querySelector("code");
    if (!body || !pre || !code || body.querySelector(".gutter")) return;
    const count = code.textContent.replace(/\n+$/, "").split("\n").length;
    const gutter = document.createElement("div");
    gutter.className = "gutter";
    gutter.setAttribute("aria-hidden", "true");
    gutter.textContent = Array.from({ length: count }, (_, i) => i + 1).join("\n");
    body.insertBefore(gutter, pre);
  }

  function initCodeBlocks() {
    $$("code.language-c").forEach((code) => {
      if (code.dataset.hl === "1") return;
      code.innerHTML = highlightC(code.textContent);
      code.dataset.hl = "1";
    });
    $$("code.language-asm").forEach((code) => {
      if (code.dataset.hl === "1") return;
      code.innerHTML = highlightAsm(code.textContent);
      code.dataset.hl = "1";
    });
    $$(".code-block").forEach((block) => {
      buildGutter(block);
      const copyBtn = block.querySelector(".copy");
      if (copyBtn) copyBtn.addEventListener("click", () => {
        const code = block.querySelector(".code-body code");
        copyText(code ? code.textContent : "");
      });
    });
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) await navigator.clipboard.writeText(text);
      else throw new Error("no clipboard");
    } catch (e) {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch (err) {}
      ta.remove();
    }
    toast("تم النسخ", "📋");
  }

  /* ---------------- Compiler Explorer engine ---------------- */
  const CE_URL = "https://godbolt.org/api/compiler/cg152/compile";
  const BASE_FLAGS = "-std=c17 -Wall -Wextra -fdiagnostics-color=never -lm";
  const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

  const joinLines = (arr) => (arr || []).map((l) => l.text).join("\n").replace(ANSI, "");

  async function ceRequest(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(CE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** Compile + run. Returns {out, err, exitCode, compileError}. */
  async function runC(source, opt = "-O0", stdin = "") {
    const data = await ceRequest({
      source, lang: "c", allowStoreCodeDebug: false,
      options: {
        userArguments: opt + " " + BASE_FLAGS,
        executeParameters: { args: [], stdin },
        compilerOptions: { executorRequest: true },
        filters: { execute: true },
        tools: [], libraries: []
      }
    });
    const build = data.buildResult || {};
    const buildErr = joinLines(build.stderr).replace(/<source>/g, "main.c");
    if (!data.didExecute) {
      return { out: "", err: buildErr || "تعذّر بناء البرنامج.", exitCode: null, compileError: true };
    }
    let err = joinLines(data.stderr);
    if (data.timedOut) err += (err ? "\n" : "") + "⏱ البرنامج أخد وقت أطول من المسموح واتوقف (حلقة لا نهائية؟).";
    return { out: joinLines(data.stdout), err, warnings: buildErr, exitCode: data.code, compileError: false };
  }

  /** Compile to Intel-syntax assembly. Returns {asm, err}. */
  async function compileAsm(source, opt = "-O0") {
    const data = await ceRequest({
      source, lang: "c", allowStoreCodeDebug: false,
      options: {
        userArguments: opt + " -std=c17 -fdiagnostics-color=never -fno-asynchronous-unwind-tables",
        compilerOptions: {},
        filters: { intel: true, directives: true, commentOnly: true, labels: true, libraryCode: true, demangle: true },
        tools: [], libraries: []
      }
    });
    const asm = (data.asm || []).map((l) => l.text).join("\n");
    const err = data.code !== 0 ? joinLines(data.stderr).replace(/<source>/g, "main.c") : "";
    return { asm, err };
  }

  function normalizeOutput(text) {
    return String(text).replace(/\r\n/g, "\n").split("\n")
      .map((line) => line.replace(/[ \t]+$/, "")).join("\n")
      .replace(/^\n+/, "").replace(/\n+$/, "");
  }

  function renderRunResult(pre, result) {
    pre.classList.remove("err", "warn");
    let text = "";
    if (result.compileError) {
      pre.classList.add("err");
      text = "✗ خطأ في الـ Compilation:\n\n" + result.err;
    } else {
      text = result.out || "(البرنامج اتنفّذ بدون مخرجات)";
      if (result.err && result.err.trim()) text += "\n\n[stderr]\n" + result.err;
      if (result.warnings && result.warnings.trim()) {
        text += "\n\n[warnings من الـ compiler]\n" + result.warnings;
        pre.classList.add("warn");
      }
    }
    pre.textContent = text;
  }

  /* ---------------- Runnable examples ---------------- */
  function outPanel(container) {
    if (!container.querySelector(".ro-head")) {
      container.innerHTML = '<div class="ro-head"><span class="dot"></span><span class="ro-title">OUTPUT</span><span class="ro-exit"></span></div><pre></pre><div class="ro-time"></div>';
    }
    return {
      pre: container.querySelector("pre"),
      time: container.querySelector(".ro-time"),
      exit: container.querySelector(".ro-exit"),
      title: container.querySelector(".ro-title")
    };
  }

  function initExampleRunners() {
    $$(".code-block[data-run]").forEach((block) => {
      const btn = block.querySelector(".run-mini");
      const out = block.querySelector(".run-out");
      const codeEl = block.querySelector(".code-body code");
      const baked = block.querySelector(".baked");
      if (!btn || !out || !codeEl) return;
      const opt = block.dataset.opt || "-O0";

      btn.addEventListener("click", async () => {
        if (btn.disabled) return;
        const original = btn.textContent;
        btn.disabled = true;
        btn.textContent = "⏳";
        out.hidden = false;
        const p = outPanel(out);
        p.title.textContent = "OUTPUT · gcc 15.2 x86-64 Linux " + opt;
        p.pre.classList.remove("err", "warn");
        p.pre.textContent = "⏳ بيعمل compile ويشغّل على Compiler Explorer…";
        p.time.textContent = "";
        p.exit.textContent = "";
        const started = performance.now();
        try {
          const result = await runC(codeEl.textContent, opt);
          renderRunResult(p.pre, result);
          if (result.exitCode !== null && result.exitCode !== undefined) p.exit.textContent = "exit code: " + result.exitCode;
          p.time.textContent = "⏱ " + ((performance.now() - started) / 1000).toFixed(2) + "s";
        } catch (err) {
          if (baked) {
            p.pre.textContent = baked.textContent;
            p.title.textContent = "OUTPUT (نسخة متحققة مسبقًا — مفيش اتصال بـ Compiler Explorer)";
          } else {
            p.pre.classList.add("err");
            p.pre.textContent = "تعذّر الاتصال بـ Compiler Explorer. اتأكد من الإنترنت وجرّب تاني.";
          }
        } finally {
          btn.disabled = false;
          btn.textContent = original;
        }
      });
    });
  }

  /* ---------------- Assembly viewer ---------------- */
  function openAsmPanel(host, getSource, anchorAfter) {
    let panel = host.querySelector(":scope > .asm-panel");
    if (panel) {
      panel.hidden = !panel.hidden;
      return;
    }
    panel = document.createElement("div");
    panel.className = "asm-panel";
    panel.innerHTML =
      '<div class="asm-head"><span class="asm-title">⚙ Assembly · x86-64 gcc 15.2 · Intel syntax</span>' +
      '<div class="opt-switch" role="group" aria-label="مستوى الـ optimization">' +
      '<button type="button" data-opt="-O0" class="on">-O0</button>' +
      '<button type="button" data-opt="-O1">-O1</button>' +
      '<button type="button" data-opt="-O2">-O2</button>' +
      '<button type="button" data-opt="-Os">-Os</button></div></div>' +
      '<pre class="asm-pre"><code class="language-asm"></code></pre>' +
      '<div class="asm-note">جرّب تغيّر الـ optimization وشوف الكود بيتغيّر إزاي — ده بالظبط اللي هتشوفه في IDA / Ghidra.</div>';
    anchorAfter.insertAdjacentElement("afterend", panel);
    const codeEl = panel.querySelector("code");
    const load = async (opt) => {
      $$(".opt-switch button", panel).forEach((b) => b.classList.toggle("on", b.dataset.opt === opt));
      codeEl.textContent = "⏳ بيعمل compile لـ " + opt + "…";
      try {
        const r = await compileAsm(getSource(), opt);
        if (r.err) { codeEl.textContent = r.err; return; }
        codeEl.innerHTML = highlightAsm(r.asm || "(مفيش كود)");
      } catch (e) {
        codeEl.textContent = "تعذّر الاتصال بـ Compiler Explorer. اتأكد من الإنترنت.";
      }
    };
    $$(".opt-switch button", panel).forEach((b) => b.addEventListener("click", () => load(b.dataset.opt)));
    load(host.dataset.opt || "-O0");
  }

  function initAsmButtons() {
    $$(".code-block[data-run]").forEach((block) => {
      const tools = block.querySelector(".code-tools");
      const codeEl = block.querySelector(".code-body code");
      if (!tools || !codeEl || tools.querySelector(".asm-mini")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "asm-mini";
      btn.textContent = "⚙ ASM";
      btn.title = "اعرض الـ Assembly اللي الـ compiler طلّعه";
      tools.insertBefore(btn, tools.firstChild);
      btn.addEventListener("click", () => {
        const anchor = block.querySelector(".run-out") || block.querySelector(".code-body");
        openAsmPanel(block, () => codeEl.textContent, anchor);
      });
    });
  }

  /* ---------------- Navigation ---------------- */
  const sections = $$("main .section[data-nav]");
  const nav = $("#nav");
  const navLinks = new Map();

  function initNav() {
    if (!nav) return;
    let currentPart = null;
    sections.forEach((section) => {
      if (section.dataset.part && section.dataset.part !== currentPart) {
        currentPart = section.dataset.part;
        const h = document.createElement("div");
        h.className = "nav-part";
        h.textContent = currentPart;
        nav.appendChild(h);
      }
      const a = document.createElement("a");
      a.href = "#" + section.id;
      a.dataset.target = section.id;
      const num = document.createElement("span");
      num.className = "num";
      const idx = section.querySelector(".section-index");
      num.textContent = idx ? idx.textContent.trim() : "";
      const ico = document.createElement("span");
      ico.className = "ico";
      ico.textContent = section.dataset.icon || "•";
      const txt = document.createElement("span");
      txt.className = "txt";
      txt.textContent = section.dataset.nav || section.id;
      const tick = document.createElement("span");
      tick.className = "tick";
      tick.textContent = "✓";
      a.append(num, ico, txt, tick);
      nav.appendChild(a);
      navLinks.set(section.id, a);
    });
  }

  function initActiveSection() {
    const update = () => {
      let current = null;
      sections.forEach((s) => { if (s.getBoundingClientRect().top <= 150) current = s.id; });
      navLinks.forEach((link, id) => link.classList.toggle("active", id === current));
    };
    let ticking = false;
    window.addEventListener("scroll", () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => { update(); ticking = false; });
    }, { passive: true });
    update();
  }

  function initNavSearch() {
    const input = $("#navSearch");
    if (!input) return;
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      $$(".nav a").forEach((link) => {
        const section = document.getElementById(link.dataset.target);
        const hay = (link.textContent + " " + (section ? section.dataset.keywords || "" : "")).toLowerCase();
        link.classList.toggle("hide", q !== "" && hay.indexOf(q) === -1);
      });
      $$(".nav .nav-part").forEach((part) => part.classList.toggle("hide", q !== ""));
    });
  }

  function initDrawer() {
    const sidebar = $("#sidebar"), scrim = $("#scrim"), menuBtn = $("#menuBtn"), closeBtn = $("#sidebarClose");
    const open = () => {
      sidebar.classList.add("open"); scrim.classList.add("show");
      menuBtn.setAttribute("aria-expanded", "true"); document.body.style.overflow = "hidden";
    };
    const close = () => {
      sidebar.classList.remove("open"); scrim.classList.remove("show");
      menuBtn.setAttribute("aria-expanded", "false"); document.body.style.overflow = "";
    };
    if (menuBtn) menuBtn.addEventListener("click", open);
    if (closeBtn) closeBtn.addEventListener("click", close);
    if (scrim) scrim.addEventListener("click", close);
    nav.addEventListener("click", (e) => { if (e.target.closest("a") && window.innerWidth <= 980) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && sidebar.classList.contains("open")) close(); });
  }

  /* ---------------- Progress ---------------- */
  const quizzes = $$(".quiz[data-ex]");
  const challenges = $$(".challenge[data-ex]");
  const projectChecks = $$(".project[data-ex]");
  const totalExercises = quizzes.length + challenges.length + projectChecks.length;

  const scrollBar = $("#scrollBar");
  const topRing = $("#topRing"), topProgress = $("#topProgress");
  const sideRing = $("#sideRing"), sidePercent = $("#sidePercent"), sideCount = $("#sideCount");
  const finalSolved = $("#finalSolved"), finalTotal = $("#finalTotal"), finalSections = $("#finalSections");

  function solvedCount() {
    let n = 0;
    quizzes.forEach((q) => { if (state.quizzes[q.dataset.ex]) n++; });
    challenges.forEach((c) => { if (state.challenges[c.dataset.ex]) n++; });
    projectChecks.forEach((p) => { if (state.projects[p.dataset.ex]) n++; });
    return n;
  }

  function updateProgress() {
    const solved = solvedCount();
    const ratio = totalExercises ? solved / totalExercises : 0;
    const percent = Math.round(ratio * 100);
    if (topProgress) topProgress.textContent = percent + "%";
    if (sidePercent) sidePercent.textContent = percent + "%";
    if (sideCount) sideCount.textContent = solved + " من " + totalExercises + " تمرين";
    if (topRing) topRing.style.strokeDashoffset = String(63 - 63 * ratio);
    if (sideRing) sideRing.style.strokeDashoffset = String(163 - 163 * ratio);
    if (finalSolved) finalSolved.textContent = solved;
    if (finalTotal) finalTotal.textContent = totalExercises;

    let doneSections = 0;
    sections.forEach((section) => {
      const qs = $$(".quiz[data-ex]", section);
      const cs = $$(".challenge[data-ex]", section);
      const ps = $$(".project[data-ex]", section);
      if (!qs.length && !cs.length && !ps.length) return;
      const allDone = qs.every((q) => state.quizzes[q.dataset.ex]) &&
        cs.every((c) => state.challenges[c.dataset.ex]) &&
        ps.every((p) => state.projects[p.dataset.ex]);
      if (allDone) doneSections++;
      const link = navLinks.get(section.id);
      if (link) link.classList.toggle("done", allDone);
    });
    if (finalSections) finalSections.textContent = doneSections;

    if (ratio === 1 && totalExercises > 0 && !state.celebrated) {
      state.celebrated = true;
      saveState();
      confetti();
      toast("🎉 مبروك! خلصت كل تمارين الكورس", "🏆");
    }
  }

  /* ---------------- Quizzes ---------------- */
  function initQuizzes() {
    quizzes.forEach((quiz) => {
      const id = quiz.dataset.ex;
      const answer = Number(quiz.dataset.answer);
      const options = $$(".option", quiz);
      const feedback = quiz.querySelector(".quiz-feedback");

      if (state.quizzes[id]) {
        quiz.classList.add("solved");
        options.forEach((opt) => {
          opt.disabled = true;
          if (Number(opt.dataset.i) === answer) {
            opt.classList.add("correct");
            const mark = opt.querySelector(".mark");
            if (mark) mark.textContent = "✓";
          }
        });
        if (feedback) {
          feedback.className = "quiz-feedback show good";
          feedback.innerHTML = "<strong>تم حلها قبل كده ✓</strong> " + (feedback.dataset.good || "");
        }
      }

      options.forEach((opt) => {
        opt.addEventListener("click", () => {
          if (quiz.classList.contains("solved") || opt.disabled) return;
          const mark = opt.querySelector(".mark");
          if (Number(opt.dataset.i) === answer) {
            options.forEach((o) => { o.disabled = true; o.classList.remove("wrong"); });
            opt.classList.add("correct");
            if (mark) mark.textContent = "✓";
            quiz.classList.add("solved");
            if (feedback) {
              feedback.className = "quiz-feedback show good";
              feedback.innerHTML = "<strong>إجابة صحيحة ✅</strong> " + (feedback.dataset.good || "");
            }
            state.quizzes[id] = true;
            saveState();
            updateProgress();
            toast("إجابة صحيحة — اتسجلت", "✅");
          } else {
            opt.classList.add("wrong");
            opt.disabled = true;
            if (mark) mark.textContent = "✗";
            if (feedback) {
              feedback.className = "quiz-feedback show bad";
              feedback.innerHTML = "<strong>مش صح ❌</strong> " + (feedback.dataset.bad || "");
            }
          }
        });
      });
    });
  }

  /* ---------------- Code challenges ---------------- */
  function initChallenges() {
    challenges.forEach((challenge) => {
      const id = challenge.dataset.ex;
      const editor = challenge.querySelector("textarea");
      const runBtn = challenge.querySelector(".btn-run");
      const asmBtn = challenge.querySelector(".btn-asm");
      const resetBtn = challenge.querySelector(".btn-reset");
      const solBtn = challenge.querySelector(".btn-solution");
      const status = challenge.querySelector(".ch-status");
      const consoleEl = challenge.querySelector(".console");
      const outPre = consoleEl ? consoleEl.querySelector("pre") : null;
      const expectedEl = challenge.querySelector(".expected");
      const solutionEl = challenge.querySelector(".solution");
      const stdinEl = challenge.querySelector(".stdin");
      const expected = expectedEl ? expectedEl.textContent : null;
      const solution = solutionEl ? solutionEl.textContent : "";
      const stdin = stdinEl ? stdinEl.textContent : "";
      const starter = editor ? editor.value : "";
      let solutionWrap = null;
      let running = false;

      if (editor && state.code[id]) editor.value = state.code[id];

      const autoGrow = () => {
        if (!editor) return;
        editor.style.height = "auto";
        editor.style.height = Math.min(Math.max(editor.scrollHeight, 150), 600) + "px";
      };
      autoGrow();

      const setStatus = (text, cls) => {
        if (!status) return;
        status.textContent = text;
        status.className = "ch-status" + (cls ? " " + cls : "");
      };
      if (state.challenges[id]) {
        challenge.classList.add("done");
        setStatus("تم الحل ✓", "pass");
      }

      const showSolution = () => {
        if (!solutionWrap) {
          solutionWrap = document.createElement("div");
          solutionWrap.className = "solution-wrap";
          const head = document.createElement("div");
          head.className = "sol-head";
          head.textContent = "💡 الحل المقترح (متحقق منه بالـ compiler)";
          const pre = document.createElement("pre");
          const code = document.createElement("code");
          code.className = "language-c";
          code.innerHTML = highlightC(solution.replace(/^\n+|\s+$/g, ""));
          pre.appendChild(code);
          solutionWrap.append(head, pre);
          challenge.querySelector(".ch-actions").insertAdjacentElement("afterend", solutionWrap);
          solutionWrap.hidden = true;
        }
        solutionWrap.hidden = !solutionWrap.hidden;
        if (solBtn) solBtn.textContent = solutionWrap.hidden ? "اعرض الحل" : "إخفاء الحل";
      };

      async function run() {
        if (!editor || running) return;
        running = true;
        const original = runBtn ? runBtn.innerHTML : "";
        if (runBtn) { runBtn.disabled = true; runBtn.innerHTML = '<span class="spinner"></span> بيعمل compile…'; }
        if (consoleEl) consoleEl.hidden = false;
        if (outPre) { outPre.classList.remove("err", "warn"); outPre.textContent = "⏳ gcc بيشتغل على Compiler Explorer…"; }
        setStatus("بيشغّل…", "");
        state.code[id] = editor.value;
        saveState();
        try {
          const result = await runC(editor.value, "-O0", stdin);
          if (result.compileError) {
            renderRunResult(outPre, result);
            setStatus("❌ الكود مش بيعمل compile — اقرأ رسالة الـ compiler", "fail");
          } else if (expected !== null) {
            const pass = normalizeOutput(result.out) === normalizeOutput(expected);
            if (pass) {
              renderRunResult(outPre, result);
              challenge.classList.add("done");
              setStatus("✅ مخرجات صحيحة", "pass");
              if (!state.challenges[id]) {
                state.challenges[id] = true;
                saveState();
                updateProgress();
                toast("تحدي مكتمل! +1", "🎯");
              }
            } else {
              outPre.classList.remove("err");
              outPre.textContent = (result.out || "(مفيش مخرجات)") +
                (result.err && result.err.trim() ? "\n\n[stderr]\n" + result.err : "") +
                "\n\n─── المتوقع ───\n" + expected.replace(/\n+$/, "");
              setStatus("❌ المخرجات مختلفة — قارن سطر بسطر", "fail");
            }
          } else {
            renderRunResult(outPre, result);
            setStatus("تم التشغيل", "pass");
          }
        } catch (err) {
          outPre.classList.add("err");
          outPre.textContent = "تعذّر الاتصال بـ Compiler Explorer (godbolt.org).\nاتأكد من الإنترنت وجرّب تاني — أو انسخ الكود وشغّله على جهازك بـ gcc.";
          setStatus("❌ فشل الاتصال", "fail");
        } finally {
          running = false;
          if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = original; }
        }
      }

      if (runBtn) runBtn.addEventListener("click", run);
      if (asmBtn && editor) asmBtn.addEventListener("click", () => {
        openAsmPanel(challenge, () => editor.value, consoleEl || challenge.querySelector(".ch-actions"));
      });
      if (solBtn) solBtn.addEventListener("click", showSolution);
      if (resetBtn && editor) resetBtn.addEventListener("click", () => {
        editor.value = starter;
        state.code[id] = starter;
        saveState();
        autoGrow();
        setStatus("", "");
        if (consoleEl) consoleEl.hidden = true;
        toast("تمت استعادة الكود الأصلي", "↺");
      });

      if (editor) {
        let codeTimer = null;
        editor.addEventListener("input", () => {
          autoGrow();
          clearTimeout(codeTimer);
          codeTimer = setTimeout(() => { state.code[id] = editor.value; saveState(); }, 300);
        });
        editor.addEventListener("keydown", (e) => {
          if (e.key === "Tab") {
            e.preventDefault();
            editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
            return;
          }
          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); run(); return; }
          if (e.key === "Enter" && editor.selectionStart === editor.selectionEnd) {
            const pos = editor.selectionStart;
            const line = editor.value.slice(0, pos).split("\n").pop();
            let indent = (line.match(/^[ \t]*/) || [""])[0];
            if (/\{\s*$/.test(line)) indent += "    ";
            if (indent) { e.preventDefault(); editor.setRangeText("\n" + indent, pos, pos, "end"); }
          }
        });
      }
    });
  }

  /* ---------------- Projects (self-checked milestones) ---------------- */
  function initProjects() {
    $$(".project-head").forEach((head) => {
      const toggle = () => {
        const project = head.parentElement;
        const isOpen = project.classList.toggle("open");
        head.setAttribute("aria-expanded", isOpen ? "true" : "false");
      };
      head.addEventListener("click", toggle);
      head.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
      });
    });
    projectChecks.forEach((project) => {
      const id = project.dataset.ex;
      const btn = project.querySelector(".btn-done");
      const sync = () => {
        const done = Boolean(state.projects[id]);
        project.classList.toggle("done", done);
        if (btn) btn.textContent = done ? "✓ المشروع مكتمل (اضغط للتراجع)" : "علّم المشروع كمكتمل";
      };
      sync();
      if (btn) btn.addEventListener("click", () => {
        state.projects[id] = !state.projects[id];
        saveState();
        sync();
        updateProgress();
        if (state.projects[id]) toast("مشروع مكتمل! 🛠️", "🏗️");
      });
    });
  }

  /* ---------------- Cheat sheet search ---------------- */
  function initCheatSearch() {
    const input = $("#cheatSearch"), grid = $("#cheatGrid");
    if (!input || !grid) return;
    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      $$(".cheat-card", grid).forEach((card) => {
        card.classList.toggle("hide", q !== "" && card.textContent.toLowerCase().indexOf(q) === -1);
      });
    });
  }

  /* ---------------- Number-base converter widget ---------------- */
  function initConverter() {
    const box = $("#baseConv");
    if (!box) return;
    const input = $("#bcInput", box), width = $("#bcWidth", box), outEl = $("#bcOut", box);
    const render = () => {
      const bits = Number(width.value);
      const raw = input.value.trim().toLowerCase();
      let v;
      try {
        if (!raw) { outEl.innerHTML = ""; return; }
        if (/^-?0x[0-9a-f]+$/.test(raw)) v = BigInt(raw.replace(/^-/, "")) * (raw.startsWith("-") ? -1n : 1n);
        else if (/^-?0b[01]+$/.test(raw)) v = BigInt(raw.replace(/^-/, "")) * (raw.startsWith("-") ? -1n : 1n);
        else if (/^-?\d+$/.test(raw)) v = BigInt(raw);
        else throw new Error("bad");
      } catch (e) {
        outEl.innerHTML = '<div class="bc-err">اكتب رقم عشري (مثل 255 أو -1) أو hex (0xff) أو binary (0b1010)</div>';
        return;
      }
      const mod = 1n << BigInt(bits);
      const u = ((v % mod) + mod) % mod;
      const s = u >= mod >> 1n ? u - mod : u;
      const hex = u.toString(16).padStart(bits / 4, "0");
      const bin = u.toString(2).padStart(bits, "0").replace(/(.{4})(?=.)/g, "$1 ");
      const bytesBE = hex.match(/../g);
      const bytesLE = bytesBE.slice().reverse();
      const overflow = v !== u && v !== s;
      outEl.innerHTML =
        '<div class="bc-row"><span>unsigned</span><code>' + u.toString() + "</code></div>" +
        '<div class="bc-row"><span>signed (two\'s complement)</span><code>' + s.toString() + "</code></div>" +
        '<div class="bc-row"><span>hex</span><code>0x' + hex.toUpperCase() + "</code></div>" +
        '<div class="bc-row"><span>binary</span><code>' + bin + "</code></div>" +
        '<div class="bc-row"><span>bytes في الذاكرة (little-endian)</span><code>' + bytesLE.join(" ").toUpperCase() + "</code></div>" +
        '<div class="bc-row"><span>bytes (big-endian / network order)</span><code>' + bytesBE.join(" ").toUpperCase() + "</code></div>" +
        (overflow ? '<div class="bc-warn">⚠ الرقم ده مش بيكفي في ' + bits + " bit — اتعمله truncate (اتقص) زي ما الـ CPU بيعمل بالظبط.</div>" : "");
    };
    input.addEventListener("input", render);
    width.addEventListener("change", render);
    render();
  }

  /* ---------------- Scroll UI / reveal / counters ---------------- */
  function initScrollUI() {
    const toTop = $("#toTop");
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const ratio = max > 0 ? Math.min(1, Math.max(0, doc.scrollTop / max)) : 0;
      if (scrollBar) scrollBar.style.width = (ratio * 100).toFixed(2) + "%";
      if (toTop) toTop.classList.toggle("show", doc.scrollTop > 700);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: REDUCED ? "auto" : "smooth" }));
  }

  function initReveal() {
    const items = $$(".reveal");
    if (!items.length) return;
    if (!("IntersectionObserver" in window) || REDUCED) { items.forEach((el) => el.classList.add("in")); return; }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { entry.target.classList.add("in"); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    items.forEach((el) => observer.observe(el));
  }

  function initCounters() {
    const stats = $$(".stat b[data-count]");
    const animate = (el) => {
      const target = Number(el.dataset.count) || 0;
      const suffix = el.dataset.suffix || "";
      if (REDUCED) { el.textContent = target + suffix; return; }
      const start = performance.now();
      const tick = (now) => {
        const p = Math.min(1, (now - start) / 1100);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3))) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    if (!("IntersectionObserver" in window)) { stats.forEach(animate); return; }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) { animate(entry.target); observer.unobserve(entry.target); }
      });
    }, { threshold: 0.6 });
    stats.forEach((el) => observer.observe(el));
  }

  /* ---------------- Reset ---------------- */
  function initReset() {
    const btn = $("#resetProgress");
    if (!btn) return;
    btn.addEventListener("click", () => {
      if (!window.confirm("متأكد؟ هيتم مسح كل إجاباتك والكود المحفوظ في التحديات والمشاريع.")) return;
      state.quizzes = {}; state.challenges = {}; state.code = {}; state.projects = {}; state.celebrated = false;
      saveState();
      window.location.reload();
    });
  }

  /* ---------------- Confetti ---------------- */
  function confetti() {
    if (REDUCED) return;
    const canvas = $("#confetti");
    const ctx = canvas && canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#3ddc97", "#ffb454", "#a78bfa", "#5cc8ff", "#ff6b81", "#ffffff"];
    const parts = Array.from({ length: 150 }, () => ({
      x: window.innerWidth / 2 + (Math.random() - 0.5) * 260, y: window.innerHeight * 0.28 + Math.random() * 80,
      vx: (Math.random() - 0.5) * 11, vy: -Math.random() * 12 - 3, size: 5 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)], rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3
    }));
    const start = performance.now();
    const draw = (now) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      parts.forEach((p) => {
        p.vy += 0.24; p.vx *= 0.995; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
        ctx.save();
        ctx.globalAlpha = Math.max(0, 1 - elapsed / 4200);
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });
      if (elapsed < 4200) requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    requestAnimationFrame(draw);
  }

  /* ---------------- Shortcuts / print ---------------- */
  function initShortcuts() {
    const navSearch = $("#navSearch");
    document.addEventListener("keydown", (e) => {
      const el = document.activeElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        if (window.innerWidth <= 980) { $("#sidebar").classList.add("open"); $("#scrim").classList.add("show"); }
        if (navSearch) navSearch.focus();
      }
      if (e.key === "Escape" && el === navSearch) {
        navSearch.value = "";
        navSearch.dispatchEvent(new Event("input"));
        navSearch.blur();
      }
    });
  }
  function initPrint() {
    const btn = $("#printBtn");
    if (btn) btn.addEventListener("click", () => window.print());
  }

  function boot() {
    initTheme();
    initNav();
    initActiveSection();
    initNavSearch();
    initDrawer();
    initCodeBlocks();
    initExampleRunners();
    initAsmButtons();
    initQuizzes();
    initChallenges();
    initProjects();
    initCheatSearch();
    initConverter();
    initScrollUI();
    initReveal();
    initCounters();
    initReset();
    initShortcuts();
    initPrint();
    updateProgress();
    requestAnimationFrame(() => $$(".hero .reveal").forEach((el) => el.classList.add("in")));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
