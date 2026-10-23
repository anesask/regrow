
"""Render docs/WHITEPAPER.md to an A4 PDF with a headless Chromium browser (Edge or Chrome).

Usage (from the repo root): uv run --no-project --with markdown-it-py python scripts/whitepaper_pdf.py
Fonts: Neue Haas Grotesk Display when installed on the system, otherwise Inter / Segoe UI; IBM Plex Mono from
app/node_modules (pnpm install in app/). Output: docs/ReGrow_Whitepaper.pdf
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[1]
MONO = ROOT / "app" / "node_modules" / "@fontsource" / "ibm-plex-mono" / "files"
MARK = ROOT / "app" / "public" / "brand" / "regrow-mark-light.svg"


def font_faces() -> str:
    faces = []
    for weight, style, name in ((400, "normal", "Roman"), (400, "italic", "RomanItalic"), (500, "normal", "Mediu"),
                                (600, "normal", "Mediu"), (700, "normal", "Bold")):
        faces.append(f"@font-face{{font-family:'Body';font-weight:{weight};font-style:{style};"
                     f"src:local('NeueHaasDisplay-{name}'),local('Inter'),local('Segoe UI')}}")
    for weight in (400, 500, 600):
        f = MONO / f"ibm-plex-mono-latin-{weight}-normal.woff2"
        if f.exists():
            faces.append(f"@font-face{{font-family:'Mono';font-weight:{weight};src:url('{f.as_uri()}') format('woff2')}}")
    return "\n".join(faces)


CSS = """
@page { size: A4; margin: 15mm 16mm 16mm 16mm;
  @bottom-left { content: "ReGrow  ·  Whitepaper  ·  IEEE ClimateChain Global Hackathon 2026"; font: 7pt 'Body', 'Segoe UI', sans-serif; color: #8a8f88; }
  @bottom-right { content: counter(page) " / " counter(pages); font: 7pt 'Body', 'Segoe UI', sans-serif; color: #8a8f88; } }
:root { --ink: #06241a; --muted: #4b5a53; --rule: #d5ddd9; --hair: #e7ece9; --accent: #0f7f56; --link: #0d6647; --tint: #ecfaf3; --ember: #d0622b; }
html { font-size: 8.85pt; }
body { font-family: 'Body', 'Inter', 'Segoe UI', Arial, sans-serif; color: var(--ink); line-height: 1.4; margin: 0; letter-spacing: 0.012em;
  font-variant-ligatures: none; font-feature-settings: "liga" 0, "clig" 0; -webkit-font-smoothing: antialiased; }
p { margin: 0 0 0.5em 0; text-align: justify; hyphens: auto; orphans: 3; widows: 3; }
strong { font-weight: 600; }
em { font-style: italic; }
a { color: var(--link); text-decoration: none; overflow-wrap: anywhere; }
ul, ol { margin: 0.1em 0 0.6em 0; padding-left: 1.15em; }
li { margin: 0.18em 0; text-align: justify; hyphens: auto; }
li::marker { color: var(--accent); font-weight: 600; }
code { font-family: 'Mono', Consolas, monospace; font-size: 0.84em; background: #f3f7f5; border-radius: 3px; padding: 0.05em 0.3em; overflow-wrap: anywhere; }
pre { font-family: 'Mono', Consolas, monospace; font-size: 7.4pt; line-height: 1.5; background: #f3f7f5; border-left: 2px solid var(--accent);
  padding: 0.6em 0.9em; margin: 0.4em 0 0.8em 0; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: 1em; }

/* title block */
.title { margin: 0 0 1.1em 0; padding-bottom: 0.9em; border-bottom: 1.2px solid var(--ink); }
.eyebrow { font: 600 7.4pt 'Body', sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.9em; }
.brand { display: flex; align-items: center; gap: 11px; }
.brand img { width: 34px; height: 34px; }
.brand h1 { font-family: 'Body', sans-serif; font-weight: 500; font-size: 27pt; letter-spacing: -0.01em; margin: 0; line-height: 1; }
.subtitle { font-family: 'Body', sans-serif; font-weight: 400; font-size: 13.5pt; color: #1f3a30; margin: 0.55em 0 0.9em 0; line-height: 1.25; }
.meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.45em 1.6em; font-size: 7.9pt; }
.meta div { min-width: 0; }
.meta b { display: block; font-weight: 600; font-size: 6.6pt; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); margin-bottom: 0.1em; }

/* headings */
h2 { font-family: 'Body', sans-serif; font-weight: 500; font-size: 13pt; letter-spacing: -0.005em; margin: 1.05em 0 0.4em 0;
  padding-top: 0.45em; border-top: 0.6px solid var(--rule); break-after: avoid; }
h2 .n, h3 .n { color: var(--accent); margin-right: 0.45em; font-variant-numeric: tabular-nums; }
h3 { font-family: 'Body', sans-serif; font-weight: 500; font-size: 10.6pt; margin: 1em 0 0.35em 0; break-after: avoid; }
h2 + p, h3 + p { margin-top: 0; }
.title + h2 { border-top: none; padding-top: 0; margin-top: 0.2em; }
h2.refs + ul { font-size: 7.6pt; line-height: 1.35; }
h2.refs + ul li { text-align: left; }

/* tables: booktabs */
table { border-collapse: collapse; width: 100%; margin: 0.5em 0 0.85em 0; font-size: 7.7pt; line-height: 1.32; break-inside: avoid;
  border-top: 1.1px solid var(--ink); border-bottom: 1.1px solid var(--ink); font-variant-numeric: tabular-nums; }
th { font-weight: 600; text-align: left; padding: 4px 6px; border-bottom: 0.6px solid var(--ink); vertical-align: bottom; }
td { padding: 3.2px 6px; border-bottom: 0.4px solid var(--hair); vertical-align: top; }
td strong { color: var(--accent); }
tr:last-child td { border-bottom: none; }
td.num { white-space: nowrap; }

/* figure */
figure { margin: 0.4em 0 0.9em 0; break-inside: avoid; }
figure img { width: 100%; display: block; }
figcaption { font-size: 7.6pt; color: var(--muted); margin-top: 0.35em; }
figcaption b { color: var(--ink); font-weight: 600; }
"""

SKIP_META = ("Track", "Event")


def title_block(head: str) -> str:
    """The markdown header (h1, subtitle, bullet list) as a designed title block."""
    lines = [ln.strip() for ln in head.strip().splitlines() if ln.strip()]
    title = lines[0].lstrip("# ").strip()
    subtitle = next((ln for ln in lines[1:] if not ln.startswith("-")), "")
    md = MarkdownIt("commonmark")
    meta, eyebrow = [], {}
    for ln in lines:
        m = re.match(r"- \*\*(.+?):\*\*\s*(.+)", ln)
        if not m:
            continue
        if m.group(1) in SKIP_META:
            eyebrow[m.group(1)] = m.group(2)
        else:
            meta.append(f"<div><b>{m.group(1)}</b><span>{md.renderInline(m.group(2))}</span></div>")
    track = eyebrow.get("Track", "").split(" (")[0]
    mark = f'<img src="{MARK.as_uri()}" alt="">' if MARK.exists() else ""
    return (
        f'<header class="title"><div class="eyebrow">IEEE ClimateChain 2026 &nbsp;·&nbsp; {track} &nbsp;·&nbsp; Whitepaper</div>'
        f'<div class="brand">{mark}<h1>{title}</h1></div>'
        f'<p class="subtitle">{md.renderInline(subtitle)}</p><div class="meta">{"".join(meta)}</div></header>'
    )


def polish(body: str) -> str:
    # numbered headings: accent number
    body = re.sub(r"<h([23])>(\d+(?:\.\d+)?)\.?\s+", r'<h\1><span class="n">\2</span>', body)
    # the diagram as a captioned figure
    body = re.sub(
        r'<p><img src="([^"]+)" alt="([^"]*)" ?/?></p>',
        lambda m: f'<figure><img src="{m.group(1)}" alt="{m.group(2)}"><figcaption><b>Figure 1.</b> '
        "Open satellite pipeline, web app and API, and the contracts on Base Sepolia.</figcaption></figure>",
        body,
    )
    body = body.replace("<h2>References</h2>", '<h2 class="refs">References</h2>')
    # numeric cells never wrap
    return re.sub(r"<td>((?:<strong>)?[\d.,%/ x×≈+±-]+(?:</strong>)?)</td>", r'<td class="num">\1</td>', body)


def find_browser() -> str:
    for c in (r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
              r"C:\Program Files\Google\Chrome\Application\chrome.exe", "chromium", "chromium-browser", "google-chrome"):
        if Path(c).exists() or shutil.which(c):
            return c
    sys.exit("no Chromium-based browser found")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", default=ROOT / "docs" / "WHITEPAPER.md", type=Path)
    ap.add_argument("--out", default=ROOT / "docs" / "ReGrow_Whitepaper.pdf", type=Path)
    args = ap.parse_args()

    text = args.src.read_text(encoding="utf-8")
    head, _, rest = text.partition("\n## ")
    body = polish(MarkdownIt("commonmark").enable("table").render("## " + rest))
    page = (
        f'<!doctype html><html lang="en"><head><meta charset="utf-8"><style>{font_faces()}{CSS}</style></head>'
        f"<body>{title_block(head)}{body}</body></html>"
    )
    html_path = args.src.with_suffix(".html")
    html_path.write_text(page, encoding="utf-8")
    out = args.out.resolve()
    cmd = [find_browser(), "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--allow-file-access-from-files",
           f"--print-to-pdf={out}", html_path.resolve().as_uri()]
    subprocess.run(cmd, check=True, capture_output=True)
    html_path.unlink()
    pages = len(re.findall(rb"/Type\s*/Page[^s]", out.read_bytes()))
    print(f"{out.name}: {pages} pages, {out.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
