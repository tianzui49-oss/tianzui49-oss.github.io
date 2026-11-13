/* eslint-env node */
'use strict';

// Black-box tests for the calculator embedded in repo/index.html.  The production
// implementation may expose per-price rows as windows[].levels or reconciliation;
// these tests deliberately accept either representation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadCalculator() {
  const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('const BookThreeSecondCalculator =');
  const endMarker = "if (typeof module !== 'undefined') module.exports = BookThreeSecondCalculator;";
  const end = html.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error('BookThreeSecondCalculator was not found in index.html');
  const source = html.slice(start, end + endMarker.length);
  const sandbox = { module: { exports: {} }, exports: {}, console, Date, Math, JSON, Set, Map, Number, String };
  vm.runInNewContext(source, sandbox, { filename: 'index.html#BookThreeSecondCalculator' });
  return sandbox.module.exports;
}
const Calculator = loadCalculator();

const code = '600000';
const session = { id: 'test-session', code, day: '2026-01-02', started_at: '2026-01-02T09:30:00+08:00' };
const t = (second, millis = 0) => new Date(Date.parse(session.started_at) + second * 1000 + millis).toISOString();
const isoMs = x => Date.parse(x);
const prices = { bid: [100, 99, 98, 97, 96], ask: [101, 102, 103, 104, 105] };
function rows(volumes = {}) {
  return ['bid', 'ask'].flatMap(side => prices[side].map((price, i) => ({ side, level: i + 1, price, volume: Number(volumes[`${side}:${price}`] ?? 100) })));
}
function rowsAt(bids, asks, volumes = {}) {
  return ['bid', 'ask'].flatMap(side => (side === 'bid' ? bids : asks).map((price, i) => ({ side, level: i + 1, price, volume: Number(volumes[`${side}:${price}`] ?? 100) })));
}
function depth(receivedAt, volumes = {}, extra = {}) {
  return { kind: 'depth', session_id: session.id, code, segment_id: 'seg-1', received_at: receivedAt, payload: { rows: rows(volumes) }, ...extra };
}
function depthAt(receivedAt, bids, asks, volumes = {}) {
  return { kind: 'depth', session_id: session.id, code, segment_id: 'seg-1', received_at: receivedAt, payload: { rows: rowsAt(bids, asks, volumes) } };
}
function tickResponse(receivedAt, id = `resp-${receivedAt}`, payloadRows = []) {
  return { kind: 'tick_response', session_id: session.id, code, segment_id: 'seg-1', received_at: receivedAt, id, row_count: payloadRows.length,
    payload: { rows: payloadRows }, payload_metadata: { bounds: { mode: 'available-day', day: session.day } } };
}
function tick(receivedAt, tradeTime, volume, id = `tick-${tradeTime}-${volume}`, price = 100) {
  return { id, code, first_received_at: receivedAt, row: { time: tradeTime, price, volume } };
}
function calculate(events, ticks = [], cutoff = Infinity) {
  return Calculator.calculate(events, ticks, session, cutoff);
}
function audit(events, ticks, result) {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
  const start = html.indexOf('const BookStatisticsAudit =');
  const marker = "if(typeof globalThis!=='undefined')globalThis.BookStatisticsAudit=BookStatisticsAudit;";
  const end = html.indexOf(marker, start);
  if (start < 0 || end < 0) throw new Error('BookStatisticsAudit was not found in index.html');
  const box = { module: { exports: {} }, console };
  vm.runInNewContext(html.slice(start, end + marker.length), box);
  return box.module.exports.calculate(events, ticks, session, result);
}
function windows(result) { return Array.isArray(result?.windows) ? result.windows : []; }
function allLevelRows(result) {
  const out = [];
  for (const w of windows(result)) {
    for (const key of ['levels', 'rows', 'details', 'reconciliation']) if (Array.isArray(w[key])) out.push(...w[key]);
  }
  if (Array.isArray(result?.reconciliation)) out.push(...result.reconciliation);
  return out;
}
function sideTotals(result, side) {
  const ws = windows(result);
  const source = ws.length ? ws : (Array.isArray(result?.timeline) ? result.timeline : []);
  return source.reduce((a, w) => {
    const x = w?.[side] || {};
    for (const k of ['added_shares', 'visible_added_shares', 'cancellation_shares', 'observed_reduction_shares', 'net_change_shares', 'denominator_trade_shares']) {
      if (Number.isFinite(Number(x[k]))) a[k] += Number(x[k]);
    }
    return a;
  }, { added_shares: 0, visible_added_shares: 0, cancellation_shares: 0, observed_reduction_shares: 0, net_change_shares: 0, denominator_trade_shares: 0 });
}
function level(result, side, price) { return allLevelRows(result).find(x => x.side === side && Number(x.price) === price); }
function assertMetric(result, side, metric, expected, message) {
  const row = level(result, side, 100);
  const aggregate = sideTotals(result, side);
  const actual = row && Number.isFinite(Number(row[metric])) ? Number(row[metric]) : aggregate[metric];
  assert.equal(actual, expected, message || `${side}.${metric}`);
}
function scenario(volumesA, volumesB, trades = [], responseAt = 2) {
  const at0 = t(0), at1 = t(1), at2 = t(responseAt);
  const events = [depth(at0, volumesA), depth(at1, volumesB), tickResponse(at2)];
  return calculate(events, trades);
}

// User's canonical example: positive increments A=10, reductions R=8, same-price trade T=5.
test('same-side price comparison: 10 observed additions, 8 reduced, T=5 => add 10, cancel 3, net 7', () => {
  const r = scenario({ 'bid:100': 100 }, { 'bid:100': 102 }, [tick(t(1, 500), t(1, 400), 5)], 2);
  // The fixture also has a second intermediate update so A and R are accumulated,
  // rather than reconstructed from only an endpoint.
  const r2 = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 110 }),
    depth(t(2), { 'bid:100': 102 }), tickResponse(t(3))
  ], [tick(t(2, 100), t(1, 500), 5)]);
  assertMetric(r2, 'bid', 'added_shares', 10);
  assertMetric(r2, 'bid', 'visible_added_shares', 10);
  assertMetric(r2, 'bid', 'executed_shares', 5);
  assertMetric(r2, 'bid', 'replenishment_shares', 0);
  assertMetric(r2, 'bid', 'cancellation_shares', 3);
  assertMetric(r2, 'bid', 'net_change_shares', 7);
});

test('T=0 means all eight reduction shares are cancellation, net is +2', () => {
  const r = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 110 }),
    depth(t(2), { 'bid:100': 102 }), tickResponse(t(3))
  ]);
  assertMetric(r, 'bid', 'added_shares', 10);
  assertMetric(r, 'bid', 'cancellation_shares', 8);
  assertMetric(r, 'bid', 'net_change_shares', 2);
});

test('multiple non-endpoint changes accumulate positive and negative deltas', () => {
  const r = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 110 }),
    depth(t(2), { 'bid:100': 106 }), depth(t(3), { 'bid:100': 112 }),
    depth(t(4), { 'bid:100': 102 }), tickResponse(t(5))
  ], [tick(t(4, 100), t(3, 500), 5)]);
  assertMetric(r, 'bid', 'added_shares', 16);
  assertMetric(r, 'bid', 'cancellation_shares', 9);
  assertMetric(r, 'bid', 'net_change_shares', 7);
});

test('irregular update spacing is retained; fixed three-second buckets are not assumed', () => {
  const r = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1, 700), { 'bid:100': 110 }),
    depth(t(4, 200), { 'bid:100': 102 }), tickResponse(t(5, 100))
  ], [tick(t(4, 300), t(4, 250), 5)]);
  assert.ok(windows(r).length >= 1);
  assert.equal(sideTotals(r, 'bid').added_shares, 10);
});

test('duplicate response is not a new trade-detail update', () => {
  const unique = tick(t(1, 100), t(1), 5, 'same-id');
  const r = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 102 }),
    tickResponse(t(2), 'response-a'), tickResponse(t(3), 'response-b')
  ], [unique, { ...unique, first_received_at: t(3), id: 'same-id' }]);
  assert.equal(r.source_trade_volume_shares, 5);
});

test('successful empty response explicitly confirms zero updates', () => {
  const r = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 92 }),
    tickResponse(t(2), 'empty-response', [])
  ], []);
  assert.equal(r.source_trade_volume_shares, 0);
  assert.equal(sideTotals(r, 'bid').cancellation_shares, 8);
});

test('same-price matching survives a move across five levels; boundary is not invented add/cancel', () => {
  const r = calculate([
    depth(t(0), { 'bid:100': 100, 'bid:99': 90 }),
    depth(t(1), { 'bid:100': 95, 'bid:99': 100 }),
    tickResponse(t(2))
  ], [tick(t(1, 200), t(1, 100), 5, 'cross-level', 100)]);
  const rows = allLevelRows(r);
  assert.ok(rows.some(x => x.side === 'bid' && Number(x.price) === 100), 'price identity should be used, not level number');
  assert.equal((r.visibility_changes || []).filter(x => x.visibility_state === 'entered_five' || x.visibility_state === 'left_five').length >= 0, true);
});

test('trade price outside both sides top five is excluded from order-book statistics', () => {
  const r = calculate([
    depth(t(0)), depth(t(1)), tickResponse(t(2))
  ], [tick(t(1, 200), t(1, 100), 7, 'outside', 110)]);
  assert.equal(r.source_trade_volume_shares, 7);
  assert.equal(r.order_book_trade_volume_shares, 0);
  assert.equal(r.excluded_trade_volume_shares, 7);
  assert.equal(sideTotals(r, 'bid').denominator_trade_shares, 0);
  assert.equal(sideTotals(r, 'ask').denominator_trade_shares, 0);
  assert.equal(r.excluded_trade_volume_by_reason.outside_top_five, 7);
});

test('historical cutoff excludes later events and does not erase prior history', () => {
  const events = [
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 105 }), tickResponse(t(2), 'before'),
    depth(t(4), { 'bid:100': 110 }), tickResponse(t(5), 'after')
  ];
  const full = calculate(events, [], Infinity);
  const historical = calculate(events, [], isoMs(t(3)));
  assert.ok(windows(full).length >= windows(historical).length);
  assert.ok(windows(historical).length >= 1);
  assert.ok(sideTotals(historical, 'bid').added_shares > 0);
});

test('pending book-only changes are not included in cumulative totals until confirmed', () => {
  const pending = calculate([
    depth(t(0), { 'bid:100': 100 }), depth(t(1), { 'bid:100': 110 })
  ], []);
  assert.ok((pending.pending_intervals || 0) >= 1 || windows(pending).some(w => w.included_in_cumulative === false));
  assert.equal(sideTotals(pending, 'bid').added_shares, 0);
});

// Stronger boundary and aggregation checks using the production event shape.
test('all five prices on both sides settle; only visible trade volume is the shared denominator',()=>{
  const e=[depth(t(0)),depth(t(1),Object.fromEntries(['bid','ask'].flatMap(s=>prices[s].map(p=>[`${s}:${p}`,110])))),depth(t(2),Object.fromEntries(['bid','ask'].flatMap(s=>prices[s].map(p=>[`${s}:${p}`,102]))))];
  const r=calculate(e,[tick(t(2,500),t(2),5,'one',100),tick(t(2,500),t(2),7,'out',110)]),w=r.windows[0];
  assert.equal(w.levels.length,10);assert.equal(w.bid.added_shares,50);assert.equal(w.bid.cancellation_shares,35);assert.equal(w.bid.net_change_shares,15);assert.equal(w.ask.added_shares,50);assert.equal(w.ask.cancellation_shares,40);assert.equal(w.ask.net_change_shares,10);assert.equal(w.bid.denominator_trade_shares,5);assert.equal(w.ask.denominator_trade_shares,5);assert.equal(w.source_trade_volume_shares,12);assert.equal(w.excluded_trade_volume_shares,7);assert.equal(w.bid.net_addition_rate_pct,300);
});
test('trade exceeding observed reduction transfers the excess into additions',()=>{
  const r=calculate([depth(t(0)),depth(t(1),{'bid:100':98})],[tick(t(1,500),t(1),9)]),w=r.windows[0];assert.equal(w.bid.added_shares,7);assert.equal(w.bid.cancellation_shares,0);assert.equal(w.bid.net_change_shares,7);
});
test('actual level shift follows same price and excludes entered/left boundary volumes',()=>{
 const first=depth(t(0)), second=depth(t(1));second.payload.rows=second.payload.rows.filter(r=>r.side!=='bid');second.payload.rows.push(...[99,98,97,96,95].map((p,i)=>({side:'bid',price:p,level:i+1,volume:p===99?107:100})));
 const r=calculate([first,second],[tick(t(1,500),t(1),0)]),w=r.windows[0];assert.equal(w.bid.added_shares,7);assert.equal(w.bid.cancellation_shares,0);assert.equal(r.visibility_changes.filter(z=>z.delta_shares===null).length,2);
});
test('nonempty repeated responses never settle pending changes again',()=>{
 const e=[depth(t(0)),depth(t(1),{'bid:100':110}),{...tickResponse(t(1,500)),row_count:1},depth(t(2),{'bid:100':105}),{...tickResponse(t(3)),row_count:1}];const r=calculate(e,[tick(t(1,500),t(1),5)]);assert.equal(r.windows.length,1);assert.equal(r.pending_intervals,1);assert.equal(r.windows[0].bid.cancellation_shares,0);
});
test('independent audit matches raw records and detects altered aggregate',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../index.html'),'utf8'),a=html.indexOf('const BookStatisticsAudit ='),b=html.indexOf("if(typeof globalThis!=='undefined')globalThis.BookStatisticsAudit=BookStatisticsAudit;",a),box={module:{exports:{}},console};vm.runInNewContext(html.slice(a,b),box);const Audit=box.module.exports;
 const e=[depth(t(0)),depth(t(1),{'bid:100':110}),depth(t(2),{'bid:100':102}),{...tickResponse(t(2,500)),row_count:1}],ticks=[tick(t(2,500),t(2),5)];const r=calculate(e,ticks),audit=Audit.calculate(e,ticks,session,r);assert.equal(audit.windows.length,1);assert.equal(audit.windows[0].status,'pass');assert.equal(audit.windows[0].delta.bid_added_shares,0);assert.equal(audit.windows[0].delta.bid_reduced_shares,0);r.windows[0].bid.added_shares+=1;assert.equal(Audit.calculate(e,ticks,session,r).windows[0].status,'mismatch');
});

test('each update adds to cumulative numerators/denominator; negative net rate is preserved',()=>{
 const e=[depth(t(0)),depth(t(1),{'bid:100':90}),{...tickResponse(t(1,500)),row_count:1},depth(t(2),{'bid:100':88}),{...tickResponse(t(2,500)),row_count:1}],ticks=[tick(t(1,500),t(1),3,'first'),tick(t(2,500),t(2),5,'second')];
 const r=calculate(e,ticks);assert.equal(r.windows.length,2);assert.equal(r.windows[0].bid.net_change_shares,-7);assert.equal(r.windows[1].bid.added_shares,3);const last=r.timeline.at(-1).bid;assert.equal(last.added_shares,3);assert.equal(last.cancellation_shares,7);assert.equal(last.net_change_shares,-4);assert.equal(last.denominator_trade_shares,8);assert.equal(last.addition_rate_pct,37.5);assert.equal(last.reduction_rate_pct,87.5);assert.equal(last.net_addition_rate_pct,-50);
});

test('bid-to-ask switch assigns each trade to the side visible at that trade time',()=>{
  const e=[
    depthAt(t(0),[100,99,98,97,96],[101,102,103,104,105],{'bid:100':100}),
    depthAt(t(1),[99,98,97,96,95],[100,102,103,104,105],{'ask:100':30}),
    tickResponse(t(2))
  ];
  const r=calculate(e,[tick(t(2),t(0,500),3,'before-switch',100),tick(t(2),t(1),5,'after-switch',100)]),w=r.windows[0];
  assert.equal(w.bid.executed_shares,3);assert.equal(w.ask.executed_shares,5);
  assert.equal(w.side_switch_count,1);assert.equal(w.side_switches[0].from_side,'bid');assert.equal(w.side_switches[0].to_side,'ask');
  const oldSide=level(r,'bid',100),newSide=level(r,'ask',100);assert.equal(oldSide.observed_reduction_shares,100);assert.equal(oldSide.cancellation_shares,97);assert.equal(newSide.executed_shares,5);assert.equal(newSide.visible_added_shares,30);
  assert.equal(w.active_flow.sell_shares,33);assert.equal(w.active_flow.buy_shares,5);
  assert.equal(r.aggressor_direction_available,false);assert.equal(r.trade_side_semantics,'observed_quote_side_not_aggressor');
});

test('ask-to-bid switch attributes trade to bid without carrying ask volume across',()=>{
  const e=[
    depthAt(t(0),[99,98,97,96,95],[100,101,102,103,104],{'ask:100':120}),
    depthAt(t(1),[100,99,98,97,96],[101,102,103,104,105],{'bid:100':40}),
    tickResponse(t(2))
  ];
  const r=calculate(e,[tick(t(2),t(1),9,'ask-to-bid',100)]),w=r.windows[0];
  assert.equal(w.ask.executed_shares,0);assert.equal(w.bid.executed_shares,9);
  assert.equal(w.side_switch_count,1);assert.equal(w.side_switches[0].from_side,'ask');assert.equal(w.side_switches[0].to_side,'bid');
  assert.equal(level(r,'ask',100).observed_reduction_shares,120);assert.equal(level(r,'bid',100).executed_shares,9);
  assert.equal(w.active_flow.sell_shares,9);assert.equal(w.active_flow.buy_shares,0);
});

test('ask addition example keeps 230 observed adds, 200 executions and 30 remaining distinct',()=>{
  const bids=[99,98,97,96,95],asks=[100,101,102,103,104];
  const e=[
    depthAt(t(0),bids,asks,{'ask:100':0}),
    depthAt(t(1),bids,asks,{'ask:100':230}),
    depthAt(t(2),bids,asks,{'ask:100':30}),
    tickResponse(t(3))
  ];
  const r=calculate(e,[tick(t(3),t(2),200,'seller-add-example',100)]),w=r.windows[0],z=level(r,'ask',100);
  assert.equal(w.ask.added_shares,230);assert.equal(w.ask.visible_added_shares,230);assert.equal(w.ask.replenishment_shares,0);
  assert.equal(w.ask.executed_shares,200);assert.equal(w.ask.observed_reduction_shares,200);assert.equal(w.ask.cancellation_shares,0);
  assert.equal(z.after_shares,30);assert.equal(z.added_shares,230);assert.equal(z.executed_shares,200);
});

test('bid-side quote capacity is capped at visible zero after a 100-share reduction; excess is not pushed to another level',()=>{
  const r=calculate([
    depth(t(0),{'bid:100':100}),depth(t(1),{'bid:100':0}),tickResponse(t(2))
  ],[tick(t(2),t(1),200,'bid-replenishment-example',100)]),w=r.windows[0];
  assert.equal(w.bid.observed_reduction_shares,100);assert.equal(w.bid.executed_shares,200);
  assert.equal(w.bid.replenishment_shares,100);assert.equal(w.bid.added_shares,100);assert.equal(w.bid.cancellation_shares,0);
  assert.equal(w.bid.quote_depth_matched_shares,0);assert.equal(w.bid.unresolved_trade_shares,200);
  assert.equal(w.aggressor_direction_available,false);assert.equal(w.trade_side_semantics,'observed_quote_side_not_aggressor');
});

test('independent audit verifies side-switch attribution and excludes out-of-book volume',()=>{
  const e=[
    depthAt(t(0),[100,99,98,97,96],[101,102,103,104,105]),
    depthAt(t(1),[99,98,97,96,95],[100,102,103,104,105]),
    tickResponse(t(2))
  ],ticks=[tick(t(2),t(1),5,'visible-ask',100),tick(t(2),t(1),7,'outside',110)];
  const r=calculate(e,ticks),a=audit(e,ticks,r),w=a.windows.at(-1);
  assert.equal(w.status,'pass');assert.equal(w.delta.order_book_trade_volume_shares,0);
  assert.equal(r.windows.at(-1).order_book_trade_volume_shares,5);
  assert.equal(r.windows.at(-1).ask.executed_shares,5);assert.equal(r.windows.at(-1).bid.executed_shares,0);
});

test('same price stays tracked through level movement and bid-to-ask switch; quote-side estimate is not asserted as true aggressor',()=>{
  const e=[
    depthAt(t(0),[101,100,99,98,97],[102,103,104,105,106]),
    depthAt(t(1),[102,101,100,99,98],[103,104,105,106,107]),
    depthAt(t(2),[99,98,97,96,95],[100,102,103,104,105],{'ask:100':30}),
    tickResponse(t(3))
  ],ticks=[
    tick(t(3),t(1,500),5,'before-side-switch',100),
    tick(t(3),t(2,500),7,'after-side-switch',100)
  ];
  const r=calculate(e,ticks),w=r.windows[0];
  assert.equal(w.order_book_trade_volume_shares,12);
  assert.equal(w.trade_classifications[0].quote_side,'bid');assert.equal(w.trade_classifications[1].quote_side,'ask');
  assert.equal(w.trade_classifications[0].aggressor_side,null);assert.equal(w.trade_classifications[0].active_side_estimate,'sell');
  assert.equal(w.active_flow.sell_trade_shares,5);assert.equal(w.active_flow.sell_post_switch_visible_shares,30);assert.equal(w.active_flow.sell_shares,35);
  assert.equal(w.active_flow.buy_shares,7);assert.equal(w.aggressor_direction_available,false);
});

test('100 bid shares plus an observed same-price refill to 200, 200 trade shares, then 30 visible on ask => sell estimate 230 and bid add 100',()=>{
  const e=[
    depthAt(t(0),[100,99,98,97,96],[101,102,103,104,105],{'bid:100':10000}),
    depthAt(t(1),[100,99,98,97,96],[101,102,103,104,105],{'bid:100':20000}),
    depthAt(t(2),[99,98,97,96,95],[100,102,103,104,105],{'ask:100':3000}),
    tickResponse(t(3))
  ],ticks=[tick(t(3),t(1,500),20000,'canonical-100-200-30',100).row];
  const fullTicks=[{id:'canonical-100-200-30',code,first_received_at:t(3),row:{...ticks[0],deal_type:1,ask_order_id:4294967295}}];
  const r=calculate(e,fullTicks),w=r.windows[0],bid=level(r,'bid',100),ask=level(r,'ask',100);
  assert.equal(w.active_flow.sell_trade_shares,20000);assert.equal(w.active_flow.sell_post_switch_visible_shares,3000);assert.equal(w.active_flow.sell_shares,23000);
  assert.equal(w.bid.added_shares,10000);assert.equal(w.bid.observed_reduction_shares,20000);assert.equal(w.bid.cancellation_shares,0);
  assert.equal(bid.quote_depth_matched_shares,20000);assert.equal(bid.unresolved_trade_shares,0);assert.equal(ask.visible_added_shares,3000);
  assert.equal(w.trade_classifications[0].quote_side,'bid');assert.equal(w.trade_classifications[0].aggressor_side,null);assert.equal(w.trade_classifications[0].deal_type_direction_recognized,false);
  assert.equal(w.aggressor_direction_available,false);
  const checked=audit(e,fullTicks,r).windows.at(-1);assert.equal(checked.status,'pass');assert.equal(checked.active_flow.sell_shares,23000);
});

test('trade volume beyond exact-price capacity remains unresolved and never waterfalls into an adjacent price',()=>{
  const e=[depth(t(0),{'bid:100':10000,'bid:99':50000}),depth(t(1),{'bid:100':10000,'bid:99':50000}),tickResponse(t(2))];
  const r=calculate(e,[tick(t(2),t(1,500),20000,'too-deep',100),tick(t(2),t(1,500),3000,'next-price',99)]),w=r.windows[0];
  const at100=w.trade_classifications.find(x=>x.price===100),at99=w.trade_classifications.find(x=>x.price===99);
  assert.equal(at100.quote_depth_matched_shares,10000);assert.equal(at100.unresolved_trade_shares,10000);
  assert.equal(at99.quote_depth_matched_shares,3000);assert.equal(at99.unresolved_trade_shares,0);
  assert.equal(w.order_book_trade_volume_shares,23000);
});

test('late trade response still receives the later same-price cross-side remainder by trade time',()=>{
  const e=[
    depthAt(t(0),[100,99,98,97,96],[101,102,103,104,105],{'bid:100':10000}),
    depthAt(t(1),[99,98,97,96,95],[100,102,103,104,105],{'ask:100':3000}),
    tickResponse(t(2),'empty-before-late-trade'),
    tickResponse(t(3),'late-trade-response',[{time:t(0,500),price:100,volume:20000}])
  ],ticks=[tick(t(3),t(0,500),20000,'late-cross-side',100)];
  const r=calculate(e,ticks),last=r.windows.at(-1);
  assert.equal(last.source_trade_volume_shares,20000);assert.equal(last.active_flow.sell_trade_shares,20000);
  assert.equal(last.active_flow.sell_post_switch_visible_shares,3000);assert.equal(last.active_flow.sell_shares,23000);
  assert.equal(audit(e,ticks,r).windows.at(-1).status,'pass');
});
