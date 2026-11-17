'use strict';
// Optional local replay: QA_REPLAY_FILE=/absolute/raw.json node --test tests/replay-v11.test.cjs
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Calc,Audit}=require('./helpers.cjs');
const file=process.env.QA_REPLAY_FILE;
test('真实盘中记录回放：不改原始数据，成交守恒，无盘口默认未知，审计无计算差异',{skip:!file},()=>{
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),before=JSON.stringify(raw),r=Calc.calculate(raw.events,raw.ticks,raw.session),a=Audit.calculate(raw.events,raw.ticks,raw.session,r);
 assert.equal(r.source_trade_volume_shares,raw.statistics.source_trade_volume_shares);
 assert.equal(r.active_buy_shares+r.active_sell_shares+r.ambiguous_trade_shares,r.source_trade_volume_shares);
 assert.equal(a.global_quantity_check,'pass');assert.ok(a.windows.every(w=>w.status!=='mismatch'));
 for(const w of r.windows.filter(w=>!w.sample_pairs)){assert.equal(w.active_buy_shares,0);assert.equal(w.active_sell_shares,0);assert.equal(w.ambiguous_trade_shares,w.source_trade_volume_shares);assert.equal(w.bid.denominator_trade_shares,0);assert.equal(w.bid.added_shares,null);}
 assert.equal(JSON.stringify(raw),before);
 console.log(JSON.stringify({version:r.version,windows:r.windows.length,total_lots:r.source_trade_volume_shares/100,estimated_buy_lots:r.active_buy_shares/100,estimated_sell_lots:r.active_sell_shares/100,unknown_lots:r.ambiguous_trade_shares/100,eligible_trade_lots:r.eligible_trade_volume_shares/100,coverage_pct:r.coverage_pct,audit_global:a.global_quantity_check}));
});
