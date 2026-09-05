// Copies third-party browser bundles from node_modules into site/vendor so the
// published site has no runtime dependency on a CDN.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorDir = join(root, "site", "vendor");
mkdirSync(vendorDir, { recursive: true });

const d3Pkg = JSON.parse(readFileSync(join(root, "node_modules/d3/package.json"), "utf8"));
copyFileSync(join(root, "node_modules/d3/dist/d3.min.js"), join(vendorDir, "d3.min.js"));
copyFileSync(join(root, "node_modules/d3/LICENSE"), join(vendorDir, "d3.LICENSE"));
writeFileSync(
  join(vendorDir, "VERSIONS.json"),
  JSON.stringify({ d3: d3Pkg.version }, null, 2) + "\n",
);
console.log(`vendored d3@${d3Pkg.version} -> site/vendor/d3.min.js`);
