#!/usr/bin/env python3
"""Wrap each lesson body in _src/ with the shared head, course bar, pager and footer."""
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent
PAGES = [
    ("stack", "The stack"),
    ("shape", "Monolith or microservices"),
    ("data", "Where your data lives"),
    ("cloudflare", "Cloudflare, not Vercel"),
    ("zero-trust", "Zero Trust"),
    ("mac-app", "Same code, a Mac app"),
]
SHORT = ["Stack", "Shape", "Data", "Cloudflare", "Zero Trust", "Mac app"]

HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="claude:viewport-fit-sides" content="cover">
<title>{title} · Inside Kitestring</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&family=JetBrains+Mono:wght@400;600&display=swap">
<link rel="stylesheet" href="lesson.css">
<style>:root{{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}</style>
</head>
<body>
<a class="skip" href="#main">Skip to the lesson</a>
<header class="bar"><div class="bar-in">
  <a class="home" href="index.html">Inside Kitestring</a>
  <nav aria-label="Lessons"><ol>
{nav}
  </ol></nav>
</div></header>
<main id="main"><div class="col">
<p class="eyebrow">Lesson {n} of 6</p>
"""

FOOT = """
<nav class="pager" aria-label="Previous and next lesson">{prev}{next}</nav>
</div></main>
<footer class="foot"><div class="col">Written from the code in <code>the repository</code> on 24 Oct 2026.</div></footer>
</body>
</html>
"""

for i, (slug, title) in enumerate(PAGES):
    nav = "\n".join(
        f'    <li><a href="{s}.html"{" aria-current=\"page\"" if s == slug else ""}>{j + 1} {SHORT[j]}</a></li>'
        for j, (s, _) in enumerate(PAGES)
    )
    prev = f'<a href="{PAGES[i-1][0]}.html">← {PAGES[i-1][1]}</a>' if i else '<a href="index.html">← Overview</a>'
    nxt = f'<a href="{PAGES[i+1][0]}.html">{PAGES[i+1][1]} →</a>' if i + 1 < len(PAGES) else '<a href="index.html">Back to the overview →</a>'
    body = (HERE / f"{slug}.html").read_text()
    (OUT / f"{slug}.html").write_text(HEAD.format(title=title, nav=nav, n=i + 1) + body + FOOT.format(prev=prev, next=nxt))
    print("built", slug)
