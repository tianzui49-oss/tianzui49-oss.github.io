'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Calc,Audit,base,iso,session,depth,response,tick,calculate,plain,observationStart,pulse}=require('./helpers.cjs');
const {harness}=require('./ui-harness.cjs');
const boundary=(kind,second,segment)=>({kind,code:session.code,session_id:session.id,segment_id:segment,received_at:iso(second),scope_only:true,...(['stats_start','stats_resume'].includes(kind)?{observation_started_at:iso(second),session}:{observed_until:iso(second)})});
function audited(events,ticks,s=session,cutoff=Infinity){const before=JSON.stringify([events,ticks]),r=Calc.calculate(events,ticks,s,cutoff),a=Audit.calculate(events,ticks,s,r);assert.equal(a.global_quantity_check,'pass');assert.ok(a.windows.every(w=>w.status!=='mismatch'),JSON.stringify(a.windows.filter(w=>w.status==='mismatch')));assert.equal(r.active_buy_shares+r.active_sell_shares,r.source_trade_volume_shares);assert.equal(r.source_trade_volume_shares+r.excluded_unobserved_trade_volume_shares,r.raw_received_trade_volume_shares);assert.equal(JSON.stringify([events,ticks]),before);return r;}
function exactPeriods(){const e=[boundary('stats_start',1800,'morning'),boundary('stats_resume',12600,'afternoon')];for(let s=1830;s<=3600;s+=30)e.push(pulse(s,{segment:'morning'}));e.push(boundary('stats_pause',3600,'morning'));for(let s=12630;s<=16200;s+=30)e.push(pulse(s,{segment:'afternoon'}));e.push(response(16200,{extra:{segment_id:'afternoon'}}),boundary('stats_pause',16200,'afternoon'));return e;}
test('用户10:00—10:30、13:00—14:00并集：只累计两段，接口全日历史空档原始量保留不入分母',()=>{
 const e=exactPeriods(),ts=[tick(1799,100,{recv:16200,id:'before'}),tick(1800,100,{recv:16200,id:'start'}),tick(2000,200,{recv:16200,id:'am'}),tick(3600,300,{recv:16200,id:'am-end'}),tick(3601,400,{recv:16200,id:'gap-a'}),tick(9000,500,{recv:16200,id:'lunch'}),tick(12599,600,{recv:16200,id:'gap-b'}),tick(12600,700,{recv:16200,id:'pm-start'}),tick(14000,800,{recv:16200,id:'pm'}),tick(16200,900,{recv:16200,id:'pm-end'}),tick(16201,1000,{recv:16202,id:'after'})],r=audited(e,ts);
 assert.deepEqual(plain(r.observation.periods.map(p=>[p.start,p.end])),[[base+1800000,base+3600000],[base+12600000,base+16200000]]);assert.equal(r.source_trade_volume_shares,3000);assert.equal(r.denominator_trade_shares,3000);assert.equal(r.raw_received_trade_volume_shares,5600);assert.equal(r.excluded_unobserved_trade_volume_shares,2600);assert.deepEqual(plain(r.trade_decisions.map(d=>d.id)),['start','am','am-end','pm-start','pm','pm-end']);assert.equal(r.timeline.at(-1).bid.denominator_trade_shares,3000);assert.equal(r.timeline.at(-1).ask.denominator_trade_shares,3000);
});
test('观察段内即使无有效五档也统计共同成交；不按净委托资格缩分母',()=>{
 const e=[observationStart(0),pulse(1),response(2)],r=audited(e,[tick(.5,70000,{recv:2})]);assert.equal(r.source_trade_volume_shares,70000);assert.equal(r.eligible_trade_volume_shares,0);assert.equal(r.denominator_trade_shares,70000);assert.equal(r.windows[0].bid.added_shares,null);assert.equal(r.forced_direction_shares,70000);
});
test('晚到段内成交回补、空档成交不制造观察范围；cutoff不使用后来响应扩展过去',()=>{
 const e=[boundary('stats_start',0,'a'),pulse(1,{segment:'a'}),boundary('stats_pause',2,'a'),boundary('stats_resume',10,'b'),pulse(11,{segment:'b'}),response(12,{extra:{segment_id:'b'}})],ts=[tick(.5,100,{recv:12,id:'inside-late'}),tick(5,900,{recv:12,id:'outside-late'}),tick(10.5,200,{recv:12,id:'b'})],h=audited(e,ts,session,base+11000),r=audited(e,ts);assert.equal(h.source_trade_volume_shares,0);assert.equal(r.source_trade_volume_shares,300);assert.equal(r.excluded_unobserved_trade_volume_shares,900);assert.equal(r.trade_decisions[1].continuity_reset,'observation_period_changed');assert.ok(r.observation.trade_ranges.every(([a,b])=>r.observation.periods.some(p=>a>=p.start&&b<=p.end)));
});
test('恢复响应只证明恢复后的观察，不把恢复前历史成交纳入',()=>{
 const e=[boundary('stats_start',0,'a'),pulse(1,{segment:'a'}),boundary('stats_pause',2,'a'),boundary('stats_resume',10,'b'),response(11,{extra:{segment_id:'b'}})],r=audited(e,[tick(5,1000,{recv:11,id:'between'}),tick(10.5,100,{recv:11,id:'current'})]);assert.equal(r.source_trade_volume_shares,100);assert.equal(r.excluded_unobserved_trade_volume_shares,1000);assert.equal(r.trade_decisions[0].id,'current');assert.equal(r.trade_decisions[0].previous_trade_id,null);
});
test('长失联无心跳时保守断开；后来成功全日响应不能补造失联观察',()=>{
 const e=[observationStart(0),depth(1),depth(100),response(101)],r=audited(e,[tick(.5,100,{recv:101,id:'first'}),tick(50,900,{recv:101,id:'offline'}),tick(100.5,200,{recv:101,id:'back'})]);assert.equal(r.source_trade_volume_shares,300);assert.equal(r.excluded_unobserved_trade_volume_shares,900);assert.equal(r.observation.periods.length,2);assert.equal(r.matched_intervals_count,0);
});
test('观察心跳维持用户持续采集范围；低频十档不影响段内分母',()=>{
 const e=[observationStart(0),depth(1),...Array.from({length:9},(_,i)=>pulse(10+i*10)),depth(100),response(101)],r=audited(e,[tick(50,500,{recv:101})]);assert.equal(r.observation.periods.length,1);assert.equal(r.source_trade_volume_shares,500);assert.equal(r.excluded_unobserved_trade_volume_shares,0);assert.equal(r.eligible_trade_volume_shares,0);
});
test('没任何观察证据的原始成交仍保留诊断但派生总量为0，不从成交本身造观察段',()=>{
 const r=audited([],[tick(1,70000,{recv:2})]);assert.equal(r.source_trade_volume_shares,0);assert.equal(r.raw_received_trade_volume_shares,70000);assert.equal(r.excluded_unobserved_trade_volume_shares,70000);assert.equal(r.trade_decisions.length,0);assert.equal(r.observation.periods.length,0);
});
test('重叠/紧邻边界同笔不重复计量，重复响应与乱序纯函数',()=>{
 const e=[observationStart(0),pulse(1),boundary('stats_pause',2,'continuous'),boundary('stats_resume',2,'continuous'),response(3)],t=tick(2,100,{recv:3}),r=audited(e,[t,{...t}]);assert.equal(r.source_trade_volume_shares,100);assert.equal(r.trade_decisions.length,1);assert.deepEqual(plain(Calc.calculate([...e].reverse(),[t],session)),plain(r));
});
test('今日派生比率重置截观察段，不删早先原始、不扩大空档',()=>{
 const e=[observationStart(0),pulse(1),boundary('stats_pause',2,'continuous'),boundary('stats_resume',10,'continuous'),response(12)],ts=[tick(.5,100,{recv:12}),tick(5,900,{recv:12}),tick(10.5,200,{recv:12})],r=audited(e,ts,{...session,started_at:iso(1)});assert.equal(r.source_trade_volume_shares,200);assert.equal(r.excluded_unobserved_trade_volume_shares,900);assert.deepEqual(plain(r.observation.periods.map(p=>[p.start,p.end])),[[base+1000,base+2000],[base+10000,base+12000]]);
});
test('独立审计检出观察范围、空档排除量/ID和共同分母篡改',()=>{
 const e=[observationStart(0),pulse(1),boundary('stats_pause',2,'continuous'),boundary('stats_resume',10,'continuous'),response(12)],ts=[tick(.5,100,{recv:12,id:'a'}),tick(5,900,{recv:12,id:'gap'}),tick(10.5,200,{recv:12,id:'b'})],r=audited(e,ts);for(const edit of [x=>x.observation.periods[0].end=base+9000,x=>x.excluded_unobserved_trade_volume_shares=0,x=>x.excluded_unobserved_trade_ids=[],x=>x.denominator_mode='all_received_trades_same_scope',x=>x.denominator_trade_shares=1200]){const x=plain(r);edit(x);assert.equal(Audit.calculate(e,ts,session,x).global_quantity_check,'mismatch');}
});
function hover(h,second){const svg=h.w.document.querySelectorAll('.book-wave-cell svg')[3];svg.getBoundingClientRect=()=>({left:0,top:0,width:400,height:240});h.w.document.querySelector('.book-wave-grid').getBoundingClientRect=()=>({left:0,top:0});const e=new h.w.Event('pointermove');Object.assign(e,{pointerType:'mouse',clientX:second/14400*400});svg.dispatchEvent(e);return h.w.document.querySelector('.book-wave-tip').textContent;}
test('实际暂停/恢复集成：后到全天响应不污染空档，原始JSON全保留，图表hover明确空档不入共同量',async()=>{
 const h=await harness();try{await h.capture('depth',1);await h.capture('ticks',2,{records:[{time:(base+500)/1000,price:10,volume:100}]});h.setNow(3);h.api.bookRecorder.setPaused(true);await h.drain();h.setNow(10);h.api.bookRecorder.setPaused(false);await h.api.bookRecorder.begin('600036');await h.drain();await h.capture('depth',11);await h.capture('ticks',12,{records:[{time:(base+500)/1000,price:10,volume:100},{time:(base+5000)/1000,price:10.01,volume:900},{time:(base+10500)/1000,price:10.01,volume:200}]});
 await h.api.bookRecorder.exportData('json');const d=JSON.parse(h.w.__export.text);assert.equal(d.statistics.source_trade_volume_shares,300);assert.equal(d.statistics.denominator_trade_shares,300);assert.equal(d.statistics.excluded_unobserved_trade_volume_shares,900);assert.equal(d.ticks.length,3);assert.ok(d.events.some(e=>e.kind==='stats_pause'&&e.scope_only));assert.match(h.text('bookFlowVolume'),/共同成交分母：3 手/);assert.equal(h.w.__bookWaveData.trades.reduce((v,t)=>v+t.volume,0),300);assert.match(hover(h,5),/未在实际观察时段内/);assert.doesNotMatch(hover(h,5),/共同成交 9 手/);
 const saved=JSON.stringify(d.ticks);await h.api.bookRecorder.exportData('json');assert.equal(JSON.stringify(JSON.parse(h.w.__export.text).ticks),saved);
 }finally{h.close();}
});
