import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const distDir = path.join(projectDir, "dist");
const assetsDir = path.join(distDir, "assets");
const swPath = path.join(distDir, "sw.js");

try {
  const assetFiles = await readdir(assetsDir);
  const relevantAssets = assetFiles
    .filter(
      (file) =>
        !file.endsWith(".map") &&
        (file.startsWith("index-") || file.endsWith(".js") || file.endsWith(".css")),
    )
    .map((file) => `  "./assets/${file}",`);

  if (!relevantAssets.length) {
    console.log("[postbuild-sw] Nenhum ativo encontrado em dist/assets.");
    process.exit(0);
  }

  let swContent = await readFile(swPath, "utf8");
  const target = 'const APP_SHELL = [\n';
  if (swContent.includes(target)) {
    const replacement = target + relevantAssets.join("\n") + "\n";
    swContent = swContent.replace(target, replacement);
    await writeFile(swPath, swContent, "utf8");
    console.log(
      `[postbuild-sw] ${relevantAssets.length} ativo(s) do bundle Vite injetados no APP_SHELL do Service Worker.`,
    );
  } else {
    console.warn("[postbuild-sw] Marcador APP_SHELL não encontrado em dist/sw.js.");
  }
} catch (error) {
  console.warn("[postbuild-sw] Aviso ao atualizar sw.js:", error.message);
}
