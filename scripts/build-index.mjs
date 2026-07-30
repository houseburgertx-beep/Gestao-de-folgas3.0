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
    '<meta name="app-version" content="6.1.12-firebase-github" />',
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
    () => '<script type="module" src="./src/main.js"></script>\n' + scripts,
  )
  .replace(/<base\s+target="_top"\s*\/>/, '<base target="_self" />');

if (/<\?(?:=|!=)/.test(html)) {
  throw new Error("O index gerado ainda contém marcação do Apps Script.");
}

await writeFile(path.join(projectDir, "index.html"), html, "utf8");
console.log("index.html montado com a interface original.");
