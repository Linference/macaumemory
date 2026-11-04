import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = f => JSON.parse(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'));
const { dossiers } = read('public/data/building-dossiers.json');
const attractions = new Map(read('public/data/attractions.json').attractions.map(a => [a.id, a]));

test('every dossier claim cites an official source that the dossier lists', () => {
  assert.ok(dossiers.length >= 10);
  for (const d of dossiers) {
    for (const [key, s] of Object.entries(d.sources)) assert.match(s.url, /^https?:\/\/(www\.wh\.mo|www\.culturalheritage\.mo|whc\.unesco\.org|www\.gov\.mo|www\.macaotourism\.gov\.mo|oralhistory\.mo)\//, `${d.id}.${key}`);
    for (const c of [d.style, ...d.timeline, ...d.whyStyle, ...d.features, ...d.names, ...(d.oral ?? [])]) {
      assert.ok(c.text && c.sources.length, `${d.id}: claim without source`);
      for (const k of c.sources) assert.ok(d.sources[k], `${d.id}: unknown source ${k}`);
      assert.ok(['source', 'inference'].includes(c.kind));
    }
  }
});

test('site descriptions no longer repeat the errors the official sources contradict', () => {
  const text = id => attractions.get(id).brief + attractions.get(id).detail;
  assert.match(text('cathedral'), /兩旁各有一座鐘樓/, 'the cathedral has two bell towers');
  assert.doesNotMatch(text('cathedral'), /正立面設有一座鐘樓/);
  assert.doesNotMatch(text('guia-fortress'), /高 15 米|1626/, 'lighthouse is 18.3 m; chapel c.1622');
  assert.doesNotMatch(text('st-lawrence'), /新古典/, "St Lawrence is classical with baroque features");
  assert.doesNotMatch(text('st-anthony'), /最古老的一座|主教座堂並稱/, 'the three ancient churches are St Anthony, St Lawrence, St Lazarus');
  assert.doesNotMatch(text('st-dominic'), /立面呈巴洛克/, "St Dominic's facade is classical; the altar is baroque");
  assert.doesNotMatch(text('na-tcha-temple'), /只有一進/, 'two sections without a courtyard');
  assert.doesNotMatch(text('fisherman-wharf'), /11 萬平方米/, 'MGTO: over 133,000 m2');
  assert.doesNotMatch(text('moorish-barracks'), /由意大利建築師設計/, 'designer is disputed between sources');
  for (const d of dossiers) if (attractions.has(d.id)) assert.equal(attractions.get(d.id).dossier, d.id);
  for (const d of dossiers) for (const cf of d.conflicts ?? []) for (const v of cf.values) assert.ok(d.sources[v.source], `${d.id} conflict source`);
});

test('verified cold facts keep their original sources and never include dropped claims', () => {
  const { items } = read('public/data/cold-facts.json');
  assert.ok(items.length >= 50);
  for (const c of items) {
    assert.ok(c.text && ['verified', 'partly'].includes(c.status), c.id);
    assert.ok(c.sources.length && c.sources.every(s => /^https?:\/\//.test(s.url)), c.id);
    if (c.placeId) assert.ok(attractions.has(c.placeId), `${c.id} -> ${c.placeId}`);
  }
  assert.ok(!items.some(c => c.n === 42), 'the unverifiable bronze-bell story is excluded');
  assert.doesNotMatch(items.find(c => c.n === 41).text, /15\s*米/, 'lighthouse height corrected to the official 18.3 m');
});
