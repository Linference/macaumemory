import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PERSONAS, personaPrompt, personaOf } from '../src/personas.js';
import { injectSiteNav } from '../src/site-nav.js';

test('every identity has a teaching rationale, a style and a length budget', () => {
  assert.ok(Object.keys(PERSONAS).length >= 7);
  for (const [id, p] of Object.entries(PERSONAS)) {
    assert.ok(p.label && p.hint && p.theory && p.style, id);
    assert.ok(p.maxChars >= 100 && p.maxChars <= 400, id);
    assert.match(personaPrompt(id), new RegExp(p.label));
    assert.match(personaPrompt(id), /不得因此增加資料以外的事實/, 'identity changes the telling, never the facts');
  }
});

test('unknown identities fall back to tourist; generic is only for the comparison baseline', () => {
  assert.equal(personaOf('hacker'), 'tourist');
  assert.equal(personaOf(undefined), 'tourist');
  assert.doesNotMatch(personaPrompt('generic'), /對象是/);
});

test('the settings panel lets visitors change identity later', () => {
  const html = injectSiteNav('<head></head><site-nav current="memory"></site-nav>');
  for (const id of Object.keys(PERSONAS)) assert.match(html, new RegExp(`name="site-persona" value="${id}"`));
});
