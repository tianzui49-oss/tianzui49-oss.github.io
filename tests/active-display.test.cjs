'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {harness,wait,base,html,ui}=require('./ui-harness.cjs');
function values(w){return ['#bookSideBid [data-field="activeBuy"] dd','#bookSideAsk [data-field="activeSell"] dd'].map(s=>w.document.querySelector(s)?.textContent);}
const trades=[{time:(base+1200)/1000,price:10.01,volume:300},{time:(base+1300)/1000,price:10,volume:200}];

test('presentation URL随脚本内容变化，不复用旧缓存',()=>{
 const hash=crypto.createHash('sha256').update(ui).digest('hex').slice(0,16);assert.ok(html.includes('./ui-parity.js?v='+hash));
});
test('两侧估计主动量与方向依据在可见区，未收数据不伪造0',async()=>{
 const h=await harness();try{
  for(const [side,kind,label]of [['Bid','activeBuy','主动买入（手）'],['Ask','activeSell','主动卖出（手）']]){const row=h.w.document.querySelector('#bookSide'+side+' [data-field="'+kind+'"]');assert.ok(row);assert.equal(row.querySelector('dt').textContent,label);assert.equal(row.closest('[hidden]'),null);assert.equal(row.querySelector('dd').textContent,'—');}
  assert.equal(h.w.document.getElementById('bookFlowUnknown').closest('[hidden]'),null);assert.match(h.text('bookFlowUnknown'),/等待成交/);assert.ok(h.w.document.getElementById('bookThreeCSV'));
 }finally{h.close();}
});
test('真实记录器收齐相邻两帧后显示估计买卖，重复响应不重复',async()=>{
 const h=await harness();try{
  await h.capture('depth',1);await h.capture('depth',2);await h.capture('ticks',2.5,{records:trades});
  assert.deepEqual(values(h.w),['3','2']);assert.equal(h.w.document.querySelector('#bookSideBid [data-field="volume"] dd').textContent,'5');assert.match(h.text('bookFlowUnknown'),/低依据 0 手/);assert.match(h.text('bookFlowUnknown'),/买＋卖＝共同成交/);
  await h.capture('ticks',3,{records:trades});assert.deepEqual(values(h.w),['3','2']);assert.match(h.text('bookAuditStatus'),/差异 0 窗/);assert.match(h.text('bookAuditStatus'),/源未确认完整/);
  h.api.bookRecorder.viewAt('2026-11-17 09:30:02');await wait(25);assert.deepEqual(values(h.w),['0','0']);assert.ok(h.w.__bookWaveData.windows.every(w=>w.end<=base+2000));
  h.api.bookRecorder.viewAt(null);await wait(25);assert.deepEqual(values(h.w),['3','2']);
 }finally{h.close();}
});
test('仅成交无后帧仍根据前报价归买卖，不需要后帧才判断方向',async()=>{
 const h=await harness();try{
  await h.capture('ticks',2,{records:[{time:(base+1000)/1000,price:10,volume:70000}]});
  assert.deepEqual(values(h.w),['0','700']);assert.match(h.text('bookFlowUnknown'),/低依据 0 手/);assert.equal(h.w.document.querySelector('#bookSideBid [data-field="added"] dd').textContent,'—');assert.match(h.text('bookAuditStatus'),/资料不足/);
 }finally{h.close();}
});
test('新日期会话不覆盖旧日期只读结果，四图与表格都遵守选择时间',async()=>{
 const h=await harness();try{
  await h.capture('depth',1);await h.capture('depth',2);await h.capture('ticks',2.5,{records:trades});
  h.w.__now=base+86400000;h.api.state.chartDate='2026-11-18';await h.api.bookRecorder.begin('600036',new h.w.Date().toISOString(),true);await wait(60);
  h.api.state.chartDate='2026-11-17';h.api.bookRecorder.viewAt('2026-11-17 15:00:00');await wait(40);assert.deepEqual(values(h.w),['3','2']);assert.equal(h.w.__bookWaveData.day,'2026-11-17');assert.equal(h.w.__bookWaveData.windows.reduce((n,w)=>n+w.volume,0),500);
  h.api.bookRecorder.viewAt('2026-11-17 09:30:02');await wait(30);assert.deepEqual(values(h.w),['0','0']);assert.ok(h.w.__bookWaveData.windows.every(w=>w.end<=base+2000));
  h.api.state.chartDate='2026-11-16';h.api.bookRecorder.viewAt('2026-11-16 15:00:00');await wait(25);assert.deepEqual(values(h.w),['—','—']);assert.equal(h.w.__bookWaveData.windows.length,0);
 }finally{h.close();}
});
