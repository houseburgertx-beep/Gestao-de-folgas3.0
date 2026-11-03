import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { transformWithEsbuild } from "vite";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const legacyDir = path.join(projectDir, "src", "legacy");

const readLegacy = (name) =>
  readFile(path.join(legacyDir, name), "utf8");

const [template, styles, dialogs, scripts] = await Promise.all([
  readLegacy("Index.html"),
  readLegacy("Styles.html"),
  readLegacy("Dialogs.html"),
  readLegacy("Scripts.html"),
]);

const [redesign, cozinhaflow, documentsCss, copilotCss] = await Promise.all([
  readFile(path.join(projectDir, "src", "redesign.css"), "utf8"),
  readFile(path.join(projectDir, "src", "cozinhaflow.css"), "utf8"),
  readFile(path.join(projectDir, "src", "documents.css"), "utf8"),
  readFile(path.join(projectDir, "src", "copilot.css"), "utf8"),
]);

// Keep the classic script scope (inline handlers depend on its globals), but
// cache it separately so navigation no longer downloads/reparses a huge HTML.
const generatedDir = path.join(projectDir, "public", "generated");
await mkdir(generatedDir, { recursive: true });
const legacySource = scripts.replace(/^\s*<script>\s*/, "").replace(/\s*<\/script>\s*$/, "");
const { code: legacyClient } = await transformWithEsbuild(legacySource, "legacy-client.js", {
  target: "es2020", minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
});
const css = styles.replace(/^\s*<style>\s*/, "").replace(/\s*<\/style>\s*$/, "") +
  `\n${redesign}\n${cozinhaflow}\n${documentsCss}\n${copilotCss}`;
const assetName = (name, content, ext) => `${name}-${createHash("sha256").update(content).digest("hex").slice(0, 12)}.${ext}`;
const clientName = assetName("legacy-client", legacyClient, "js");
const styleName = assetName("legacy-styles", css, "css");
for (const entry of await readdir(generatedDir)) {
  if (/^legacy-(client|styles)-[a-f0-9]+\.(js|css)$/.test(entry) && ![clientName, styleName].includes(entry)) {
    await unlink(path.join(generatedDir, entry));
  }
}
await Promise.all([
  writeFile(path.join(generatedDir, clientName), legacyClient),
  writeFile(path.join(generatedDir, styleName), css),
]);

let html = template
  .replace(
    /<meta\s+name="app-version"\s+content="[\s\S]*?"\s*\/>/,
    '<meta name="app-version" content="6.17.6-firebase-github" />',
  )
  .replace(
    /<title>[\s\S]*?<\/title>/,
    "<title>Gestão de Folgas</title>",
  )
  // Use callbacks so JavaScript replacement tokens such as "$$" are copied
  // verbatim instead of being collapsed to a single "$".
  .replace("<?!= include_('Styles'); ?>", () => `<link rel="stylesheet" href="./generated/${styleName}">`)
  .replace("<?!= include_('Dialogs'); ?>", () => dialogs)
  .replace(
    "<?!= include_('Scripts'); ?>",
    () =>
      `<script>
  if (window.__GESTAO_API_STATUS__ === "ready") {
    window.__GESTAO_API_READY__ = Promise.resolve();
  } else if (!window.__GESTAO_API_READY__) {
    window.__GESTAO_API_STATUS__ = "loading";
    window.__GESTAO_API_READY__ = new Promise(function (resolve, reject) {
      window.__resolveGestaoApiReady__ = resolve;
      window.__rejectGestaoApiReady__ = reject;
    });
  }
  window.addEventListener("error", function (event) {
    if (event.target && event.target.tagName === "SCRIPT" && event.target.type === "module") {
      window.__GESTAO_API_STATUS__ = "failed";
      window.__rejectGestaoApiReady__?.(new Error("Falha ao carregar o portal."));
    }
  }, true);
</script>
<!-- PDF.js (./vendor/pdfjs/pdf.min.js) is loaded on demand by documents.js. -->
<script type="module" src="./src/main.js?v=6.17.6"></script>
<script defer src="./generated/${clientName}"></script>`,
  )
  .replace(/<base\s+target="_top"\s*\/>/, '<base target="_self" />');

if (/<\?(?:=|!=)/.test(html)) {
  throw new Error("O index gerado ainda contém marcação do Apps Script.");
}

await writeFile(path.join(projectDir, "index.html"), html.replace(/[ \t]+$/gm, ""), "utf8");
console.log("index.html montado com a interface original.");
