'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,base,wait}=require('./ui-harness.cjs');
test('端到端：同价相邻补偿、累计分母、审计、选点和本地历史控件',async()=>{
 const h=await harness();try{
  await h.capture('depth',1,{volumes:{'bid:10':101000}});await h.capture('depth',2,{volumes:{'bid:10':100200}});
  assert.match(h.text('bookThreeSummary'),/等待成交资料/);assert.match(h.text('bookBidAdditionDetail'),/加单 — 手/);
  const records=[{time:(base+1500)/1000,price:10,volume:500}];await h.capture('ticks',2.5,{records});
  assert.match(h.text('bookBidAdditionDetail'),/加单 10 手；撤单 3 手/);assert.match(h.text('bookBidAdditionDetail'),/净加单 7 手/);assert.match(h.text('bookThreeSource'),/共同成交分母：5 手/);assert.match(h.text('bookAuditStatus'),/差异 0 窗/);
  await h.capture('depth',3,{volumes:{'bid:10':99200}});records.push({time:(base+2800)/1000,price:10,volume:100});await h.capture('ticks',3.5,{records});
  assert.match(h.text('bookBidAdditionDetail'),/加单 10 手；撤单 12 手/);assert.match(h.text('bookBidAdditionDetail'),/净加单 -2 手/);assert.match(h.text('bookThreeSource'),/共同成交分母：6 手/);
  h.api.bookRecorder.viewAt('2026-11-17 09:30:02');await wait(25);assert.doesNotMatch(h.text('bookBidAdditionDetail'),/加单 10 手/);assert.ok(h.w.__bookWaveData.windows.every(w=>w.end<=base+2000));
  h.api.bookRecorder.viewAt(null);await wait(25);assert.match(h.text('bookBidAdditionDetail'),/撤单 12 手/);assert.ok(h.w.document.getElementById('bookSavedHistory'));assert.ok(h.w.document.getElementById('bookHistoryExport'));
 }finally{h.close();}
});
