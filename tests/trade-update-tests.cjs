'use strict';
// v12 acceptance: binary estimates with explicit evidence, per-price queues and common full denominator.
const test=require('node:test'),assert=require('node:assert/strict');
const {Calc,Audit,iso,session,depth,response,tick,calculate,plain}=require('./helpers.cjs');
const pair=(r)=>r.windows.find(w=>w.window_kind==='adjacent_snapshot');

test('相邻快照独立成窗；未收成交时立即显示可见变化，估算不是0',()=>{
 const r=calculate([depth(0),depth(1,{volumes:{'bid:10':105000}})]),w=pair(r);
 assert.equal(r.version,12);assert.equal(r.windows.length,1);assert.equal(w.bid.visible_added_shares,5000);assert.equal(w.bid.added_shares,null);assert.equal(w.bid.net_change_shares,null);assert.equal(w.trade_coverage,'awaiting_trade_response');assert.equal(r.pending_intervals,1);
});
test('买盘1000→600手，期间卖出700手：净补单300手，恒等式成立',()=>{
 const r=calculate([depth(0),depth(1,{volumes:{'bid:10':60000}}),response(2)],[tick(.5,70000,{recv:2})]),w=pair(r);
 assert.equal(w.bid.added_shares,30000);assert.equal(w.bid.cancellation_shares,0);assert.equal(w.bid.net_change_shares,30000);assert.equal(w.active_sell_shares,70000);assert.equal(w.ambiguous_trade_shares,0);assert.equal(w.bid.denominator_trade_shares,70000);assert.equal(w.bid.addition_rate_pct,30000/70000*100);
});
test('两个相邻区间分别计算净委托，不把多次正负端点合为毛新增',()=>{
 const r=calculate([depth(0,{volumes:{'bid:10':100}}),depth(1,{volumes:{'bid:10':110}}),depth(2,{volumes:{'bid:10':102}}),response(3)],[tick(1.5,5,{recv:3})]);
 assert.equal(r.windows.length,2);assert.equal(r.windows[0].bid.added_shares,10);assert.equal(r.windows[1].bid.cancellation_shares,3);assert.equal(r.timeline.at(-1).bid.net_change_shares,7);
});
test('成功空响应覆盖同价变化：净撤回可估算，分母0不除零',()=>{
 const r=calculate([depth(0,{volumes:{'bid:10':100}}),depth(1,{volumes:{'bid:10':92}}),response(2)]),w=pair(r);
 assert.equal(w.bid.cancellation_shares,8);assert.equal(w.bid.net_change_shares,-8);assert.equal(w.bid.addition_rate_pct,null);assert.equal(w.source_complete,false);
});
test('无盘口首笔仍二元归类，但必须披露无依据初始化，全部成交作共同分母',()=>{
 const r=calculate([], [tick(1,70000,{recv:2})]);assert.equal(r.active_sell_shares,0);assert.equal(r.active_buy_shares,70000);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.forced_direction_shares,70000);assert.equal(r.low_confidence_trade_shares,70000);assert.equal(r.trade_decisions[0].reason,'initialization_buy_no_direction_evidence');assert.equal(r.trade_decisions[0].confidence,'very_low');assert.equal(r.eligible_trade_volume_shares,0);assert.equal(r.windows[0].bid.denominator_trade_shares,70000);assert.equal(r.windows[0].bid.added_shares,null);
});
test('同价位买侧变卖侧，后续成交只使用其之前的最新快照',()=>{
 const r=calculate([depth(0),depth(1,{bid:9.99,ask:10}),depth(2,{bid:10.01,ask:10.02}),response(3)],[tick(.5,100,{recv:3,id:'early'}),tick(1.5,70000,{recv:3,id:'later'})]);
 assert.equal(r.active_sell_shares,100);assert.equal(r.active_buy_shares,70000);assert.equal(r.trade_decisions.find(x=>x.id==='later').side,'ask');
});
test('五档外向上扫单用成交前卖一推断，不用未来新买一反向归侧',()=>{
 const r=calculate([depth(0),depth(1,{bid:10.06,ask:10.07}),response(2)],[tick(.5,70000,{price:10.06,recv:2})]);
 assert.equal(r.active_sell_shares,0);assert.equal(r.active_buy_shares,70000);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.trade_decisions[0].reason,'pretrade_upward_sweep_beyond_five');assert.equal(r.trade_decisions[0].quote_at,iso(0));assert.equal(pair(r).included_in_cumulative,true);
});
test('价位移出五档且有1手成交，不伪造999手撤单',()=>{
 const r=calculate([depth(0),depth(1,{bid:10.05,ask:10.06}),response(2)],[tick(.5,100,{recv:2})]),z=pair(r).levels.find(z=>z.side==='bid'&&z.price===10);
 assert.equal(z.after_shares,null);assert.equal(z.delta_shares,null);assert.equal(z.statistics_eligible,false);assert.equal(z.cancellation_shares,null);assert.notEqual(pair(r).bid.cancellation_shares,99900);assert.equal(pair(r).bid.denominator_trade_shares,100);
});
test('按同价而非同档：可证归零的原买一计净撤，尾档外新买五不造新增',()=>{
 const r=calculate([depth(0),depth(1,{bid:9.99,ask:10.01,volumes:{'bid:9.99':100700}}),response(2)]),w=pair(r);
 assert.equal(w.bid.added_shares,700);assert.equal(w.bid.cancellation_shares,100000);assert.ok(r.visibility_changes.some(x=>x.visibility_state==='entered_five'&&!x.statistics_eligible));const oldBest=w.levels.find(z=>z.side==='bid'&&z.price===10);assert.equal(oldBest.after_basis,'proven_zero');assert.equal(oldBest.after_shares,0);assert.equal(oldBest.statistics_eligible,true);
});
test('迟到成交回补原始成交区间，不新建收到时间窗口',()=>{
 const e=[depth(0),depth(1,{volumes:{'bid:10':99000}}),depth(2),response(3)],t=tick(.5,500,{recv:3});const r=calculate(e,[t]);
 assert.equal(r.windows.length,2);assert.equal(r.windows[0].source_trade_volume_shares,500);assert.equal(r.windows[1].source_trade_volume_shares,0);assert.equal(r.trade_decisions[0].trade_time,iso(.5));assert.equal(r.trade_decisions[0].received_at,iso(3));
});
test('交易恰在前帧时刻不使用同时快照反推；端点只归一窗',()=>{
 const r=calculate([depth(0),depth(1),depth(2),response(3)],[tick(0,100,{recv:3,id:'same'}),tick(1,200,{recv:3,id:'end'})]);
 assert.equal(r.source_trade_volume_shares,300);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.forced_direction_shares,100);assert.equal(r.trade_decisions.find(x=>x.id==='same').quote_at,null);assert.equal(r.trade_decisions.filter(x=>x.id==='end').length,1);assert.equal(pair(r).source_trade_volume_shares,200);
});
test('盘口超过5秒未更新仍输出二元估计，陈旧报价依据降级而非当精确方向',()=>{
 const r=calculate([depth(0),depth(10,{limit:45000}),response(11)],[tick(8,1000,{recv:11})]);
 assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.active_sell_shares,1000);assert.equal(r.trade_decisions[0].reason,'stale_quote_midpoint');assert.equal(r.trade_decisions[0].confidence,'very_low');assert.equal(r.low_confidence_trade_shares,1000);assert.equal(pair(r).bid.net_change_shares,1000);
});
test('明确响应源抓取时间早于后帧，不能当作覆盖后帧成交',()=>{
 const r=calculate([depth(0),depth(2,{volumes:{'bid:10':90000}}),response(3,{metadata:{fetched_at:iso(1)}})]);
 assert.equal(pair(r).window_open,true);assert.equal(pair(r).bid.cancellation_shares,null);
});
test('重复记录与重复响应幂等，乱序输入结果一致',()=>{
 const e=[depth(0),depth(1),response(2)],t=tick(.5,500,{recv:2});const a=calculate(e,[t]);const b=calculate([e[2],e[1],e[0],response(3)],[t,{...t}]);
 assert.equal(b.source_trade_volume_shares,500);assert.equal(b.windows.length,1);assert.equal(b.timeline.at(-1).bid.net_change_shares,a.timeline.at(-1).bid.net_change_shares);assert.deepEqual(plain(calculate([...e].reverse(),[t])),plain(a));
});
test('历史cutoff不泄漏后来收到的成交，也不改写输入原始对象',()=>{
 const e=[depth(0),depth(1),response(3)],t=[tick(.5,500,{recv:3})],before=JSON.stringify([e,t]);const historical=calculate(e,t,Date.parse(iso(2)));
 assert.equal(historical.source_trade_volume_shares,0);assert.equal(pair(historical).bid.added_shares,null);assert.equal(calculate(e,t).source_trade_volume_shares,500);assert.equal(JSON.stringify([e,t]),before);
});
test('有缺口成交仍入共同全量分母；队列补偿覆盖诊断独立',()=>{
 const r=calculate([depth(0),depth(1),depth(10,{extra:{gap_warning:true}}),depth(11),response(12)],[tick(.5,100,{recv:12,id:'valid'}),tick(8,900,{recv:12,id:'gap'})]);
 assert.equal(r.source_trade_volume_shares,1000);assert.equal(r.eligible_trade_volume_shares,100);assert.equal(r.coverage_pct,10);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.active_buy_shares+r.active_sell_shares,1000);assert.equal(r.timeline.at(-1).bid.denominator_trade_shares,1000);
});
test('审计区分数量通过与覆盖不足，不伪称源完整',()=>{
 const e=[depth(0),depth(1),response(2)],t=[tick(.5,100,{recv:2})],r=calculate(e,t),a=Audit.calculate(e,t,session,r);
 assert.equal(a.global_quantity_check,'pass');assert.equal(a.windows[0].quantity_check,'pass');assert.equal(a.windows[0].status,'incomplete');assert.equal(a.windows[0].direction_check,'estimated_not_official');
});
test('删改主动总量、净委托、累计或价位明细均被审计发现',()=>{
 const e=[depth(0),depth(1,{volumes:{'bid:10':99000}}),response(2)],t=[tick(.5,500,{recv:2})],r=calculate(e,t);
 for(const mutate of [x=>{x.windows[0].active_sell_shares=0;},x=>{x.windows[0].bid.added_shares=123;},x=>{x.timeline[0].bid.net_change_shares=123;x.timeline[0].bid.added_shares=123;},x=>{x.windows[0].levels[0].delta_shares++;}]){const altered=plain(r);mutate(altered);assert.equal(Audit.calculate(e,t,session,altered).windows[0].status,'mismatch');}
});
test('无盘口全量成交不能审计为覆盖充分',()=>{
 const t=[tick(1,70000,{recv:2})],r=calculate([],t),a=Audit.calculate([],t,session,r);
 assert.equal(a.global_quantity_check,'pass');assert.equal(a.windows[0].status,'incomplete');assert.equal(a.windows[0].coverage_check,'partial');
});
test('正式完整响应仍明确方向仅为报价估计',()=>{
 const e=[depth(0),depth(1),response(2,{complete:true})],t=[tick(.5,100,{recv:2})],r=calculate(e,t),a=Audit.calculate(e,t,session,r);
 assert.equal(a.windows[0].status,'pass');assert.equal(a.windows[0].direction_check,'estimated_not_official');
});
