'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,base,wait}=require('./ui-harness.cjs');

test('未结算仍立即显示可见变化，估算字段显示—而不是0',async()=>{
 const h=await harness();try{
  await h.capture('depth',.5,{volumes:{'bid:10':100100}});
  assert.match(h.text('bookBidAdditionDetail'),/观察增加 1 手/);assert.match(h.text('bookBidAdditionDetail'),/加单 — 手/);
  assert.equal(h.w.document.querySelector('#bookSideBid [data-field="added"] dd').textContent,'—');assert.ok(h.w.document.querySelectorAll('#bookThreeRows tr').length>=1);
  await h.capture('depth',.7,{volumes:{'bid:10':100300}});assert.match(h.text('bookBidAdditionDetail'),/观察增加 3 手/);assert.match(h.text('bookThreeSummary'),/等待成交资料/);
 }finally{h.close();}
});
test('后到成交补偿旧区间，选点不读取未来响应；返回最新恢复',async()=>{
 const h=await harness();try{
  await h.capture('depth',1,{volumes:{'bid:10':60000}});
  const records=[{time:(base+500)/1000,price:10,volume:70000}];await h.capture('ticks',2,{records});
  assert.match(h.text('bookBidAdditionDetail'),/加单 300 手/);assert.match(h.text('bookBidAdditionDetail'),/净加单 300 手/);assert.match(h.text('bookThreeSource'),/共同成交分母：700 手/);
  h.api.bookRecorder.viewAt('2026-11-17 09:30:01');await wait(25);assert.match(h.text('bookBidAdditionDetail'),/加单 — 手/);assert.equal(h.w.__bookWaveData.windows.reduce((n,w)=>n+w.volume,0),0);
  h.api.bookRecorder.viewAt(null);await wait(25);assert.match(h.text('bookBidAdditionDetail'),/加单 300 手/);assert.equal(h.w.__bookWaveData.windows.reduce((n,w)=>n+w.volume,0),70000);
 }finally{h.close();}
});
test('隐藏文档不等于暂停；用户明确暂停后停止请求',async()=>{
 const h=await harness();try{
  Object.defineProperty(h.w.document,'hidden',{configurable:true,get:()=>true});h.w.__now=base+10000;
  const before=h.calls.length;h.api.bookRecorder.heartbeat();await wait(40);assert.ok(h.calls.length>before);
  h.api.bookRecorder.setPaused(true);await wait(30);const stopped=h.calls.length;h.w.__now+=10000;h.api.bookRecorder.heartbeat();await wait(30);assert.equal(h.calls.length,stopped);
 }finally{h.close();}
});
test('导出v14保留原始记录并包含二元方向弱依据、共同全量分母和端点口径',async()=>{
 const h=await harness();try{
  await h.capture('depth',1);await h.capture('depth',2);await h.capture('ticks',3,{records:[{time:(base+1500)/1000,price:10,volume:100}]});
  await h.api.bookRecorder.exportData('json');const data=JSON.parse(h.w.__export.text);assert.equal(data.schema_version,14);assert.equal(data.calculation.version,14);assert.match(data.calculation.direction_limitation,/do not establish/);assert.ok(data.events.some(e=>e.kind==='depth'));assert.equal(data.ticks.length,1);assert.equal(data.statistics.trade_decisions.length,1);assert.equal(data.statistics.integrity_audit.global_quantity_check,'pass');
  await h.api.bookRecorder.exportData('three');assert.match(h.w.__export.text,/方向未知股/);assert.match(h.w.__export.text,/共同成交分母股/);
  await h.api.bookRecorder.exportData('stats');assert.match(h.w.__export.text,/算法版本/);assert.match(h.w.__export.text,/低依据成交股/);assert.match(h.w.__export.text,/无依据初始化继承股/);
 }finally{h.close();}
});
test('买三无成交仍统计净增加，其他低依据成交不使整段被排除且共同分母不缩小',async()=>{
 const h=await harness();try{
  await h.capture('depth',1,{volumes:{'bid:9.98':105000}});
  await h.capture('ticks',2,{records:[{time:(base+500)/1000,price:10.005,volume:100}]});
  assert.equal(h.w.document.querySelector('#bookSideBid [data-field="added"] dd').textContent,'50');
  assert.match(h.text('bookFlowUnknown'),/低依据 1 手/);assert.match(h.text('bookFlowUnknown'),/初始化\/继承 1 手/);
  assert.match(h.text('bookFlowVolume'),/共同成交分母：1 手/);assert.doesNotMatch(h.text('bookFlowCoverage'),/不计入比率分母/);
  assert.match(h.text('bookStatsDetail'),/算法v14/);assert.match(h.w.document.body.textContent,/速率偏差图/);
  await h.api.bookRecorder.exportData('json');const d=JSON.parse(h.w.__export.text);assert.equal(d.statistics.active_buy_shares+d.statistics.active_sell_shares,100);assert.equal(d.statistics.ambiguous_trade_shares,0);
  assert.equal(d.statistics.integrity_audit.global_quantity_check,'pass');assert.ok(d.statistics.integrity_audit.windows.every(w=>w.status!=='mismatch'));
 }finally{h.close();}
});
test('平均每笔改为去极值后总量/总笔数，而不是聚合行等权平均',async()=>{
 const h=await harness();try{
  const rows=[{price:10,volume:100},{price:10,volume:1000},{price:20,volume:4000},{price:10,volume:10000}],counts=new h.w.Map(rows.map((r,i)=>[r,[1,1,20,1][i]]));
  const result=h.api.tickRowStats(rows,counts);assert.equal(result.remaining,2);assert.equal(result.remainingTrades,21);assert.equal(result.averageLots,5000/21/100);assert.equal(result.averageAmount,90000/21/10000);
 }finally{h.close();}
});
