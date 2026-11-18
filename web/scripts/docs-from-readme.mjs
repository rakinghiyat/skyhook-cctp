// Turns the repository's READMEs into the pages of the documentation site.
//
// The READMEs are the source of truth, so readers on GitHub see the same text. The site renders
// them instead of keeping a second copy.
//
// Everything under content/docs is generated and gitignored, so the two can't drift apart.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(webRoot, "..");
const outDir = path.join(webRoot, "content", "docs");

/** This order is the sidebar order. */
const PAGES = [
  {
    slug: "index",
    from: "README.md",
    title: "Skyhook",
    description: "The execution layer for CCTP hooks on Stellar.",
    // The root README starts with a banner and badges for GitHub. The site has its own header.
    dropUntil: /^## What this is/m,
  },
  {
    slug: "integration",
    from: "packages/sdk/README.md",
    title: "Integration guide",
    description: "Send USDC that does something the moment it arrives.",
  },
  {
    slug: "handlers",
    from: "contracts/skyhook-core/README.md",
    title: "Writing a handler",
    description: "The registry is permissionless. Here is the interface.",
  },
  {
    slug: "relayer",
    from: "packages/relayer/README.md",
    title: "Running a relayer",
    description: "No custody, no permission needed.",
  },
];

/** Rewrites links that made sense inside the repository so they work as site routes. */
function rewriteLinks(md) {
  const map = {
    "packages/sdk/README.md": "/docs/integration",
    "contracts/skyhook-core/README.md": "/docs/handlers",
    "packages/relayer/README.md": "/docs/relayer",
    "../relayer/README.md": "/docs/relayer",
    "../../README.md": "/docs",
    "../../README.md#instruction-format": "/docs#instruction-format",
  };
  let out = md;
  for (const [from, to] of Object.entries(map)) {
    out = out.replaceAll(`](${from})`, `](${to})`);
  }
  // A bare LICENSE link has no page here; point at the file on GitHub instead.
  return out.replaceAll(
    "](LICENSE)",
    "](https://github.com/rakinghiyat/skyhook-cctp/blob/main/LICENSE)"
  );
}

/** MDX treats `{` and `<` as expressions; the READMEs mean them literally. */
function escapeForMdx(md) {
  const parts = md.split(/(```[\s\S]*?```|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // inside code, leave alone
      return part.replace(/</g, "&lt;").replace(/\{/g, "&#123;").replace(/\}/g, "&#125;");
    })
    .join("");
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const page of PAGES) {
  let md = readFileSync(path.join(repoRoot, page.from), "utf8");

  if (page.dropUntil) {
    const at = md.search(page.dropUntil);
    if (at > 0) md = md.slice(at);
  }
  // The first heading becomes the page title, so it would otherwise appear twice.
  md = md.replace(/^#\s+.*\n+/, "");
  // Same again when the section we titled the page after is the first thing in the file.
  md = md.replace(new RegExp(`^##\\s+${page.title}\\s*\n+`, "i"), "");

  const body = escapeForMdx(rewriteLinks(md));
  const frontmatter = `---\ntitle: ${page.title}\ndescription: ${page.description}\n---\n\n`;
  const note =
    `<Callout type="info">This page is generated from ` +
    `[\`${page.from}\`](https://github.com/rakinghiyat/skyhook-cctp/blob/main/${page.from}) ` +
    `in the repository, which remains the source of truth.</Callout>\n\n`;

  writeFileSync(path.join(outDir, `${page.slug}.mdx`), frontmatter + note + body);
  console.log(`  ${page.from} → content/docs/${page.slug}.mdx`);
}

writeFileSync(
  path.join(outDir, "meta.json"),
  JSON.stringify({ pages: PAGES.map((p) => p.slug) }, null, 2) + "\n"
);
console.log(`  ${PAGES.length} pages generated`);
