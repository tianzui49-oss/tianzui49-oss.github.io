'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'ui-parity.js'), 'utf8');
const main = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].at(-1)[1];
const base = Date.parse('2026-11-13T01:30:00Z');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function harness(script = ui) {
  const dom = new JSDOM(html.replace(/<script[\s\S]*?<\/script>/gi, ''), {
    url: 'https://test.invalid/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  Object.assign(w, { indexedDB: new IDBFactory(), IDBKeyRange, __now: base });
  w.eval(`const NativeDate=Date;Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};`);
  w.setInterval = () => 0;
  w.clearInterval = () => {};
  const rows = () => ['bid', 'ask'].flatMap(side => [1,2,3,4,5].map(level => ({
    side, level, price: side === 'bid' ? 10 - (level-1)/100 : 10 + level/100,
    volume: 10000
  })));
  const payload = (kind, ticks = []) => ({
    source: 'THSDK', code: '600000', fetched_at: new w.Date().toISOString(),
    bounds: { mode: 'available-day', day: '2026-11-13' },
    rows: kind === 'depth' ? rows() : ticks
  });
  w.fetch = async url => ({ ok: true, json: async () => payload(String(url).includes('/api/depth') ? 'depth' : 'ticks') });
  w.eval(main + '\nwindow.__activeTest={state,bookRecorder};marketPhase=()=>({open:true,label:"交易时段",day:"2026-11-13"});');
  w.eval(script);
  await wait(15);
  w.document.getElementById('result').hidden = false;
  return { dom, w, payload, async capture(kind, time, ticks = []) {
    w.__now = base + time;
    w.__activeTest.bookRecorder.capture(kind, payload(kind, ticks));
    await wait(40);
  }};
}

function activeRows(w) {
  return ['#bookSideBid [data-field="activeBuy"]', '#bookSideAsk [data-field="activeSell"]']
    .map(selector => w.document.querySelector(selector));
}

// Content-derived URL must change when the presentation script changes.
test('presentation URL identifies its exact content and cannot reuse the old cached address', () => {
  const version = crypto.createHash('sha256').update(ui).digest('hex').slice(0, 16);
  assert.ok(html.includes(`./ui-parity.js?v=${version}`), 'script URL must contain its current content hash');
  assert.ok(!html.includes('ui-parity.js?v=20261026-structure5'), 'must not reuse the pre-active-statistics address');
});

test('cached pre-active presentation reproduces missing visible rows', async () => {
  const cached = execFileSync('git', ['show', '44d6d44:ui-parity.js'], { cwd: root, encoding: 'utf8' });
  const { w, dom } = await harness(cached);
  try {
    assert.deepEqual(activeRows(w), [null, null]);
  } finally { dom.window.close(); }
});

test('current presentation displays both independent rows immediately below common volume', async () => {
  const { w, dom } = await harness();
  try {
    const [buy, sell] = activeRows(w);
    assert.ok(buy && sell);
    assert.equal(buy.querySelector('dt').textContent, '主动买入（手）');
    assert.equal(sell.querySelector('dt').textContent, '主动卖出（手）');
    for (const row of [buy, sell]) {
      assert.equal(row.previousElementSibling.dataset.field, 'volume');
      assert.equal(row.closest('[hidden]'), null, 'visible row must not be in the hidden source bridge');
      assert.equal(row.querySelector('dd').textContent, '—', 'no observation is not a fabricated zero');
    }
    assert.ok(w.document.getElementById('bookThreeCSV'), 'original export control retained');
    assert.ok(w.document.getElementById('thsdkTicks'), 'original tick detail panel retained');
  } finally { dom.window.close(); }
});

test('actual calculator and recorder refresh visible active totals without double-counting', async () => {
  const { w, dom, capture } = await harness();
  try {
    const api = w.__activeTest;
    api.state.code = '600000'; api.state.chartDate = '2026-11-13';
    await api.bookRecorder.begin('600000');
    await wait(60);
    await capture('depth', 1000);
    const ticks = [
      { time: (base+1200)/1000, price: 10.01, volume: 300 },
      { time: (base+1300)/1000, price: 10, volume: 200 }
    ];
    await capture('ticks', 1500, ticks);
    const values = () => activeRows(w).map(row => row.querySelector('dd').textContent);
    assert.deepEqual(values(), ['3', '2']);
    assert.equal(w.document.querySelector('#bookSideBid [data-field="volume"] dd').textContent, '5');
    assert.equal(w.document.querySelector('#bookSideAsk [data-field="volume"] dd').textContent, '5');
    await capture('ticks', 2000, ticks);
    assert.deepEqual(values(), ['3', '2'], 'repeated response must not count again');
    api.bookRecorder.viewAt('2026-11-13 09:30:01');
    await wait(20);
    assert.deepEqual(values(), ['0', '0'], 'confirmed empty history cannot display later received trades');
    api.bookRecorder.viewAt(null);
    await wait(20);
    assert.deepEqual(values(), ['3', '2'], 'returning to latest restores observed totals');
  } finally { dom.window.close(); }
});

test('周六建立新会话后查看周五：累计统计与四图读取同一历史缓存，采集会话不回退', async () => {
  const { w, dom, capture, payload } = await harness();
  try {
    const api = w.__activeTest;
    api.state.code = '600000'; api.state.chartDate = '2026-11-13';
    await api.bookRecorder.begin('600000'); await wait(60);
    w.__now = base + 1000;
    const book = payload('depth');
    book.rows.find(r => r.side === 'bid' && r.level === 1).volume = 12000;
    book.rows.find(r => r.side === 'ask' && r.level === 1).volume = 9000;
    api.bookRecorder.capture('depth', book); await wait(40);
    await capture('ticks', 1500, [
      { time: (base + 1200) / 1000, price: 10.01, volume: 300 },
      { time: (base + 1300) / 1000, price: 10, volume: 200 }
    ]);
    w.__now = base + 86400000;
    api.state.chartDate = '2026-11-14';
    await api.bookRecorder.begin('600000', new w.Date().toISOString(), true); await wait(60);
    api.state.chartDate = '2026-11-13';
    api.bookRecorder.viewAt('2026-11-13 15:00:00'); await wait(30);
    assert.deepEqual(activeRows(w).map(row => row.querySelector('dd').textContent), ['3', '2']);
    assert.equal(w.document.querySelector('#bookSideBid [data-field="volume"] dd').textContent, '5');
    assert.equal(w.document.querySelector('#bookSideBid [data-field="added"] dd').textContent, '22');
    assert.equal(w.document.querySelector('#bookSideAsk [data-field="cancelled"] dd').textContent, '7');
    assert.equal(w.__bookWaveData.day, '2026-11-13');
    assert.equal(w.__bookWaveData.windows.reduce((sum, x) => sum + x.volume, 0), 500);
    assert.equal(w.__bookWaveData.windows.reduce((sum, x) => sum + x.bidAdded, 0), 2200);
    assert.equal(w.__bookWaveData.windows.reduce((sum, x) => sum + x.askCancelled, 0), 700);
    assert.ok(Number(w.document.getElementById('bookWavePanel').dataset.points) > 0);
    assert.ok(w.document.getElementById('bookFlowAt').textContent.includes('2026/11/13'));
    const request = w.indexedDB.open('thsdk-orderbook-recorder-v1', 1);
    const db = await new Promise((ok, no) => { request.onsuccess = () => ok(request.result); request.onerror = () => no(request.error); });
    const read = db.transaction('latest').objectStore('latest').get('stats-session:600000');
    const saved = await new Promise((ok, no) => { read.onsuccess = () => ok(read.result); read.onerror = () => no(read.error); });
    assert.equal(saved.session.day, '2026-11-14', 'read-only history cannot replace the current recording session');
    db.close();
    api.state.chartDate = '2026-11-12'; api.bookRecorder.viewAt('2026-11-12 15:00:00'); await wait(25);
    assert.deepEqual(activeRows(w).map(row => row.querySelector('dd').textContent), ['—', '—']);
    assert.equal(w.__bookWaveData.windows.length, 0, 'another date cannot borrow Friday records');
    api.state.chartDate = '2026-11-13'; api.bookRecorder.viewAt('2026-11-13 09:30:01'); await wait(25);
    assert.deepEqual(activeRows(w).map(row => row.querySelector('dd').textContent), ['0', '0'], 'historical selection still cannot use later received trades');
  } finally { dom.window.close(); }
});
