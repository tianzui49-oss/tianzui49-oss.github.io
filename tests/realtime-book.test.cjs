'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Audit,iso,session,depth,response,tick,calculate,plain}=require('./helpers.cjs');

test('短于三秒也逐帧成窗，不等待固定桶或收到成交才显示',()=>{
 const r=calculate([depth(0),depth(.2,{volumes:{'bid:10':100100}}),depth(.6,{volumes:{'bid:10':100300}})]);
 assert.equal(r.windows.length,2);assert.equal(r.windows[0].bid.visible_added_shares,100);assert.equal(r.windows[1].bid.visible_added_shares,200);assert.equal(r.timeline.at(-1).bid.visible_added_shares,300);assert.equal(r.timeline.at(-1).bid.added_shares,null);
});
test('迟到成交使旧区间和后续累计一起更新，无重复归属',()=>{
 const e=[depth(0),depth(1),depth(2),response(4)],a=tick(.5,100,{recv:3,id:'first'}),b=tick(.7,200,{recv:4,id:'late'});
 const before=calculate(e,[a]),after=calculate(e,[a,b]);assert.equal(before.windows[0].source_trade_volume_shares,100);assert.equal(after.windows[0].source_trade_volume_shares,300);assert.equal(after.timeline.at(-1).source_trade_volume_shares,300);assert.equal(after.timeline.at(-1).active_sell_shares,300);
});
test('队列缺口/无效帧不缩小观察分母，跨采集段与午休空档不补造观察',()=>{
 for(const variant of ['gap','invalid','segment']){
  const a=depth(0),b=depth(1);if(variant==='gap')b.gap_warning=true;if(variant==='invalid')b.payload.rows[0].volume=-1;if(variant==='segment')b.segment_id='other';
  const r=calculate([a,b,response(2)],[tick(.5,100,{recv:2})]);const expected=variant==='segment'?0:100;assert.equal(r.matched_intervals_count,variant==='invalid'?1:0);assert.equal(r.source_trade_volume_shares,expected);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.active_buy_shares+r.active_sell_shares,expected);assert.equal(r.denominator_trade_shares,expected);assert.equal(r.eligible_trade_volume_shares,0);if(variant==='invalid')assert.equal(r.windows.find(w=>w.sample_pairs).bid.added_shares,null);if(variant==='segment')assert.equal(r.excluded_unobserved_trade_volume_shares,100);
 }
 const r=calculate([depth(7199),depth(12601,{limit:45000}),response(12602)],[tick(12600,100,{recv:12602})]);assert.equal(r.matched_intervals_count,0);
});
test('五档内相同价格即使档位变化也计算挂量差',()=>{
 const a=depth(0),b=depth(1,{bid:10.01,ask:10.02,volumes:{'bid:10':100700}}),r=calculate([a,b,response(2)]);
 const z=r.windows[0].levels.find(x=>x.side==='bid'&&x.price===10);assert.equal(z.before_level,1);assert.equal(z.after_level,2);assert.equal(z.net_change_shares,700);
});
test('乱序成交不改变窗口结果，重复calculate是纯函数',()=>{
 const e=[depth(0),depth(1),depth(2),response(3)],ts=[tick(.8,100,{recv:3,id:'b'}),tick(.3,200,{recv:3,id:'a'})];
 assert.deepEqual(plain(calculate(e,ts)),plain(calculate([...e].reverse(),[...ts].reverse())));assert.deepEqual(plain(calculate(e,ts)),plain(calculate(e,ts)));
});
test('非法盘口价格顺序和null数量不会被当成有效0',()=>{
 const a=depth(0),b=depth(1);b.payload.rows[0].volume=null;const r=calculate([a,b]);assert.equal(r.matched_intervals_count,1);assert.equal(r.windows[0].bid.added_shares,null);assert.equal(r.windows[0].levels.find(z=>z.side==='bid'&&z.price===10).after_shares,null);
 const c=depth(1);[c.payload.rows[0].price,c.payload.rows[1].price]=[c.payload.rows[1].price,c.payload.rows[0].price];const rr=calculate([a,c]);assert.equal(rr.matched_intervals_count,1);assert.equal(rr.windows[0].levels.find(z=>z.side==='bid'&&z.price===10).after_shares,null);
});
test('原始变化行被篡改时，独立审计检出，不只核对自己输出',()=>{
 const e=[depth(0),depth(1,{volumes:{'bid:10':100100}}),response(2)];e[1].changes=[{side:'bid',price:10,delta_shares:999}];const r=calculate(e),a=Audit.calculate(e,[],session,r);assert.equal(a.windows[0].status,'mismatch');
});
test('零数量成交有记录但不生成除零比率；负数成交排除',()=>{
 const e=[depth(0),depth(1),response(2)],r=calculate(e,[tick(.5,0,{recv:2}),tick(.7,-100,{recv:2})]);assert.equal(r.source_trade_volume_shares,0);assert.equal(r.windows[0].source_trade_rows,1);assert.equal(r.windows[0].bid.addition_rate_pct,null);
});
test('14位北京时间成交与秒级成交共享实际时间归属',()=>{
 const t=tick(.5,100,{recv:2});t.row.time='20261117093000';const r=calculate([depth(0),depth(1),response(2)],[t]);assert.equal(r.source_trade_volume_shares,100);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.forced_direction_shares,100);assert.equal(r.trade_decisions[0].trade_time,iso(0));assert.equal(Audit.calculate([depth(0),depth(1),response(2)],[t],session,r).global_quantity_check,'pass');
});
