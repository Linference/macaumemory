import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SITE_PAGES, FAVICON_LINK, injectSiteNav, siteNavHtml } from "../src/site-nav.js";

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
const builtPages = [...read("vite.config.js").matchAll(/path\.resolve\("([\w-]+\.html)"\)/g)].map((m) => m[1]);

test("every built page uses the shared navigation, and every nav link is a built page", () => {
  assert.ok(builtPages.length >= 7);
  for (const page of builtPages) {
    const html = read(page);
    assert.match(html, /<site-(nav|dock)\b/, `${page} has no shared navigation marker`);
    const out = injectSiteNav(html);
    assert.doesNotMatch(out, /<site-(nav|dock)\b/, page);
    assert.equal(out.split("/src/site-nav.css").length - 1, 1, `${page} should link the nav stylesheet once`);
    assert.doesNotMatch(out, /<site-mark\b/, page);
    assert.deepEqual(out.match(/<link rel="icon"[^>]*>/g), [FAVICON_LINK], `${page} should use the one brand favicon`);
    assert.doesNotMatch(out, /澳門立體誌|MACAU MEMORY ATLAS/, `${page} still shows an old product name`);
  }
  for (const p of SITE_PAGES) assert.ok(builtPages.includes(p.file), `${p.file} is linked but not built`);
});

test("the archive is one click away from every page", () => {
  for (const page of builtPages) assert.match(injectSiteNav(read(page)), /href="\.\/archive\.html"/, page);
});

test("nav marks only the current page and keeps page-specific controls", () => {
  const html = injectSiteNav('<head></head><site-nav current="memory"><button id="export">匯出</button></site-nav>');
  assert.equal(html.match(/aria-current="page"/g).length, 1);
  assert.match(html, /<a href="\.\/memory\.html" aria-current="page" data-zh="共創記憶" data-hans="共创记忆" data-en="Memories" data-pt="Memórias">/);
  assert.match(html, /<details class="site-prefs">/, "language and accessibility panel");
  for (const v of ["zh-Hant", "zh-Hans", "en", "pt"]) assert.match(html, new RegExp(`name="site-lang" value="${v}"`));
  assert.equal(html.split("/src/site-prefs.js").length - 1, 1, "prefs script injected once");
  assert.match(html, /<div class="site-nav-extra"><button id="export">匯出<\/button><\/div>/);
  assert.match(injectSiteNav('<site-nav current="gaussian" overlay></site-nav>'), /site-nav--overlay/);
  assert.throws(() => siteNavHtml("typo"), /Unknown site page/);
});
