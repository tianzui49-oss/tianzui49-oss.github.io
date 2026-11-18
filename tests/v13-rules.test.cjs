'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Calc,Audit,base,iso,session,depth,response,tick,calculate,plain,observationStart,pulse}=require('./helpers.cjs');
const {harness,wait}=require('./ui-harness.cjs');
function audit(e,t,s=session,cutoff=Infinity){const r=Calc.calculate(e,t,s,cutoff),a=Audit.calculate(e,t,s,r);assert.equal(a.global_quantity_check,'pass');assert.ok(a.windows.every(w=>w.status!=='mismatch'),JSON.stringify(a.windows.filter(w=>w.status==='mismatch')));assert.equal(r.active_buy_shares+r.active_sell_shares,r.source_trade_volume_shares);assert.equal(r.ambiguous_trade_shares,0);return r;}

test('用户7笔混合路径：五档和逐笔一致印证，不一致采用逐笔而非旧盘口全归买',()=>{
 const prices=[8.70,8.80,8.90,8.70,8.70,8.80,8.80],e=[depth(0,{bid:8.69,ask:8.70}),depth(1,{bid:8.69,ask:8.70}),response(2)],t=prices.map((price,i)=>tick((i+1)/10,100,{id:'user-'+i,price,recv:2})),r=audit(e,t);
 assert.equal(r.version,13);assert.deepEqual(plain(r.trade_decisions.map(d=>d.active_direction)),['buy','buy','buy','sell','sell','buy','buy']);
 assert.equal(r.active_buy_shares,500);assert.equal(r.active_sell_shares,200);assert.equal(r.trade_decisions[3].quote_direction,'buy');assert.equal(r.trade_decisions[3].tick_direction,'sell');assert.equal(r.trade_decisions[3].fusion_status,'conflict_tick_selected');assert.equal(r.trade_decisions[4].tick_reason,'zero_tick_inherit');
});
test('新盘口与下跌不一致也按用户最终口径用成交，记录quote更新而不假称一致',()=>{
 const e=[depth(0,{bid:10,ask:10.10}),depth(.4,{bid:10,ask:10.04}),depth(1,{bid:10,ask:10.04}),response(2)],t=[tick(.2,100,{price:10.10,recv:2,id:'a'}),tick(.5,100,{price:10.04,recv:2,id:'b'})],r=audit(e,t),d=r.trade_decisions[1];
 assert.equal(d.active_direction,'sell');assert.equal(d.quote_direction,'buy');assert.equal(d.tick_direction,'sell');assert.equal(d.quote_updated_since_previous,true);assert.equal(d.fusion_status,'conflict_tick_selected');assert.equal(d.confidence,'low');
});
test('盘口与逐笔都判卖时共同印证；未来同秒盘口不能参与判定',()=>{
 const e=[depth(0),depth(.5,{bid:10.20,ask:10.21}),depth(1),response(2)],t=[tick(.2,100,{price:10.01,recv:2}),tick(.4,100,{price:10,recv:2})],r=audit(e,t);assert.equal(r.trade_decisions[1].fusion_status,'agreement');assert.equal(r.trade_decisions[1].quote_at,iso(0));assert.equal(r.trade_decisions[1].active_direction,'sell');
});
test('相同价位从买侧换卖侧：保留逐笔继承和盘口冲突，不误改成静态报价方向',()=>{
 const e=[depth(0),depth(.4,{bid:9.99,ask:10}),depth(1,{bid:9.99,ask:10}),response(2)],t=[tick(.2,100,{recv:2}),tick(.5,100,{recv:2})],r=audit(e,t);assert.equal(r.trade_decisions[1].active_direction,'sell');assert.equal(r.trade_decisions[1].quote_direction,'buy');assert.equal(r.trade_decisions[1].tick_reason,'zero_tick_inherit');assert.equal(r.trade_decisions[1].fusion_status,'conflict_tick_selected');
});
test('方向融合结果必须同步补偿到同侧同价，不能只改显示买卖数字',()=>{
 const e=[depth(0),depth(1),response(2)],t=[tick(.2,300,{price:10.02,recv:2,id:'up'}),tick(.4,500,{price:10.01,recv:2,id:'down'})],r=audit(e,t),w=r.windows.find(w=>w.sample_pairs);
 assert.equal(r.trade_decisions[1].active_direction,'sell');assert.equal(r.trade_decisions[1].fusion_status,'conflict_tick_selected');const ask=w.levels.find(z=>z.side==='ask'&&z.price===10.01),bid=w.levels.find(z=>z.side==='bid'&&z.price===10.01);assert.equal(ask.executed_shares,0);assert.equal(bid.executed_shares,500);assert.equal(bid.before_shares,0);assert.equal(bid.after_shares,0);assert.equal(bid.added_shares,500);
});
test('0量源行不改变正成交前笔及其方向状态',()=>{
 const t=[tick(.1,0,{price:11,recv:2,id:'zero'}),tick(.2,100,{price:10,recv:2,id:'first'}),tick(.3,0,{price:9,recv:2,id:'zero2'}),tick(.4,100,{price:10,recv:2,id:'same'})],r=audit([observationStart(0),response(2)],t);assert.equal(r.trade_decisions.find(d=>d.id==='first').previous_trade_id,null);assert.equal(r.trade_decisions.find(d=>d.id==='first').forced_assignment,true);assert.equal(r.trade_decisions.find(d=>d.id==='same').previous_trade_id,'first');assert.equal(r.trade_decisions.find(d=>d.id==='same').tick_reason,'zero_tick_inherit');assert.equal(r.source_trade_volume_shares,200);
});
test('跨45秒长间隔/午休重新建立方向，不把旧方向一直继承',()=>{
 const gap=audit([observationStart(0),pulse(20),pulse(40),response(50)],[tick(1,100,{price:10,recv:50,id:'a'}),tick(49,100,{price:9,recv:50,id:'b'})]);assert.equal(gap.trade_decisions[1].continuity_reset,'trade_gap_over_45s');assert.equal(gap.trade_decisions[1].tick_direction,null);assert.equal(gap.trade_decisions[1].forced_assignment,true);
 const lunch=audit([observationStart(7198),pulse(7200),observationStart(12600,{segment:'pm',extra:{kind:'stats_resume'}}),response(12602,{extra:{segment_id:'pm'}})],[tick(7199,100,{price:10,recv:12602,id:'morning'}),tick(12601,100,{price:10,recv:12602,id:'pm'})]);assert.equal(lunch.trade_decisions[1].continuity_reset,'observation_period_changed');assert.equal(lunch.trade_decisions[1].previous_trade_id,null);
});
test('采集段变化/明确暂停恢复打断继承，但普通盘口更新不打断',()=>{
 const t=[tick(.2,100,{recv:2,id:'a'}),tick(.6,100,{recv:2,id:'b'})],normal=audit([depth(0),depth(.4),depth(1),response(2)],t);assert.equal(normal.trade_decisions[1].previous_trade_id,'a');
 const segmented=audit([depth(0,{segment:'a'}),pulse(.3,{segment:'a'}),depth(.4,{segment:'b'}),depth(1,{segment:'b'}),response(2,{extra:{segment_id:'b'}})],t);assert.equal(segmented.trade_decisions[1].continuity_reset,'observation_period_changed');
 const pause={kind:'stats_pause',code:session.code,session_id:session.id,received_at:iso(.3)},resume=observationStart(.4,{extra:{kind:'stats_resume'}}),paused=audit([depth(0),pause,resume,depth(.4),depth(1),response(2)],t);assert.equal(paused.trade_decisions[1].continuity_reset,'observation_period_changed');
});
test('同秒缺源序号显示顺序不确定；按稳定排序逐笔归类而不冒充已知先后',()=>{
 const r=audit([observationStart(0),response(2)],[tick(1,100,{recv:2,id:'a',price:10}),tick(1,100,{recv:2,id:'b',price:10.01})]);assert.equal(r.trade_decisions[1].time_order_uncertain,true);assert.equal(r.trade_decisions[1].confidence,'very_low');
});
test('迟到插入重算融合和后续同价继承，选点到达cutoff保留',()=>{
 const t=[tick(.2,100,{recv:2,id:'a',price:10.01}),tick(.3,100,{recv:5,id:'late',price:10.03}),tick(.4,100,{recv:3,id:'b',price:10.01})],e=[depth(0),depth(1),response(3)],old=audit(e,t,session,base+3000),r=audit(e,t);
 assert.equal(old.trade_decisions.find(d=>d.id==='b').active_direction,'buy');assert.equal(r.trade_decisions.find(d=>d.id==='b').active_direction,'sell');assert.equal(r.trade_decisions.find(d=>d.id==='b').fusion_status,'conflict_tick_selected');assert.equal(old.source_trade_volume_shares,200);assert.equal(r.source_trade_volume_shares,300);
});
test('审计检出融合线索/冲突选择/连续性/最终侧量篡改',()=>{
 const e=[depth(0),depth(1),response(2)],t=[tick(.2,100,{price:10.02,recv:2}),tick(.4,100,{price:10.01,recv:2})],r=audit(e,t);
 for(const mutate of [x=>x.windows[0].trade_decisions[1].tick_direction='buy',x=>x.windows[0].trade_decisions[1].fusion_status='agreement',x=>x.windows[0].trade_decisions[1].continuity_reset='fake',x=>{x.active_buy_shares=200;x.active_sell_shares=0;}]){const x=plain(r);mutate(x);const a=Audit.calculate(e,t,session,x);assert.ok(a.global_quantity_check==='mismatch'||a.windows.some(w=>w.status==='mismatch'));}
});
function hover(h,second,index=3){const svg=h.w.document.querySelectorAll('.book-wave-cell svg')[index];svg.getBoundingClientRect=()=>({left:0,top:0,width:400,height:240});h.w.document.querySelector('.book-wave-grid').getBoundingClientRect=()=>({left:0,top:0});const e=new h.w.Event('pointermove');Object.assign(e,{pointerType:'mouse',clientX:second/14400*400});svg.dispatchEvent(e);return h.w.document.querySelector('.book-wave-tip').textContent;}
test('盘口已推进但成交待资料：四图同进度，悬停不再错误显示此时未观测',async()=>{
 const h=await harness();try{await h.capture('depth',1);assert.equal(h.w.__bookWaveData.version,13);assert.equal(h.w.__bookWaveData.observed_until,base+1000);const progress=[...h.w.document.querySelectorAll('.book-wave-progress')];assert.equal(progress.length,4);assert.ok(progress.every(p=>p.dataset.through===String(base+1000)));const text=hover(h,1);assert.match(text,/盘口：已观测/);assert.match(text,/成交资料待同步/);assert.doesNotMatch(text,/此时未观测/);assert.match(text,/累计成交：资料待同步/);assert.match(text,/净委托累计：—/);assert.doesNotMatch(text,/净委托累计截至已完成区间/);assert.match(hover(h,2),/尚未到达该时刻/);
 }finally{h.close();}
});
test('空响应已覆盖但本分钟无成交：绘制共同时间基准而不编造交易所零成交',async()=>{
 const h=await harness();try{await h.capture('depth',1);await h.capture('ticks',2);const text=hover(h,1);assert.match(text,/主动买入 0/);assert.match(text,/主动卖出 0/);assert.match(text,/该分钟截至指针已收成交为0/);assert.doesNotMatch(text,/此时未观测/);assert.ok(h.w.document.querySelectorAll('.book-wave-trade-observed').length>0);
 }finally{h.close();}
});
test('实际成交分钟hover按指针而非最近窗口终点，并且不使用指针后成交',async()=>{
 const h=await harness();try{await h.capture('depth',58);await h.capture('depth',62);await h.capture('ticks',63,{records:[{time:(base+59000)/1000,price:10.01,volume:100},{time:(base+61500)/1000,price:10,volume:200}]});
 const a=hover(h,59.5);assert.match(a,/09:30 已收成交.*主动买入 1/);assert.match(a,/共同成交 1 手/);assert.doesNotMatch(a,/主动卖出 2/);
 const b=hover(h,61.6);assert.match(b,/09:31 已收成交.*主动卖出 2/);assert.match(b,/共同成交 2 手/);assert.doesNotMatch(b,/此时未观测/);
 const x=[...h.w.document.querySelectorAll('.book-wave-cross')].map(e=>e.getAttribute('x1'));assert.ok(x.every(v=>v===x[0]));
 }finally{h.close();}
});
test('主指标和图名移除估计估算，仍有推算限制说明与JSON依据',async()=>{
 const h=await harness();try{const names=[...h.w.document.querySelectorAll('.book-side-fields dt,.book-comparison-title,.book-wave-name,#bookSideBid .book-side-primary,#bookSideAsk .book-side-primary')].map(e=>e.textContent);assert.ok(names.length>10);assert.ok(names.every(s=>!s.includes('估计')&&!s.includes('估算')),JSON.stringify(names));assert.match(h.w.document.body.textContent,/不保证真实主动方已恢复/);
 await h.capture('depth',1);await h.capture('ticks',2,{records:[{time:(base+500)/1000,price:10.01,volume:100}]});await h.api.bookRecorder.exportData('json');const r=JSON.parse(h.w.__export.text);assert.equal(r.schema_version,13);assert.equal(r.statistics.trade_decisions[0].fusion_status,'quote_only');assert.match(r.calculation.direction_limitation,/do not establish/);
 }finally{h.close();}
});
