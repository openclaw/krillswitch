#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const docsDir = path.join(root, "docs");
const outDir = path.join(root, "dist", "docs-site");
const origin = "https://krillswitch.com";
const repo = "https://github.com/openclaw/krillswitch";

const sections = [
  ["Start", ["index.md", "getting-started.md", "core-concepts.md"]],
  [
    "Build",
    [
      "flag-model.md",
      "targeting.md",
      "cli.md",
      "core-sdk.md",
      "react-sdk.md",
      "api.md",
    ],
  ],
  [
    "Operate",
    [
      "admin-console.md",
      "auth-and-roles.md",
      "access-tokens.md",
      "deploy-cloudflare.md",
      "operations.md",
    ],
  ],
  ["Reference", ["security.md", "development.md", "troubleshooting.md"]],
];

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const pages = allMarkdown(docsDir).map((file) => {
  const rel = path.relative(docsDir, file).replaceAll(path.sep, "/");
  const { frontmatter, body } = parseFrontmatter(fs.readFileSync(file, "utf8"));
  return {
    file,
    rel,
    outRel: rel === "index.md" ? "index.html" : rel.replace(/\.md$/, ".html"),
    title:
      frontmatter.title ||
      body.match(/^#\s+(.+)$/m)?.[1]?.trim() ||
      titleize(rel),
    description: frontmatter.description || "KrillSwitch documentation",
    markdown: body,
  };
});

const pageMap = new Map(pages.map((page) => [page.rel, page]));
const nav = sections.map(([title, rels]) => ({
  title,
  pages: rels.map((rel) => pageMap.get(rel)).filter(Boolean),
}));
const ordered = nav.flatMap((section) => section.pages);

for (const page of pages) {
  const html = markdownToHtml(page.markdown, page.rel);
  const toc = collectToc(html);
  const index = ordered.findIndex((candidate) => candidate.rel === page.rel);
  const previous = index > 0 ? ordered[index - 1] : null;
  const next =
    index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;
  const destination = path.join(outDir, page.outRel);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(
    destination,
    layout({ page, html, toc, previous, next }),
    "utf8",
  );
}

copyTree(path.join(docsDir, "assets"), path.join(outDir, "assets"));
copyFile(path.join(docsDir, "CNAME"), path.join(outDir, "CNAME"));
copyFile(
  path.join(
    root,
    "apps",
    "admin",
    "src",
    "assets",
    "brand",
    "krillswitch_long_white_text.svg",
  ),
  path.join(outDir, "assets", "krillswitch-wordmark.svg"),
);
copyFont(
  "@fontsource/manrope/files/manrope-latin-400-normal.woff2",
  "manrope-400.woff2",
);
copyFont(
  "@fontsource/manrope/files/manrope-latin-700-normal.woff2",
  "manrope-700.woff2",
);
copyFont(
  "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  "plex-mono-400.woff2",
);
copyFont(
  "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  "plex-mono-500.woff2",
);

fs.writeFileSync(path.join(outDir, ".nojekyll"), "", "utf8");
fs.writeFileSync(
  path.join(outDir, "robots.txt"),
  `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
  "utf8",
);
fs.writeFileSync(path.join(outDir, "sitemap.xml"), sitemap(), "utf8");
fs.writeFileSync(path.join(outDir, "llms.txt"), llmsTxt(), "utf8");

validateLinks();
console.log(
  `built ${pages.length} documentation pages in ${path.relative(root, outDir)}`,
);

function layout({ page, html, toc, previous, next }) {
  const isHome = page.rel === "index.md";
  const navHtml = nav
    .map(
      (section) =>
        `<section><h2 class="nav-title">${escapeHtml(section.title)}</h2>${section.pages
          .map(
            (entry) =>
              `<a class="nav-link${entry.rel === page.rel ? " active" : ""}" href="${pageHref(entry)}" data-search="${escapeAttr(entry.title.toLowerCase())}">${escapeHtml(entry.title)}</a>`,
          )
          .join("")}</section>`,
    )
    .join("");
  const tocHtml = toc.length
    ? `<aside class="toc"><p>On this page</p>${toc.map((entry) => `<a class="toc-${entry.level}" href="#${entry.id}">${escapeHtml(entry.title)}</a>`).join("")}</aside>`
    : "";
  const pager = !isHome
    ? `<nav class="pager">${previous ? `<a href="${pageHref(previous)}"><span>Previous</span>${escapeHtml(previous.title)}</a>` : "<i></i>"}${next ? `<a class="next" href="${pageHref(next)}"><span>Next</span>${escapeHtml(next.title)}</a>` : ""}</nav>`
    : "";
  const hero = isHome
    ? `<header class="home-hero"><div class="status"><i></i>Edge-native feature control</div><h1>Ship switches.<br><em class="signal-word">Not surprises.</em></h1><p>KrillSwitch is a compact feature-flag service for teams that want deterministic evaluation, a fast operator console, and an audit trail they can actually read.</p><div class="actions"><a class="button primary" href="getting-started.html">Start building</a><a class="button" href="https://switch.openclaw.ai">Open dashboard</a><a class="button quiet" href="${repo}">View source ↗</a></div><div class="signal-grid"><div><strong>&lt;1 ms</strong><span>hot-path evaluation</span></div><div><strong>4 types</strong><span>boolean · string · number · JSON</span></div><div><strong>1 s</strong><span>configuration freshness bound</span></div></div></header>`
    : `<header class="page-head"><div><p>KrillSwitch docs</p><h1>${escapeHtml(page.title)}</h1></div><a href="${repo}/edit/main/docs/${page.rel}">Edit page ↗</a></header>`;

  return `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="theme-color" content="#07131d">
  <meta name="description" content="${escapeAttr(page.description)}">
  <meta property="og:title" content="${escapeAttr(page.title)} · KrillSwitch">
  <meta property="og:description" content="${escapeAttr(page.description)}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${origin}/${page.outRel === "index.html" ? "" : page.outRel}">
  <title>${escapeHtml(page.title)} · KrillSwitch</title>
  <script>try{const t=localStorage.getItem("ks-theme");if(t)document.documentElement.dataset.theme=t}catch{}</script>
  <link rel="stylesheet" href="assets/site.css">
</head>
<body class="${isHome ? "home" : "page"}">
  <button class="mobile-nav" type="button" aria-label="Open navigation" data-nav-toggle>Menu</button>
  <div class="shell">
    <aside class="sidebar" data-sidebar>
      <a class="brand" href="index.html"><img src="assets/krillswitch-wordmark.svg" alt="KrillSwitch"></a>
      <p class="brand-note">Feature flags. Small surface. Sharp edges.</p>
      <label class="search"><span>Search docs</span><input type="search" placeholder="Type to filter…" data-search-input></label>
      <nav data-nav>${navHtml}</nav>
      <div class="sidebar-foot"><button type="button" data-theme-toggle>Toggle theme</button><a href="${repo}">GitHub ↗</a></div>
    </aside>
    <main>
      ${hero}
      <div class="content-grid"><article class="doc">${html}${pager}</article>${tocHtml}</div>
      <footer><span>KrillSwitch · OpenClaw</span><span>Docs source: Markdown on GitHub</span></footer>
    </main>
  </div>
  <script src="assets/site.js"></script>
</body>
</html>\n`;
}

function markdownToHtml(markdown, currentRel) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const output = [];
  let paragraph = [];
  let list = null;
  let fence = null;
  let quote = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    output.push(`<p>${inline(paragraph.join(" "), currentRel)}</p>`);
    paragraph = [];
  };
  const closeList = () => {
    if (!list) return;
    output.push(`</${list}>`);
    list = null;
  };
  const flushQuote = () => {
    if (!quote.length) return;
    output.push(
      `<blockquote>${markdownToHtml(quote.join("\n"), currentRel)}</blockquote>`,
    );
    quote = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^```([\w+-]+)?\s*$/);
    if (fenceMatch) {
      flushParagraph();
      closeList();
      flushQuote();
      if (fence) {
        output.push(
          `<div class="code"><span>${escapeHtml(fence.language || "text")}</span><pre><code>${escapeHtml(fence.lines.join("\n"))}</code></pre></div>`,
        );
        fence = null;
      } else {
        fence = { language: fenceMatch[1] || "text", lines: [] };
      }
      continue;
    }
    if (fence) {
      fence.lines.push(line);
      continue;
    }
    if (/^>\s?/.test(line)) {
      flushParagraph();
      closeList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushQuote();
    if (!line.trim()) {
      flushParagraph();
      closeList();
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      closeList();
      const level = heading[1].length;
      const title = heading[2].trim();
      output.push(
        `<h${level} id="${slug(title)}">${inline(title, currentRel)}</h${level}>`,
      );
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      flushParagraph();
      closeList();
      output.push("<hr>");
      continue;
    }
    if (line.includes("|") && lines[index + 1]?.match(/^\s*\|?\s*:?-{2,}/)) {
      flushParagraph();
      closeList();
      const headers = splitRow(line);
      index += 1;
      const rows = [];
      while (lines[index + 1]?.includes("|") && lines[index + 1].trim()) {
        index += 1;
        rows.push(splitRow(lines[index]));
      }
      output.push(
        `<div class="table-wrap"><table><thead><tr>${headers.map((cell) => `<th>${inline(cell, currentRel)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell, currentRel)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`,
      );
      continue;
    }
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const orderedItem = line.match(/^\s*\d+\.\s+(.+)$/);
    if (unordered || orderedItem) {
      flushParagraph();
      const kind = unordered ? "ul" : "ol";
      if (list !== kind) {
        closeList();
        output.push(`<${kind}>`);
        list = kind;
      }
      output.push(
        `<li>${inline((unordered || orderedItem)[1], currentRel)}</li>`,
      );
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  closeList();
  flushQuote();
  if (fence) throw new Error(`unclosed code fence in ${currentRel}`);
  return output.join("\n");
}

function inline(value, currentRel) {
  const code = [];
  let text = value.replace(/`([^`]+)`/g, (_, content) => {
    code.push(`<code>${escapeHtml(content)}</code>`);
    return `@@KS_CODE_${code.length - 1}@@`;
  });
  text = escapeHtml(text)
    .replace(
      /\[([^\]]+)]\(([^)]+)\)/g,
      (_, label, href) =>
        `<a href="${escapeAttr(rewriteHref(href, currentRel))}">${label}</a>`,
    )
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
  return text.replace(/@@KS_CODE_(\d+)@@/g, (_, index) => code[Number(index)]);
}

function rewriteHref(href, currentRel) {
  if (/^(?:https?:|mailto:|#)/.test(href)) return href;
  const [pathname, hash = ""] = href.split("#");
  if (!pathname.endsWith(".md")) return href;
  const currentDir = path.posix.dirname(currentRel);
  const target = path.posix.normalize(path.posix.join(currentDir, pathname));
  const page = pageMap.get(target);
  return `${page ? pageHref(page) : pathname.replace(/\.md$/, ".html")}${hash ? `#${hash}` : ""}`;
}

function pageHref(page) {
  return page.outRel;
}

function collectToc(html) {
  return [...html.matchAll(/<h([23]) id="([^"]+)">([\s\S]*?)<\/h\1>/g)].map(
    (match) => ({
      level: Number(match[1]),
      id: match[2],
      title: match[3].replace(/<[^>]+>/g, ""),
    }),
  );
}

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { frontmatter: {}, body: raw };
  const frontmatter = {};
  for (const line of match[1].split("\n")) {
    const item = line.match(/^([\w-]+):\s*(.*)$/);
    if (!item) continue;
    frontmatter[item[1]] = item[2].replace(/^['"]|['"]$/g, "");
  }
  return { frontmatter, body: raw.slice(match[0].length) };
}

function allMarkdown(directory) {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory())
        return entry.name === "assets" ? [] : allMarkdown(full);
      return entry.name.endsWith(".md") ? [full] : [];
    })
    .sort();
}

function copyTree(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function copyFile(source, destination) {
  if (!fs.existsSync(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function copyFont(relative, name) {
  copyFile(
    path.join(root, "node_modules", relative),
    path.join(outDir, "assets", "fonts", name),
  );
}

function validateLinks() {
  const files = allFiles(outDir).filter((file) => file.endsWith(".html"));
  for (const file of files) {
    const html = fs.readFileSync(file, "utf8");
    for (const match of html.matchAll(/href="([^"]+)"/g)) {
      const href = match[1];
      if (/^(?:https?:|mailto:|#)/.test(href)) continue;
      const target = href.split("#")[0];
      if (!target) continue;
      const resolved = path.resolve(path.dirname(file), target);
      if (!fs.existsSync(resolved))
        throw new Error(
          `broken link in ${path.relative(outDir, file)}: ${href}`,
        );
    }
  }
}

function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(full) : [full];
  });
}

function llmsTxt() {
  return `# KrillSwitch\n\nEdge-native feature flags with deterministic SDK evaluation, an operator console, and an atomic audit trail.\n\nCanonical documentation:\n${ordered.map((page) => `- ${page.title}: ${origin}/${page.outRel === "index.html" ? "" : page.outRel}`).join("\n")}\n\nSource: ${repo}\n\nGuidance for agents:\n- Prefer these canonical pages over README excerpts.\n- Fetch only pages relevant to the current task.\n`;
}

function sitemap() {
  const urls = pages.map(
    (page) => `${origin}/${page.outRel === "index.html" ? "" : page.outRel}`,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url><loc>${escapeHtml(url)}</loc></url>`).join("\n")}\n</urlset>\n`;
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function titleize(value) {
  return path
    .basename(value, ".md")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}
