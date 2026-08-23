#!/usr/bin/env node
/**
 * build-site.js — Zero-dependency static site generator for Marketing Skills.
 *
 * Reads every skills/<name>/SKILL.md, renders a browsable website into _site/:
 *   _site/index.html               landing page with searchable skill grid
 *   _site/skills/<name>/index.html one page per skill
 *   _site/styles.css               shared stylesheet
 *
 * Usage:
 *   node tools/build-site.js            # build into ./_site
 *   node tools/build-site.js --out dist # build into ./dist
 *
 * No npm install required — includes a small built-in Markdown renderer.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKILLS_DIR = path.join(ROOT, "skills");
const outArgIndex = process.argv.indexOf("--out");
const OUT = path.resolve(ROOT, outArgIndex !== -1 ? process.argv[outArgIndex + 1] : "_site");

const SITE = {
  title: "Marketing Skills for AI Agents",
  tagline:
    "A collection of AI agent skills for marketing — conversion optimization, copywriting, SEO, paid ads, and growth. Works with Claude Code, Codex, Cursor, Windsurf, and any agent that supports the Agent Skills spec.",
  repo: "https://github.com/coreyhaines31/marketingskills",
};

// ---------------------------------------------------------------------------
// Minimal Markdown -> HTML renderer (block + inline). Good enough for SKILL.md.
// ---------------------------------------------------------------------------
function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderInline(text) {
  // Inline code first, protect its contents from other rules.
  const codes = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return ` CODE${codes.length - 1} `;
  });
  text = escapeHtml(text);
  // Links [text](url)
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, url) => {
    const safe = url.replace(/"/g, "&quot;");
    return `<a href="${safe}">${t}</a>`;
  });
  // Bold then italic
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  // Restore inline code
  text = text.replace(/ CODE(\d+) /g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return text;
}

function renderMarkdown(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    // Fenced code block
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${escapeHtml(buf.join("\n"))}</code></pre>`);
      continue;
    }

    // Blank line
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(\*\*\*|---|___)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // Table (header row followed by separator row)
    if (
      /^\s*\|.*\|\s*$/.test(line) &&
      i + 1 < lines.length &&
      /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) &&
      lines[i + 1].includes("-")
    ) {
      const splitRow = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const headers = splitRow(line);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = "<table><thead><tr>";
      t += headers.map((c) => `<th>${renderInline(c)}</th>`).join("");
      t += "</tr></thead><tbody>";
      for (const r of rows) {
        t += "<tr>" + r.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
      }
      t += "</tbody></table>";
      out.push(t);
      continue;
    }

    // Blockquote
    if (/^\s*>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(" "))}</blockquote>`);
      continue;
    }

    // Lists (unordered or ordered)
    const ulMatch = /^(\s*)[-*+]\s+(.*)$/.test(line);
    const olMatch = /^(\s*)\d+\.\s+(.*)$/.test(line);
    if (ulMatch || olMatch) {
      const ordered = olMatch && !ulMatch;
      const tag = ordered ? "ol" : "ul";
      const buf = [];
      const itemRe = ordered ? /^\s*\d+\.\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length && itemRe.test(lines[i])) {
        buf.push(`<li>${renderInline(lines[i].match(itemRe)[1])}</li>`);
        i++;
      }
      out.push(`<${tag}>${buf.join("")}</${tag}>`);
      continue;
    }

    // Paragraph. Always consume the current line first so we can't loop
    // forever on a line that matches no block but is excluded below (e.g. a
    // stray "| ... |" row that isn't part of a full table).
    const para = [lines[i]];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^\s*>/.test(lines[i]) &&
      !/^(\s*)[-*+]\s+/.test(lines[i]) &&
      !/^(\s*)\d+\.\s+/.test(lines[i]) &&
      !/^\s*\|.*\|\s*$/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(`<p>${renderInline(para.join(" "))}</p>`);
  }

  return out.join("\n");
}

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------
function parseSkill(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: null };
  const fm = m[1];
  const body = m[2];
  const name = (fm.match(/^name:\s*(.+)$/m) || [])[1]?.trim();
  const description = (fm.match(/^description:\s*([\s\S]*?)(?:\n[a-z_]+:|\n*$)/m) || [])[1]
    ?.replace(/\s+/g, " ")
    .trim();
  const version = (fm.match(/version:\s*([\d.]+)/) || [])[1];
  return { name, description, version, body };
}

// ---------------------------------------------------------------------------
// HTML templates
// ---------------------------------------------------------------------------
function page({ title, body, depth }) {
  const base = "../".repeat(depth);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(SITE.tagline)}">
<link rel="stylesheet" href="${base}styles.css">
</head>
<body>
<header class="site-header">
  <a class="brand" href="${base}index.html">Marketing Skills</a>
  <nav><a href="${SITE.repo}">GitHub</a></nav>
</header>
<main>
${body}
</main>
<footer class="site-footer">
  <p>Built by <a href="https://corey.co?ref=marketingskills">Corey Haines</a> · MIT License · <a href="${SITE.repo}">Source on GitHub</a></p>
</footer>
</body>
</html>`;
}

function truncate(s, n) {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

function landingPage(skills) {
  const cards = skills
    .map(
      (s) => `<a class="card" href="skills/${s.name}/index.html" data-name="${escapeHtml(s.name)}" data-desc="${escapeHtml((s.description || "").toLowerCase())}">
  <h3>${escapeHtml(s.name)}</h3>
  <p>${escapeHtml(truncate(s.description || "", 180))}</p>
</a>`
    )
    .join("\n");

  const body = `<section class="hero">
  <h1>${escapeHtml(SITE.title)}</h1>
  <p class="tagline">${escapeHtml(SITE.tagline)}</p>
  <div class="install">
    <code>/plugin marketplace add coreyhaines31/marketingskills</code>
  </div>
</section>
<section class="skills">
  <div class="toolbar">
    <h2>${skills.length} Skills</h2>
    <input id="search" type="search" placeholder="Search skills…" aria-label="Search skills">
  </div>
  <div class="grid" id="grid">
${cards}
  </div>
  <p id="noresults" hidden>No skills match your search.</p>
</section>
<script>
  const search = document.getElementById('search');
  const cards = [...document.querySelectorAll('.card')];
  const noresults = document.getElementById('noresults');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    let shown = 0;
    cards.forEach(c => {
      const hit = !q || c.dataset.name.includes(q) || c.dataset.desc.includes(q);
      c.hidden = !hit;
      if (hit) shown++;
    });
    noresults.hidden = shown !== 0;
  });
</script>`;
  return page({ title: SITE.title, body, depth: 0 });
}

function skillPage(s) {
  const versionBadge = s.version ? `<span class="badge">v${s.version}</span>` : "";
  const body = `<article class="skill">
  <p class="breadcrumb"><a href="../../index.html">← All skills</a></p>
  <h1>${escapeHtml(s.name)} ${versionBadge}</h1>
  <div class="content">
${renderMarkdown(s.body)}
  </div>
</article>`;
  return page({ title: `${s.name} — Marketing Skills`, body, depth: 2 });
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------
const CSS = `:root{--bg:#0f1115;--panel:#171a21;--border:#272b33;--text:#e6e8ec;--muted:#9aa3af;--accent:#6ea8fe;--accent2:#8b5cf6}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}
main{max-width:980px;margin:0 auto;padding:0 20px 64px}
.site-header{display:flex;justify-content:space-between;align-items:center;max-width:980px;margin:0 auto;padding:18px 20px}
.brand{font-weight:700;font-size:18px;color:var(--text)}
.site-header nav a{color:var(--muted)}
.hero{padding:48px 0 24px;border-bottom:1px solid var(--border)}
.hero h1{font-size:40px;line-height:1.15;margin:0 0 16px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}
.tagline{font-size:18px;color:var(--muted);max-width:760px}
.install{margin-top:24px}
.install code{display:inline-block;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 14px;font-size:14px;color:var(--text)}
.toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin:40px 0 20px;flex-wrap:wrap}
.toolbar h2{margin:0;font-size:22px}
#search{flex:1;min-width:220px;max-width:360px;background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:10px 14px;color:var(--text);font-size:15px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{display:block;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 18px 20px;transition:border-color .15s,transform .15s}
.card:hover{border-color:var(--accent);transform:translateY(-2px);text-decoration:none}
.card h3{margin:0 0 8px;font-size:17px;color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.card p{margin:0;color:var(--muted);font-size:14px}
#noresults{color:var(--muted);margin-top:24px}
.skill{padding-top:24px}
.breadcrumb{color:var(--muted)}
.badge{font-size:13px;background:var(--panel);border:1px solid var(--border);border-radius:999px;padding:2px 10px;vertical-align:middle;color:var(--muted);font-weight:400}
.content h1,.content h2,.content h3{margin-top:1.6em;line-height:1.25}
.content h2{border-bottom:1px solid var(--border);padding-bottom:6px}
.content code{background:var(--panel);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:.9em}
.content pre{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;overflow:auto}
.content pre code{background:none;border:none;padding:0}
.content table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}
.content th,.content td{border:1px solid var(--border);padding:8px 10px;text-align:left;vertical-align:top}
.content th{background:var(--panel)}
.content blockquote{border-left:3px solid var(--accent2);margin:16px 0;padding:4px 16px;color:var(--muted)}
.content hr{border:none;border-top:1px solid var(--border);margin:24px 0}
.site-footer{border-top:1px solid var(--border);padding:24px 20px;text-align:center;color:var(--muted);font-size:14px}
@media(max-width:600px){.hero h1{font-size:32px}}`;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------
function rmrf(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function build() {
  rmrf(OUT);
  fs.mkdirSync(path.join(OUT, "skills"), { recursive: true });

  const dirs = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();

  const skills = [];
  for (const dir of dirs) {
    const file = path.join(SKILLS_DIR, dir, "SKILL.md");
    if (!fs.existsSync(file)) continue;
    const s = parseSkill(file);
    if (!s.name) {
      console.warn(`! Skipping ${dir} (no frontmatter name)`);
      continue;
    }
    skills.push(s);
    const dest = path.join(OUT, "skills", s.name);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, "index.html"), skillPage(s));
  }

  fs.writeFileSync(path.join(OUT, "index.html"), landingPage(skills));
  fs.writeFileSync(path.join(OUT, "styles.css"), CSS);
  // Tell GitHub Pages not to run Jekyll over our output.
  fs.writeFileSync(path.join(OUT, ".nojekyll"), "");

  console.log(`Built ${skills.length} skill pages into ${path.relative(ROOT, OUT)}/`);
}

build();
