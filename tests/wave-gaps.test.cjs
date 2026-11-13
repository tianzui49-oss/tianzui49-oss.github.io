'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '..', 'ui-parity.js'), 'utf8');
const code = source.slice(source.indexOf('  function buildBookWaves()'), source.indexOf('  function arrange()'));
const at = (time) => Date.parse('2026-11-13T' + time + '+08:00');
function interval(start, end, net = 100) {
  return { start: at(start), end: at(end), spans: [[at(start), at(end)]], volume: 100,
    activeBuy: 60, activeSell: 40, bidAdded: net, askAdded: net, bidCancelled: 0, askCancelled: 0, bidNet: net, askNet: net };
}
function load(windows) {
  const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
  const w = dom.window, d = w.document;
  w.requestAnimationFrame = cb => { cb(); return 1; };
  w.__bookWaveData = { code: '600513', day: '2026-11-13', today: '2026-11-14', live: false,
    started_at: '2026-11-13T10:30:00+08:00', windows };
  w.eval(`const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};\n${code}\ndocument.body.append(buildBookWaves());`);
  const svgs = [...d.querySelectorAll('svg')];
  for (const svg of svgs) svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 240 });
  d.querySelector('.book-wave-grid').getBoundingClientRect = () => ({ left: 0, top: 0 });
  function slide(time) {
    const t = at(time), m = (t - at('09:30:00')) / 60000 - (t >= at('13:00:00') ? 90 : 0);
    const e = new w.Event('pointermove');
    Object.assign(e, { pointerType: 'mouse', clientX: m / 240 * 400, clientY: 10 });
    svgs[0].dispatchEvent(e);
    return { text: d.querySelector('.book-wave-tip').textContent,
      crosses: [...d.querySelectorAll('.book-wave-cross')].map(n => ({ x: +n.getAttribute('x1'), shown: n.getAttribute('display') !== 'none' })) };
  }
  function pts(kind, side) {
    const p = d.querySelector(`[data-kind="${kind}"] path[data-side="${side}"]`);
    return p.getAttribute('d').slice(1).split('L').map(x => x.split(' ').map(Number));
  }
  return { w, d, dom, slide, pts };
}
const windows = [interval('10:30:00', '10:30:03'), interval('10:30:03', '10:30:05'), interval('10:30:10', '10:30:13')];

test('10:30开始：前三图09:30到10:30保持各自区域中点，非分界线', () => {
  const h = load(windows);
  for (const kind of ['added', 'cancelled', 'net']) for (const [side, y] of [['bid',60], ['ask',180]]) {
    const p = h.pts(kind, side);
    assert.deepEqual(p[0], [0, y]);
    assert.ok(p.some(([x, v]) => x === 100 && v === y));
  }
  h.dom.window.close();
});

test('暂停不恢复：前三图从最后记录值一直水平延伸到15:00', () => {
  const h = load(windows);
  for (const kind of ['added', 'cancelled', 'net']) for (const side of ['bid', 'ask']) {
    const p = h.pts(kind, side), last = p.at(-1), prior = p.at(-2);
    assert.equal(last[0], 400);
    assert.equal(last[1], prior[1]);
  }
  h.dom.window.close();
});

test('仅暂停5秒再恢复：净加单图在缺口两端保持同值，恢复后继续更新', () => {
  const h = load(windows), p = h.pts('net', 'bid');
  const x1 = +(100 + 5 / 60 / 240 * 400).toFixed(2);
  const x2 = +(100 + 10 / 60 / 240 * 400).toFixed(2);
  const a = p.find(([x]) => x === x1), b = p.find(([x]) => x === x2);
  assert.ok(a && b); assert.equal(a[1], b[1]);
  assert.notEqual(b[1], p.at(-1)[1]);
  h.dom.window.close();
});

test('起点前、短暂停缺口、最后记录后：显示实际指向时刻和未观测，四图虚线同步', () => {
  const h = load(windows);
  for (const time of ['10:00:00', '10:30:07', '14:00:00']) {
    const r = h.slide(time);
    assert.ok(r.text.includes(time)); assert.ok(r.text.includes('此时未观测'));
    assert.ok(!r.text.includes('本次成交'));
    assert.equal(r.crosses.length, 4); assert.ok(r.crosses.every(c => c.shown && c.x === r.crosses[0].x));
  }
  h.dom.window.close();
});

test('有观测处保留成交详情；移出图表后隐藏虚线和详情', () => {
  const h = load(windows), r = h.slide('10:30:13');
  assert.ok(r.text.includes('本次成交')); assert.ok(!r.text.includes('此时未观测'));
  const e = new h.w.Event('pointerleave'); Object.assign(e, { pointerType: 'mouse' });
  h.d.querySelector('svg').dispatchEvent(e);
  assert.equal(h.d.querySelector('.book-wave-tip').hidden, true);
  assert.ok([...h.d.querySelectorAll('.book-wave-cross')].every(x => x.getAttribute('display') === 'none'));
  h.dom.window.close();
});

test('没有已结算数据：缺口提示不显示任何成交数值', () => {
  const h = load([]), r = h.slide('10:00:00');
  assert.ok(r.text.includes('此时未观测')); assert.ok(r.text.includes('暂无已结算'));
  assert.ok(!r.text.includes('本次成交'));
  h.dom.window.close();
});
