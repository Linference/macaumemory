import { createRequire } from "node:module";
const puppeteer = createRequire(import.meta.url)("../../../../node_modules/puppeteer-core");
for (const args of [["--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-gpu", "--force_high_performance_gpu"]]) {
  const b = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args });
  const p = await b.newPage();
  const r = await p.evaluate(() => { const gl = document.createElement("canvas").getContext("webgl2"); const e = gl?.getExtension("WEBGL_debug_renderer_info"); return gl ? gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : "no webgl2"; });
  console.log(args.join(" "), "=>", r);
  await b.close();
}
