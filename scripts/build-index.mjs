import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

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

let html = template
  .replace(
    /<meta\s+name="app-version"\s+content="[\s\S]*?"\s*\/>/,
    '<meta name="app-version" content="6.2.7-firebase-github" />',
  )
  .replace(
    /<title>[\s\S]*?<\/title>/,
    "<title>Gestão de Folgas</title>",
  )
  // Use callbacks so JavaScript replacement tokens such as "$$" are copied
  // verbatim instead of being collapsed to a single "$".
  .replace("<?!= include_('Styles'); ?>", () => styles)
  .replace("<?!= include_('Dialogs'); ?>", () => dialogs)
  .replace(
    "<?!= include_('Scripts'); ?>",
    () =>
      `<script>
  window.__GESTAO_API_STATUS__ = "loading";
  window.__GESTAO_API_READY__ = new Promise(function (resolve, reject) {
    window.__resolveGestaoApiReady__ = resolve;
    window.__rejectGestaoApiReady__ = reject;
  });
  window.addEventListener("error", function (event) {
    if (event.target && event.target.tagName === "SCRIPT" && event.target.type === "module") {
      window.__GESTAO_API_STATUS__ = "failed";
      window.__rejectGestaoApiReady__(new Error("Falha ao carregar o portal."));
    }
  }, true);
</script>
<script type="module" src="./src/main.js?v=6.2.7"></script>
` + scripts,
  )
  .replace(/<base\s+target="_top"\s*\/>/, '<base target="_self" />');

if (/<\?(?:=|!=)/.test(html)) {
  throw new Error("O index gerado ainda contém marcação do Apps Script.");
}

await writeFile(path.join(projectDir, "index.html"), html, "utf8");
console.log("index.html montado com a interface original.");
