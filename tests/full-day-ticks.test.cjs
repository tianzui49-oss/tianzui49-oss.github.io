'use strict';
// Run after installing tests/package-lock.json: cd tests && node --test full-day-ticks.test.cjs
// Contract tests only: load the inline production script exactly as the recovery harness does.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const { IDBFactory, IDBKeyRange } = require('fake-indexeddb');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].pop()[1];
const TODAY = '2026-11-14'; // Saturday in Beijing; do not pretend the market is open.
const FRIDAY = '2026-11-13';
const THURSDAY = '2026-11-12';
const CODE = '600000';
const NOW = Date.parse(`${TODAY}T10:00:00+08:00`);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function rowsFor(day) {
  return ['09:30:00', '10:05:00', '11:30:00', '13:00:00', '14:59:59', '15:00:00', '15:10:00']
    .map((clock, index) => ({
      time: Date.parse(`${day}T${clock}+08:00`) / 1000,
      price: 10 + index / 100,
      volume: 100 + index * 100,
      transaction_count: 1000 + index,
      deal_type: clock === '15:10:00' ? 17 : 1,
      ask_order_id: clock === '15:10:00' ? 12345 : 4294967295
    }));
}

function fullDay(day, rows = rowsFor(day), code = CODE) {
  return {
    source: 'THSDK', code,
    columns: ['time', 'price', 'volume', 'transaction_count', 'deal_type', 'ask_order_id'],
    rows,
    bounds: { mode: 'available-day', day, start: `${day} 00:00:00`, end: `${day} 23:59:59` },
    history: { day },
    fetched_at: new Date(NOW).toISOString()
  };
}

function minute(day) {
  return {
    ...fullDay(day, [rowsFor(day)[4]]),
    bounds: { mode: 'minute', day, start: `${day} 14:59:00`, end: `${day} 15:00:00` },
    query: { code: CODE, date: day, time: '15:00:00' }
  };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function until(predicate, message) {
  const deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() >= deadline) assert.fail(message);
    await wait(5);
  }
}

async function setup(sequence = []) {
  const dom = new JSDOM(body, {
    url: 'https://test.invalid/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  let now = NOW;
  w.Date = class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  Object.assign(w, { indexedDB: new IDBFactory(), IDBKeyRange });
  const calls = [];
  // No browser/resources/real fetch: every request is handled here, even if the URL is wrong.
  w.fetch = async (url, options = {}) => {
    const parsed = new URL(String(url), w.location.href);
    const call = { url: parsed, signal: options.signal };
    calls.push(call);
    let data;
    if (parsed.pathname === '/api/depth') {
      data = { source: 'THSDK', code: parsed.searchParams.get('code'), columns: [], rows: [] };
    } else {
      assert.equal(parsed.pathname, '/api/ticks', 'unexpected request; network is never used');
      assert.ok(sequence.length, 'mock /api/ticks response sequence exhausted');
      // Intentionally ignore aborts: a server can still deliver an obsolete response.
      const item = sequence.shift();
      data = await (typeof item === 'function' ? item(call) : item);
    }
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => data };
  };
  w.setInterval = (fn, ms) => ({ fn, ms });
  w.clearInterval = () => {};
  w.console.warn = () => {}; // Expected unavailable-date errors are asserted in the UI below.
  w.eval(script + '\nwindow.__test={state,tickState,tickQuery,tickFetch,tickSync,tickStart,tickStop,tickDateBegin,tickDateEnd,tickRowBeijingDay,dayShanghai,marketPhase,drawChart,clearChartSelection,setPoint(time,pinned=false){hoveredPointTime=time;pinnedPointTime=pinned?time:null;},point(){return {hoveredPointTime,pinnedPointTime};}};');
  const api = w.__test;
  api.state.code = CODE;
  api.state.name = '测试证券';
  api.state.chartDate = TODAY;
  api.state.chart = [];
  api.tickState.enabled = true;
  w.document.getElementById('chartDate').value = TODAY;
  await wait(10); // Allow local IndexedDB/watchlist initialization to settle.
  return {
    dom, w, api, calls,
    tickCalls: () => calls.filter(call => call.url.pathname === '/api/ticks'),
    advance(ms) { now += ms; },
    close() { api.tickStop(); dom.window.close(); }
  };
}

function assertRequest(call, code = CODE) {
  assert.equal(call.url.pathname, '/api/ticks');
  assert.equal(call.url.searchParams.get('code'), code);
  assert.deepEqual([...call.url.searchParams.keys()], ['code'], 'only /api/ticks?code=... is permitted');
  assert.equal(call.url.searchParams.has('date'), false, 'selected day is local validation, not an API date');
  assert.equal(call.url.searchParams.has('time'), false, 'never request a one-minute window');
}

function assertQuery(q, day, code = CODE) {
  assert.ok(q, 'tickQuery must return a query');
  assert.equal(q.day, day, 'empty day means latest; a past selection must keep its exact date');
  assert.equal(q.params.get('code'), code);
  assert.deepEqual([...q.params.keys()], ['code']);
  assert.equal(typeof q.key, 'string');
  assert.ok(q.key.length, 'cache key must be nonempty; its serialization format is not prescribed');
  assert.equal(typeof q.label, 'string');
  assert.ok(q.label.length);
  assert.doesNotMatch(q.label, /一分钟|1\s*分钟/, 'label must not advertise a minute slice');
}

function assertDisplayed(h, expectedRows) {
  const wrap = h.w.document.getElementById('thsdkTableWrap');
  assert.equal(wrap.hidden, false, 'full-day data should be visible');
  assert.equal(h.w.document.querySelectorAll('#thsdkTickBody tr').length, expectedRows.length);
  assert.deepEqual(
    Array.from(h.api.tickState.viewRows, row => JSON.stringify(row)).sort(),
    expectedRows.map(row => JSON.stringify(row)).sort(),
    'display every original full-day row, with no minute trimming or extra rows'
  );
}

function assertUnavailable(h, day) {
  const status = h.w.document.getElementById('thsdkStatus');
  assert.ok(status.classList.contains('thsdk-error'), 'wrong-date response must be an explicit error');
  assert.ok(status.textContent.includes(day), 'error must name the selected date');
  assert.match(status.textContent, /全天/, 'error must identify unavailable full-day detail');
  assert.match(status.textContent, /不可用|无法|不支持/);
  assert.equal(h.w.document.querySelectorAll('#thsdkTickBody tr').length, 0, 'no other-day or minute rows may be shown');
}

async function fetchNow(h) {
  const q = h.api.tickQuery();
  h.api.tickState.key = q.key;
  await h.api.tickFetch(q, h.api.tickState.generation, true);
  return q;
}

async function syncAndSettle(h, force = false, explicit = true) {
  h.api.tickSync(force, explicit);
  await wait(180); // Existing tickSync debounces changed selections for 120 ms.
  await until(() => !h.api.tickState.controller, 'tickSync did not finish its mock request');
}

function selectDay(h, day) {
  h.api.setPoint(null);
  h.api.state.chartDate = day;
  h.w.document.getElementById('chartDate').value = day;
}

function seedCache(h, data) {
  const q = h.api.tickQuery(); // Do not lock the code/day cache-key format.
  h.api.tickState.cache.set(q.key, { at: NOW, successAt: NOW, data });
  return q;
}

function prepareChart(h, day) {
  h.api.state.chart = ['09:30:00', '10:05:00', '14:00:00'].map((clock, index) => ({
    time: `${day} ${clock}`, price: 10 + index / 100, volume_hand: 1, amount: 1000
  }));
  h.api.drawChart();
  const chart = h.w.document.getElementById('chart');
  chart.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 420 });
  const captured = new Set();
  chart.setPointerCapture = id => captured.add(id);
  chart.hasPointerCapture = id => captured.has(id);
  chart.releasePointerCapture = id => captured.delete(id);
  return (type, index, pointerId = 1) => {
    const event = new h.w.MouseEvent(type, {
      bubbles: true, button: 0, clientX: h.api.state.chartGeometry.x(index), clientY: 100
    });
    Object.defineProperties(event, {
      pointerId: { value: pointerId }, pointerType: { value: 'touch' }, isPrimary: { value: true }
    });
    chart.dispatchEvent(event);
  };
}

test('tickQuery separates code/day keys while latest and chart-selected points remain full-day queries', async () => {
  const h = await setup();
  try {
    assert.equal(h.api.dayShanghai(), TODAY);
    assert.equal(h.api.marketPhase().open, false, 'the fixed Beijing date really is a closed Saturday');
    const latest = h.api.tickQuery();
    assertQuery(latest, '');
    h.api.setPoint(`${FRIDAY} 10:05:00`, true);
    assertQuery(h.api.tickQuery(), '');
    assert.equal(h.api.tickQuery().key, latest.key, 'a point cannot change latest full-day identity');
    h.api.state.chartDate = '';
    assertQuery(h.api.tickQuery(), '');
    selectDay(h, FRIDAY);
    const friday = h.api.tickQuery();
    assertQuery(friday, FRIDAY);
    assert.notEqual(friday.key, latest.key);
    h.api.setPoint(`${FRIDAY} 09:30:00`);
    assert.equal(h.api.tickQuery().key, friday.key);
    assertQuery(h.api.tickQuery(), FRIDAY);
    h.api.setPoint(`${FRIDAY} 14:59:59`, true);
    assert.equal(h.api.tickQuery().key, friday.key, 'sliding or pinning cannot create a minute key');
    selectDay(h, THURSDAY);
    const thursday = h.api.tickQuery();
    assertQuery(thursday, THURSDAY);
    assert.notEqual(thursday.key, friday.key, 'different selected days cannot share a cache identity');
    h.api.state.code = '000001';
    assertQuery(h.api.tickQuery(), THURSDAY, '000001');
    assert.notEqual(h.api.tickQuery().key, thursday.key, 'different securities cannot share a cache identity');
  } finally { h.close(); }
});

test('Saturday latest displays the backend available Friday in full, including 15:00 and positive post-market trades', async () => {
  const data = fullDay(FRIDAY);
  const h = await setup([data]);
  try {
    await syncAndSettle(h, true, true);
    assert.equal(h.tickCalls().length, 1);
    assertRequest(h.tickCalls()[0]);
    assertDisplayed(h, data.rows);
    const text = h.w.document.getElementById('thsdkTickBody').textContent;
    assert.match(text, /15:00:00/);
    assert.match(text, /15:10:00/);
    assert.ok(h.api.tickState.viewRows.every(row => h.api.tickRowBeijingDay(row) === FRIDAY));
    assert.equal(h.w.document.getElementById('thsdkStatus').classList.contains('thsdk-error'), false);
  } finally { h.close(); }
});

test('selecting Friday on Saturday fetches available Friday full-day detail without needing a preexisting cache', async () => {
  const data = fullDay(FRIDAY);
  const h = await setup([data]);
  try {
    selectDay(h, FRIDAY);
    await syncAndSettle(h, true, true);
    assert.equal(h.tickCalls().length, 1);
    assertRequest(h.tickCalls()[0]);
    assertDisplayed(h, data.rows);
    assertQuery(h.api.tickQuery(), FRIDAY);
    assert.doesNotMatch(h.w.document.getElementById('thsdkMode').textContent, /一分钟|1\s*分钟/);
  } finally { h.close(); }
});

test('chart taps, dragging, and release keep full-day rows unchanged for latest and selected Friday', async () => {
  for (const selectedDay of [TODAY, FRIDAY]) {
    const data = fullDay(FRIDAY);
    const h = await setup([data, data, data, data]);
    try {
      selectDay(h, selectedDay);
      await fetchNow(h);
      assertDisplayed(h, data.rows);
      const key = h.api.tickQuery().key;
      const pointer = prepareChart(h, selectedDay);
      pointer('pointerdown', 0);
      pointer('pointerup', 0);
      assert.ok(h.api.point().pinnedPointTime, 'exercise a real tap/pin handler');
      assert.equal(h.api.tickQuery().key, key);
      assertDisplayed(h, data.rows);
      await wait(180);
      assertDisplayed(h, data.rows);
      pointer('pointerdown', 1, 2);
      pointer('pointermove', 2, 2);
      assert.equal(h.api.point().hoveredPointTime, `${selectedDay} 14:00:00`, 'exercise a real sliding handler');
      assert.equal(h.api.tickQuery().key, key);
      assertDisplayed(h, data.rows);
      await wait(180);
      assertDisplayed(h, data.rows);
      pointer('pointerup', 2, 2);
      assert.equal(h.api.point().hoveredPointTime, null, 'swipe release returns from the selected point');
      await wait(180);
      assertDisplayed(h, data.rows);
      assert.equal(h.api.tickQuery().key, key);
      h.tickCalls().forEach(call => assertRequest(call));
    } finally { h.close(); }
  }
});

test('an older selected date may display a same-day cached available-day response', async () => {
  const cached = fullDay(THURSDAY);
  const h = await setup([fullDay(FRIDAY)]);
  try {
    selectDay(h, THURSDAY);
    seedCache(h, cached);
    await syncAndSettle(h);
    assertDisplayed(h, cached.rows);
    assertQuery(h.api.tickQuery(), THURSDAY);
    h.tickCalls().forEach(call => assertRequest(call));
    assert.equal(h.w.document.getElementById('thsdkStatus').classList.contains('thsdk-error'), false);
  } finally { h.close(); }
});

test('a same-day minute cache is not full-day availability; mismatched latest must report the selected day unavailable', async () => {
  const h = await setup([fullDay(FRIDAY)]);
  try {
    selectDay(h, THURSDAY);
    seedCache(h, minute(THURSDAY));
    await syncAndSettle(h);
    assert.equal(h.tickCalls().length, 1, 'a fresh minute cache must not suppress the full-day lookup');
    assertRequest(h.tickCalls()[0]);
    assertUnavailable(h, THURSDAY);
  } finally { h.close(); }
});

test('an older date with only another-day cache never displays latest Friday while waiting or after its wrong-date response', async () => {
  const pending = deferred();
  const h = await setup([fullDay(FRIDAY), pending.promise]);
  try {
    await fetchNow(h); // Create real Friday latest/cache entries, not an invented key format.
    assertDisplayed(h, rowsFor(FRIDAY));
    selectDay(h, THURSDAY);
    h.api.tickSync(true, true);
    assert.equal(h.w.document.querySelectorAll('#thsdkTickBody tr').length, 0, 'clear Friday immediately when selecting unavailable Thursday');
    await until(() => h.tickCalls().length === 2, 'historical full-day lookup was not made');
    assertRequest(h.tickCalls()[1]);
    pending.resolve(fullDay(FRIDAY));
    await until(() => !h.api.tickState.controller, 'wrong-date lookup did not settle');
    assertUnavailable(h, THURSDAY);
    assert.equal(h.api.tickQuery().day, THURSDAY, 'a latest response cannot silently change the selected day');
  } finally { pending.resolve(fullDay(FRIDAY)); h.close(); }
});

test('repeated identical full-day responses do not append rows or discard closing/post-market detail', async () => {
  const data = fullDay(FRIDAY);
  const h = await setup([data, JSON.parse(JSON.stringify(data))]);
  try {
    await fetchNow(h);
    assertDisplayed(h, data.rows);
    const before = h.w.document.getElementById('thsdkTickBody').textContent;
    h.advance(1000);
    await fetchNow(h);
    assert.equal(h.tickCalls().length, 2);
    h.tickCalls().forEach(call => assertRequest(call));
    assertDisplayed(h, data.rows);
    assert.equal(h.w.document.getElementById('thsdkTickBody').textContent, before);
  } finally { h.close(); }
});

test('out-of-order responses cannot replace a newer date or overwrite its status, even when abort is ignored', async () => {
  const old = deferred(), fresh = deferred();
  const h = await setup([old.promise, fresh.promise]);
  try {
    selectDay(h, THURSDAY);
    h.api.tickSync(true, true);
    await until(() => h.tickCalls().length === 1, 'old selected-date request was not started');
    const oldGeneration = h.api.tickState.generation;
    selectDay(h, FRIDAY);
    h.api.tickSync(true, true);
    await until(() => h.tickCalls().length === 2, 'new selected-date request was not started');
    assert.ok(h.api.tickState.generation > oldGeneration, 'date switching invalidates the earlier generation');
    h.tickCalls().forEach(call => assertRequest(call));
    fresh.resolve(fullDay(FRIDAY));
    await until(() => !h.api.tickState.controller, 'new response did not settle');
    assertDisplayed(h, rowsFor(FRIDAY));
    const key = h.api.tickState.key;
    const status = h.w.document.getElementById('thsdkStatus').textContent;
    const mode = h.w.document.getElementById('thsdkMode').textContent;
    // Deliberately returns a valid full day for the obsolete Thursday query after Friday succeeded.
    old.resolve(fullDay(THURSDAY));
    await wait(40);
    assertDisplayed(h, rowsFor(FRIDAY));
    assert.equal(h.api.tickState.key, key);
    assert.equal(h.api.tickQuery().day, FRIDAY);
    assert.equal(h.w.document.getElementById('thsdkStatus').textContent, status, 'stale success/error must not overwrite new status');
    assert.equal(h.w.document.getElementById('thsdkMode').textContent, mode);
  } finally { old.resolve(fullDay(THURSDAY)); fresh.resolve(fullDay(FRIDAY)); h.close(); }
});
