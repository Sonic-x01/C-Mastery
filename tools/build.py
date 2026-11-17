#!/usr/bin/env python3
"""
C Mastery — build + verification pipeline.

Expands the short authoring tags in src/sections/*.html into the final
index.html and *verifies every piece of code* before it can ship:

  <c-example file="x.c" [opt="-O2"] [norun] [allow-warn] [expect-error] [win] [posix] [std="c23"]>
      C code (raw text, no HTML escaping needed)
  </c-example>

  <cpp-example file="x.cpp" [opt] [norun] [win]>C++ code (g++, -std=c++20)</cpp-example>

  `posix` = needs Linux headers (fork, sockets, dlopen…): the local MinGW gcc
  cannot compile it, so it is verified on Compiler Explorer only, and any
  compiler warning there fails the build. `std` pins the C standard.

  <asm-block file="x.s" [title="..."]>raw assembly</asm-block>
  <plain-block file="terminal" [lang="bash"]>raw text</plain-block>

  <quiz id="s01-q1" answer="2">
    <q>question html</q>
    <o>option html</o> ... (2..5 options)
    <good>explanation html</good>
    <bad>hint html</bad>
  </quiz>

  <challenge id="s01-c1" title="..." [level="1|2|3"]>
    <desc>html</desc>
    <starter>raw C</starter>
    <expected>raw stdout</expected>
    <solution>raw C</solution>
    [<stdin>raw</stdin>]
  </challenge>

Checks performed (any failure aborts the build):
  1. Every runnable example + every challenge solution compiles with the
     local gcc:  -std=c17 -Wall -Wextra -Werror  (unless allow-warn).
     Examples marked `win` are compiled for Windows only (no remote run).
  2. Every runnable example is executed on Compiler Explorer (x86-64 gcc 15.2,
     Linux — the same target the page's Run button uses) and its real output
     is baked into the page as an offline fallback.
  3. Every challenge solution's output must equal <expected> exactly
     (after normalising trailing spaces / line endings).
  4. Every challenge starter must compile (it may produce wrong output).
  5. Quiz answer index in range, ids unique, 2..5 options.

Usage:
    python tools/build.py            # build + verify (uses cache)
    python tools/build.py --offline  # skip Compiler Explorer (uses cache only)
"""
from __future__ import annotations

import hashlib
import html
import json
import os
import re
import tempfile
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
CACHE_FILE = ROOT / "tools" / ".ce-cache.json"
CE_URL = "https://godbolt.org/api/compiler/cg152/compile"
BASE_FLAGS = "-std=c17 -Wall -Wextra -fdiagnostics-color=never -lm"
OFFLINE = "--offline" in sys.argv

errors: list[str] = []
stats = {"examples": 0, "runnable": 0, "quizzes": 0, "challenges": 0, "asm": 0, "projects": 0}


# --------------------------------------------------------------------------- utils
def esc(s: str) -> str:
    return html.escape(s, quote=False)


def esc_attr(s: str) -> str:
    return html.escape(s, quote=True)


def dedent_block(s: str) -> str:
    """Strip the first/last blank lines; keep inner formatting exactly."""
    s = s.replace("\r\n", "\n")
    s = re.sub(r"^\n+", "", s)
    s = re.sub(r"\s+$", "", s)
    return s


def normalize(text: str) -> str:
    lines = [ln.rstrip(" \t") for ln in text.replace("\r\n", "\n").split("\n")]
    return "\n".join(lines).strip("\n")


def attrs(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in re.finditer(r'([\w-]+)(?:="([^"]*)")?', raw):
        out[m.group(1)] = m.group(2) if m.group(2) is not None else ""
    return out


# --------------------------------------------------------------------------- cache
try:
    CACHE = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
except Exception:
    CACHE = {}
USED_KEYS: set[str] = set()      # entries touched by this build (stale ones get pruned)


def save_cache() -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(CACHE, indent=1, ensure_ascii=False, sort_keys=True), encoding="utf-8")


# --------------------------------------------------------------------------- gcc (local)
GCC = shutil.which("gcc")
GXX = shutil.which("g++")
TOOLCHAINS = {   # Compiler Explorer ids — must match TOOLCHAINS in assets/app.js
    "c":   {"id": "cg152", "lang": "c",   "std": "c17",   "libs": " -lm"},
    "cpp": {"id": "g152",  "lang": "c++", "std": "c++20", "libs": ""},
}


def ce_flags(lang: str, std: str | None) -> str:
    if lang == "c" and not std:
        return BASE_FLAGS               # unchanged → existing cache keys stay valid
    tc = TOOLCHAINS[lang]
    return f"-std={std or tc['std']} -Wall -Wextra -fdiagnostics-color=never{tc['libs']}"


def local_compile(code: str, label: str, allow_warn: bool, expect_error: bool, win: bool,
                  std: str | None = None, lang: str = "c", posix: bool = False) -> None:
    if posix:
        return                          # Linux-only headers: verified on Compiler Explorer instead
    compiler = GXX if lang == "cpp" else GCC
    if not compiler:
        errors.append(("g++" if lang == "cpp" else "gcc") + " not found on PATH — cannot verify " + label)
        return
    # Feed the source on stdin and write the object to an ASCII temp dir:
    # MinGW gcc cannot open paths containing non-ASCII characters.
    obj = os.path.join(tempfile.gettempdir(), "c-mastery-check.o")
    flags = ["-std=" + (std or TOOLCHAINS[lang]["std"]), "-Wall", "-Wextra", "-fdiagnostics-color=never",
             "-x", "c++" if lang == "cpp" else "c", "-c", "-o", obj]
    if not allow_warn and not expect_error:
        flags.insert(0, "-Werror")
    if not win:
        flags.append("-D__USE_MINGW_ANSI_STDIO=1")
    proc = subprocess.run([compiler, *flags, "-"], input=code + "\n", capture_output=True, text=True, encoding="utf-8")
    if expect_error:
        if proc.returncode == 0:
            errors.append(f"{label}: marked expect-error but compiled cleanly")
        return
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout).replace("<stdin>", "main.c")
        errors.append(f"{label}: local gcc failed:\n{msg}")


# --------------------------------------------------------------------------- Compiler Explorer
def ce_run(code: str, opt: str = "-O0", stdin: str = "", std: str | None = None, lang: str = "c") -> dict:
    flags = ce_flags(lang, std)
    key_parts = [code, opt, stdin, flags] if lang == "c" else [code, opt, stdin, flags, lang]
    key = hashlib.sha256(json.dumps(key_parts).encode()).hexdigest()
    USED_KEYS.add(key)
    if key in CACHE:
        return CACHE[key]
    if OFFLINE:
        return {"offline": True}
    tc = TOOLCHAINS[lang]
    body = {
        "source": code, "lang": tc["lang"], "allowStoreCodeDebug": False,
        "options": {
            "userArguments": opt + " " + flags,
            "executeParameters": {"args": [], "stdin": stdin},
            "compilerOptions": {"executorRequest": True},
            "filters": {"execute": True}, "tools": [], "libraries": [],
        },
    }
    last_exc = None
    for attempt in range(4):
        try:
            req = urllib.request.Request(f"https://godbolt.org/api/compiler/{tc['id']}/compile",
                                         data=json.dumps(body).encode(),
                                         headers={"Content-Type": "application/json", "Accept": "application/json",
                                                  "User-Agent": "c-mastery-course-build/1.0"})
            data = json.load(urllib.request.urlopen(req, timeout=60))
            break
        except Exception as exc:  # network hiccup / rate limit
            last_exc = exc
            time.sleep(2 + attempt * 3)
    else:
        raise RuntimeError(f"Compiler Explorer unreachable: {last_exc}")
    ansi = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
    join = lambda arr: ansi.sub("", "\n".join(x["text"] for x in (arr or [])))
    res = {
        "didExecute": bool(data.get("didExecute")),
        "code": data.get("code"),
        "stdout": join(data.get("stdout")),
        "stderr": join(data.get("stderr")),
        "build": join((data.get("buildResult") or {}).get("stderr")),
        "timedOut": bool(data.get("timedOut")),
    }
    CACHE[key] = res
    save_cache()
    time.sleep(0.35)  # be polite to the public service
    return res


# --------------------------------------------------------------------------- renderers
def render_code_block(code: str, filename: str, lang: str, runnable: bool, baked: str | None,
                      opt: str | None, extra_cls: str = "", extra_data: str = "") -> str:
    data = ""
    if runnable:
        data = " data-run" + extra_data
        if opt:
            data += f' data-opt="{esc_attr(opt)}"'
    tools = '<button class="copy" type="button">نسخ</button>'
    if runnable:
        tools = '<button class="run-mini" type="button">▶ تشغيل</button>' + tools
    cls = "code-block" + (" " + extra_cls if extra_cls else "")
    parts = [
        f'<div class="{cls}"{data}>',
        f'<div class="code-head"><div class="dots"><i></i><i></i><i></i></div><span class="filename">{esc(filename)}</span>',
        f'<div class="code-tools">{tools}</div></div>',
        f'<div class="code-body"><pre class="code-pre"><code class="language-{lang}">{esc(code)}</code></pre></div>',
    ]
    if runnable:
        parts.append('<div class="run-out" hidden></div>')
        if baked is not None:
            parts.append(f'<pre class="baked" hidden>{esc(baked)}</pre>')
    parts.append("</div>")
    return "".join(parts)


def expand_c_example(m: re.Match, where: str, lang: str = "c") -> str:
    a = attrs(m.group(1))
    code = dedent_block(m.group(2))
    filename = a.get("file", "main.cpp" if lang == "cpp" else "main.c")
    label = f"{where} › {filename}"
    stats["examples"] += 1
    norun = "norun" in a
    win = "win" in a
    posix = "posix" in a
    allow_warn = "allow-warn" in a
    expect_error = "expect-error" in a
    std = a.get("std") or None
    opt = a.get("opt")
    has_main = re.search(r"\bint\s+main\s*\(", code) is not None
    strict = (posix or lang == "cpp" or std) and not allow_warn and not expect_error

    local_compile(code, label, allow_warn, expect_error, win, std, lang, posix)

    runnable = not norun and not win and (has_main or expect_error)
    extra_data = (' data-lang="cpp"' if lang == "cpp" else "") + (f' data-std="{esc_attr(std)}"' if std else "")
    if posix and not runnable and not win:
        # Not executed, but still make sure it compiles on Linux.
        try:
            r = ce_run(code, opt or "-O0", "", std, lang) if has_main else None
            if r and not r.get("offline") and (not r["didExecute"] or (strict and "warning:" in r["build"])):
                errors.append(f"{label}: Linux compile problem on Compiler Explorer:\n{r['build']}")
        except RuntimeError as exc:
            errors.append(f"{label}: {exc}")
    baked = None
    if runnable:
        stats["runnable"] += 1
        try:
            r = ce_run(code, opt or "-O0", "", std, lang)
            if strict and not r.get("offline") and "warning:" in r.get("build", ""):
                errors.append(f"{label}: compiler warning on Compiler Explorer:\n{r['build']}")
        except RuntimeError as exc:
            errors.append(f"{label}: {exc}")
            r = {"offline": True}
        if r.get("offline"):
            baked = None
        elif expect_error:
            if r["didExecute"]:
                errors.append(f"{label}: expect-error but it compiled and ran on Compiler Explorer")
            baked = "✗ خطأ في الـ Compilation:\n\n" + r["build"].replace("<source>", "main.c")
        else:
            if not r["didExecute"]:
                errors.append(f"{label}: failed on Compiler Explorer:\n{r['build']}")
            elif r["timedOut"]:
                errors.append(f"{label}: timed out on Compiler Explorer")
            baked = r["stdout"] or "(البرنامج اتنفّذ بدون مخرجات)"
            if r.get("stderr"):
                baked += "\n\n[stderr]\n" + r["stderr"]
            if "expect-exit" in a and str(r["code"]) != a["expect-exit"]:
                errors.append(f"{label}: exit code {r['code']} != expected {a['expect-exit']}")
            elif "expect-exit" not in a and r["code"] not in (0, None) and "any-exit" not in a:
                errors.append(f"{label}: non-zero exit code {r['code']} (add any-exit if intended)\n{r['stdout'][:300]}{r['stderr'][:300]}")
            if "expect" in a and normalize(r["stdout"]) != normalize(a["expect"].replace("\\n", "\n")):
                errors.append(f"{label}: output mismatch.\n got: {r['stdout']!r}\n exp: {a['expect']!r}")
    return render_code_block(code, filename, "c", runnable, baked, opt, extra_data=extra_data)


def expand_asm(m: re.Match) -> str:
    a = attrs(m.group(1))
    stats["asm"] += 1
    return render_code_block(dedent_block(m.group(2)), a.get("file", "disassembly.asm"), "asm", False, None, None, "asm")


def expand_plain(m: re.Match) -> str:
    a = attrs(m.group(1))
    return render_code_block(dedent_block(m.group(2)), a.get("file", "terminal"), a.get("lang", "bash"), False, None, None)


QUIZ_IDS: set[str] = set()
LETTERS = "ABCDE"


def expand_quiz(raw_attrs: str, body: str, where: str) -> str:
    a = attrs(raw_attrs)
    body = expand_quiz_code(body)
    qid = a.get("id", "")
    stats["quizzes"] += 1
    if not qid or qid in QUIZ_IDS:
        errors.append(f"{where}: missing/duplicate quiz id {qid!r}")
    QUIZ_IDS.add(qid)
    q = re.search(r"<q>([\s\S]*?)</q>", body)
    opts = re.findall(r"<o>([\s\S]*?)</o>", body)
    good = re.search(r"<good>([\s\S]*?)</good>", body)
    bad = re.search(r"<bad>([\s\S]*?)</bad>", body)
    try:
        ans = int(a.get("answer", "-1"))
    except ValueError:
        ans = -1
    if not q or not good or not bad:
        errors.append(f"{where} › {qid}: quiz needs <q>, <good> and <bad>")
    if not 2 <= len(opts) <= 5:
        errors.append(f"{where} › {qid}: quiz needs 2..5 options, has {len(opts)}")
    if not 0 <= ans < len(opts):
        errors.append(f"{where} › {qid}: answer index {ans} out of range")
    opt_html = "".join(
        f'<button class="option" data-i="{i}"><span class="k">{LETTERS[i]}</span><span class="otxt">{o.strip()}</span><span class="mark"></span></button>'
        for i, o in enumerate(opts)
    )
    return (
        f'<div class="quiz" data-ex="{esc_attr(qid)}" data-answer="{ans}">'
        f'<div class="quiz-q">{q.group(1).strip() if q else ""}</div>'
        f'<div class="quiz-options">{opt_html}</div>'
        f'<div class="quiz-feedback" data-good="{esc_attr(good.group(1).strip() if good else "")}" '
        f'data-bad="{esc_attr(bad.group(1).strip() if bad else "")}"></div></div>'
    )


def expand_quiz_code(body: str) -> str:
    """Inside <q>, allow <pre-c>...</pre-c> / <pre-asm> raw code blocks."""
    body = re.sub(r"<pre-c>([\s\S]*?)</pre-c>",
                  lambda mm: f'<pre class="q-code"><code class="language-c">{esc(dedent_block(mm.group(1)))}</code></pre>', body)
    body = re.sub(r"<pre-asm>([\s\S]*?)</pre-asm>",
                  lambda mm: f'<pre class="q-code"><code class="language-asm">{esc(dedent_block(mm.group(1)))}</code></pre>', body)
    return body


CH_IDS: set[str] = set()


def expand_challenge(m: re.Match, where: str) -> str:
    a = attrs(m.group(1))
    body = m.group(2)
    cid = a.get("id", "")
    stats["challenges"] += 1
    label = f"{where} › {cid}"
    if not cid or cid in CH_IDS or cid in QUIZ_IDS:
        errors.append(f"{label}: missing/duplicate challenge id")
    CH_IDS.add(cid)

    def part(tag: str, required: bool = True) -> str | None:
        mm = re.search(rf"<{tag}>([\s\S]*?)</{tag}>", body)
        if not mm:
            if required:
                errors.append(f"{label}: missing <{tag}>")
            return None
        return mm.group(1)

    desc = (part("desc") or "").strip()
    starter = dedent_block(part("starter") or "")
    expected = dedent_block(part("expected") or "")
    solution = dedent_block(part("solution") or "")
    stdin_raw = part("stdin", required=False)
    stdin = dedent_block(stdin_raw) + "\n" if stdin_raw is not None else ""
    posix = "posix" in a
    std = a.get("std") or None
    lang = "cpp" if a.get("lang") == "cpp" else "c"

    local_compile(solution, label + " (solution)", False, False, False, std, lang, posix)
    local_compile(starter, label + " (starter)", True, False, False, std, lang, posix)
    try:
        r = ce_run(solution, "-O0", stdin, std, lang)
        if posix:   # the starter is only checked remotely for Linux-only code
            rs = ce_run(starter, "-O0", stdin, std, lang)
            if not rs.get("offline") and not rs["didExecute"] and "error" in rs["build"]:
                errors.append(f"{label}: starter does not compile on Compiler Explorer:\n{rs['build']}")
        if not r.get("offline"):
            if (posix or std or lang == "cpp") and "warning:" in r["build"]:
                errors.append(f"{label}: solution has compiler warnings:\n{r['build']}")
            if not r["didExecute"]:
                errors.append(f"{label}: solution failed on Compiler Explorer:\n{r['build']}")
            elif normalize(r["stdout"]) != normalize(expected):
                errors.append(f"{label}: solution output != expected\n--- got ---\n{r['stdout']}\n--- expected ---\n{expected}")
    except RuntimeError as exc:
        errors.append(f"{label}: {exc}")

    level = a.get("level", "1")
    lvl_txt = {"1": "أساسي", "2": "متوسط", "3": "متقدم"}.get(level, "أساسي")
    title = a.get("title", "تحدي")
    out = [
        f'<div class="challenge" data-ex="{esc_attr(cid)}"' + (f' data-std="{esc_attr(std)}"' if std else "")
        + (' data-lang="cpp"' if lang == "cpp" else "") + '>',
        f'<div class="ch-head"><span class="badge-code">{"C++" if lang == "cpp" else "C"}</span><h4>{title}<span class="lvl l{esc_attr(level)}">{lvl_txt}</span></h4></div>',
        f'<div class="ch-desc">{desc}</div>',
        f'<div class="editor"><div class="editor-bar"><span class="ed-dot"></span>{"main.cpp" if lang == "cpp" else "main.c"}<span class="ed-keys">Ctrl + Enter للتشغيل</span></div>',
        f'<textarea spellcheck="false" aria-label="محرر كود التحدي">{esc(starter)}\n</textarea></div>',
        '<div class="ch-actions"><button class="btn btn-sm btn-run" type="button">▶ تشغيل وتصحيح</button>',
        '<button class="btn btn-sm btn-ghost btn-asm" type="button">⚙ ASM</button>',
        '<button class="btn btn-sm btn-ghost btn-solution" type="button">اعرض الحل</button>',
        '<button class="btn btn-sm btn-ghost btn-reset" type="button">استعادة</button><span class="ch-status"></span></div>',
        f'<div class="console" hidden><div class="console-head"><span>Output · {"g++" if lang == "cpp" else "gcc"} 15.2 x86-64 Linux -O0</span></div><pre></pre></div>',
        f'<div class="expected" hidden>{esc(expected)}</div>',
        f'<div class="solution" hidden>{esc(solution)}</div>',
    ]
    if stdin_raw is not None:
        out.append(f'<div class="stdin" hidden>{esc(stdin)}</div>')
    out.append("</div>")
    return "".join(out)


# --------------------------------------------------------------------------- main
def process_section(text: str, where: str) -> str:
    text = re.sub(r"<c-example([^>]*)>([\s\S]*?)</c-example>", lambda m: expand_c_example(m, where), text)
    text = re.sub(r"<cpp-example([^>]*)>([\s\S]*?)</cpp-example>", lambda m: expand_c_example(m, where, "cpp"), text)
    text = re.sub(r"<asm-block([^>]*)>([\s\S]*?)</asm-block>", expand_asm, text)
    text = re.sub(r"<plain-block([^>]*)>([\s\S]*?)</plain-block>", expand_plain, text)
    text = re.sub(r"<quiz([^>]*)>([\s\S]*?)</quiz>", lambda m: expand_quiz(m.group(1), m.group(2), where), text)
    text = re.sub(r"<challenge([^>]*)>([\s\S]*?)</challenge>", lambda m: expand_challenge(m, where), text)
    stats["projects"] += len(re.findall(r'class="project[^"]*"[^>]*data-ex=', text))
    return text


def main() -> int:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    template = (SRC / "template.html").read_text(encoding="utf-8")
    files = sorted((SRC / "sections").glob("*.html"))
    rendered = []
    for f in files:
        print(f"  · {f.name}")
        rendered.append(process_section(f.read_text(encoding="utf-8"), f.stem))
    body = "\n".join(rendered)

    # Duplicate element ids & broken in-page links
    ids = re.findall(r'\sid="([^"]+)"', template + body)
    dups = sorted({i for i in ids if ids.count(i) > 1})
    if dups:
        errors.append("duplicate element ids: " + ", ".join(dups))
    for href in set(re.findall(r'href="#([^"]+)"', template + body)):
        if href not in ids:
            errors.append(f"broken in-page link: #{href}")
    leftovers = re.findall(r"</?(?:c-example|cpp-example|asm-block|plain-block|quiz|challenge|pre-c|pre-asm)\b", body)
    if leftovers:
        errors.append(f"unexpanded authoring tags: {set(leftovers)}")

    total_ex = stats["quizzes"] + stats["challenges"] + stats["projects"]
    page = (template
            .replace("{{SECTIONS}}", body)
            .replace("{{N_QUIZ}}", str(stats["quizzes"]))
            .replace("{{N_CH}}", str(stats["challenges"]))
            .replace("{{N_EX}}", str(stats["examples"]))
            .replace("{{N_RUN}}", str(stats["runnable"]))
            .replace("{{N_PROJ}}", str(stats["projects"]))
            .replace("{{N_TOTAL}}", str(total_ex))
            .replace("{{N_SECTIONS}}", str(len(re.findall(r'class="section"[^>]*data-nav=', body)))))

    print()
    print("  examples:", stats["examples"], "(runnable:", str(stats["runnable"]) + ")",
          "· asm blocks:", stats["asm"], "· quizzes:", stats["quizzes"],
          "· challenges:", stats["challenges"], "· projects:", stats["projects"])
    if errors:
        print(f"\n✗ BUILD FAILED — {len(errors)} problem(s):\n")
        for e in errors:
            print("  ✗ " + e.replace("\n", "\n    "))
        return 1
    (ROOT / "index.html").write_text(page, encoding="utf-8")
    if not OFFLINE:
        for stale in set(CACHE) - USED_KEYS:      # drop results for code that no longer exists
            del CACHE[stale]
        save_cache()
    print("\n✓ index.html written — every example and solution verified.")
    if OFFLINE:
        print("  (offline mode: outputs not re-verified for uncached code)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
