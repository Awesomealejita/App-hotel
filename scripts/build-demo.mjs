// Genera demo/hotel-mockup.html: la app completa con datos de ejemplo en un único HTML
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

execSync("npx vite build --mode demo", { stdio: "inherit" });
const dir = "dist-demo/assets";
const files = fs.readdirSync(dir);
const css = files.filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
const js = files.filter((f) => f.endsWith(".js")).map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
const safeJs = js.replace(/<\/script/gi, "<\\/script");

const html = `<title>Hotel PMS Mockup</title>
<meta name="theme-color" content="#0f766e">
<style>${css}</style>
<div id="root"></div>
<script type="module">${safeJs}</script>
`;
fs.mkdirSync("demo", { recursive: true });
fs.writeFileSync("demo/hotel-mockup.html", html);
console.log(`demo/hotel-mockup.html (${(html.length / 1024).toFixed(0)} kB)`);
