'use strict';
// Optional local replay: QA_REPLAY_FILE=/absolute/raw.json node --test tests/replay-v11.test.cjs
// File name kept for existing local automation; acceptance contract is v12.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {Calc,Audit}=require('./helpers.cjs');
const file=process.env.QA_REPLAY_FILE;
test('真实记录v12回放：原始不变，买卖全量守恒，逐价补偿与共同分母审计无差异',{skip:!file},()=>{
 const raw=JSON.parse(fs.readFileSync(file,'utf8')),before=JSON.stringify(raw),s=raw.session||raw.sessions?.[0],r=Calc.calculate(raw.events,raw.ticks,s),a=Audit.calculate(raw.events,raw.ticks,s,r);
 assert.equal(r.version,12);assert.equal(r.source_trade_volume_shares,raw.statistics.source_trade_volume_shares);
 assert.equal(r.active_buy_shares+r.active_sell_shares,r.source_trade_volume_shares);assert.equal(r.ambiguous_trade_shares,0);
 assert.equal(r.denominator_trade_shares,r.source_trade_volume_shares);assert.equal(r.timeline.at(-1).bid.denominator_trade_shares,r.source_trade_volume_shares);
 assert.ok(r.trade_decisions.every(d=>['buy','sell'].includes(d.active_direction)&&d.reason&&d.confidence));
 assert.equal(a.global_quantity_check,'pass');assert.ok(a.windows.every(w=>w.status!=='mismatch'));
 for(const w of r.windows.filter(w=>!w.sample_pairs)){assert.equal(w.active_buy_shares+w.active_sell_shares,w.source_trade_volume_shares);assert.equal(w.ambiguous_trade_shares,0);assert.equal(w.bid.denominator_trade_shares,w.source_trade_volume_shares);assert.equal(w.bid.added_shares,null);}
 assert.equal(JSON.stringify(raw),before);
 console.log(JSON.stringify({version:r.version,windows:r.windows.length,total_lots:r.source_trade_volume_shares/100,estimated_buy_lots:r.active_buy_shares/100,estimated_sell_lots:r.active_sell_shares/100,unknown_lots:r.ambiguous_trade_shares/100,low_evidence_lots:r.low_confidence_trade_shares/100,forced_initialization_lots:r.forced_direction_shares/100,denominator_lots:r.denominator_trade_shares/100,queue_compensable_trade_lots:r.eligible_trade_volume_shares/100,coverage_pct:r.coverage_pct,audit_global:a.global_quantity_check}));
});
