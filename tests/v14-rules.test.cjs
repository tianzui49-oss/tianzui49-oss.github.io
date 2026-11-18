'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Calc,Audit,base,iso,session,depth,response,tick,calculate,plain,observationStart,pulse}=require('./helpers.cjs');
const {harness}=require('./ui-harness.cjs');
function audited(e,t=[],s=session,cutoff=Infinity){const raw=JSON.stringify([e,t]),r=Calc.calculate(e,t,s,cutoff),a=Audit.calculate(e,t,s,r);assert.equal(r.version,14);assert.equal(a.global_quantity_check,'pass');assert.ok(a.windows.every(w=>w.status!=='mismatch'),JSON.stringify(a.windows.filter(w=>w.status==='mismatch')));assert.equal(r.active_buy_shares+r.active_sell_shares,r.source_trade_volume_shares);assert.equal(r.ambiguous_trade_shares,0);assert.equal(r.source_trade_volume_shares+r.excluded_unobserved_trade_volume_shares,r.raw_received_trade_volume_shares);assert.equal(JSON.stringify([e,t]),raw);return r;}
function changingBook(at,direction,price){return direction==='buy'?depth(at,{bid:Number((price-.10).toFixed(2)),ask:price}):depth(at,{bid:price,ask:Number((price+.10).toFixed(2))});}
function namedTick(at,volume,id,price,recv=2,fields={}){return tick(at,volume,{id,price,recv,extra:{row:{time:(base+at*1000)/1000,price,volume,...fields}}});}
function queue(r,side,price){return r.windows.find(w=>w.sample_pairs).levels.find(z=>z.side===side&&Math.abs(z.price-price)<1e-8);}

// Full 4-direction-pair x 3-price-relation matrix: timely observed best price is the rule evidence.
for(const first of ['buy','sell'])for(const second of ['buy','sell'])for(const delta of [-.01,0,.01]){
 test(`12类：${first}→${second}，价格${delta<0?'跌':delta>0?'涨':'同价'}，新最优价纠正而非机械tick`,()=>{
  const p=10.02,p2=Number((p+delta).toFixed(2)),e=[changingBook(0,first,p),changingBook(.3,second,p2),changingBook(1,second,p2),response(2)],ts=[namedTick(.2,1000,'first',p),namedTick(.5,1000,'second',p2)],r=audited(e,ts),d=r.trade_decisions[1];
  assert.deepEqual(plain(r.trade_decisions.map(d=>d.active_direction)),[first,second]);assert.equal(d.quote_direction,second);assert.equal(d.quote_evidence_kind,'exact_best');assert.equal(d.quote_authoritative_for_rule,true);assert.equal(d.quote_updated_since_previous,true);
  if(d.tick_direction!==second){assert.equal(d.fusion_status,'timely_best_quote_overrides_tick');assert.equal(d.reason,delta===0?'same_price_new_best_quote_switch':'new_best_quote_corrects_tick');}else assert.equal(d.fusion_status,'agreement');
 });
}
test('旧盘口不能覆盖7笔混合路径：买买买卖卖买买，方向有依据且逐价补偿守恒',()=>{
 const prices=[8.7,8.8,8.9,8.7,8.7,8.8,8.8],e=[depth(0,{bid:8.69,ask:8.70}),depth(1,{bid:8.69,ask:8.70}),response(2)],r=audited(e,prices.map((p,i)=>namedTick((i+1)/10,100,'m'+i,p)));assert.deepEqual(plain(r.trade_decisions.map(d=>d.active_direction)),['buy','buy','buy','sell','sell','buy','buy']);assert.equal(r.active_buy_shares,500);assert.equal(r.active_sell_shares,200);assert.equal(r.trade_decisions[3].quote_authoritative_for_rule,false);
});
test('价差内两笔成交不冒充盘口确认，中点仅初始化，下一笔按tick低依据',()=>{
 const e=[depth(0,{bid:10,ask:10.03}),depth(1,{bid:10,ask:10.03}),response(2)],r=audited(e,[namedTick(.2,100,'a',10.02),namedTick(.4,100,'b',10.01)]);assert.deepEqual(plain(r.trade_decisions.map(d=>d.active_direction)),['buy','sell']);for(const d of r.trade_decisions){assert.equal(d.quote_direction,null);assert.equal(d.quote_evidence_kind,'inside_previous_spread');assert.equal(d.quote_authoritative_for_rule,false);assert.equal(d.confidence,'low');}assert.equal(r.trade_decisions[0].reason,'spread_midpoint_initialization_only');assert.equal(r.trade_decisions[1].reason,'downtick');
});
test('价差内新卖单：新卖一10.02→10.01都买入，旧盘口中点不反向',()=>{
 const e=[depth(0,{bid:10,ask:10.03}),changingBook(.1,'buy',10.02),changingBook(.3,'buy',10.01),changingBook(1,'buy',10.01),response(2)],r=audited(e,[namedTick(.2,5000,'a',10.02),namedTick(.4,5000,'b',10.01)]);assert.equal(r.active_buy_shares,10000);assert.equal(r.active_sell_shares,0);assert.equal(r.trade_decisions[1].reason,'new_best_quote_corrects_tick');
});
test('原买一100手→新卖一50手，原价卖出80手只撤20，新卖另外补50',()=>{
 const e=[depth(0,{bid:10,ask:10.01,volumes:{'bid:10':10000,'bid:9.99':3000,'ask:10.01':3000}}),depth(1,{bid:9.99,ask:10,volumes:{'bid:9.99':3000,'ask:10':5000,'ask:10.01':3000}}),response(2)],r=audited(e,[namedTick(.5,8000,'sell',10)]);const old=queue(r,'bid',10),newSell=queue(r,'ask',10);assert.equal(old.after_shares,0);assert.equal(old.cancellation_shares,2000);assert.equal(old.added_shares,0);assert.equal(newSell.before_shares,0);assert.equal(newSell.added_shares,5000);assert.equal(newSell.executed_shares,0);assert.equal(r.denominator_trade_shares,8000);
});
test('新盘口同价卖转买：双方队列分开补偿，新卖净补70而非50',()=>{
 const e=[depth(0,{bid:10,ask:10.01,volumes:{'bid:10':10000}}),depth(.3,{bid:9.99,ask:10,volumes:{'ask:10':7000}}),depth(1,{bid:9.99,ask:10,volumes:{'ask:10':5000}}),response(2)],ts=[namedTick(.2,8000,'sell',10),namedTick(.5,2000,'buy',10)],r=audited(e,ts);assert.deepEqual(plain(r.trade_decisions.map(d=>d.active_direction)),['sell','buy']);assert.equal(r.active_buy_shares,2000);assert.equal(r.active_sell_shares,8000);assert.equal(r.denominator_trade_shares,10000);assert.equal(r.windows[0].levels.find(z=>z.side==='bid'&&z.price===10).cancellation_shares,2000);assert.equal(r.timeline.at(-1).ask.added_shares,7000);
});
test('原买1000手后100手、成交700手：净撤200，不是600',()=>{const r=audited([depth(0,{volumes:{'bid:10':100000}}),depth(1,{volumes:{'bid:10':10000}}),response(2)],[namedTick(.5,70000,'s',10)]);assert.equal(queue(r,'bid',10).cancellation_shares,20000);assert.equal(queue(r,'bid',10).net_change_shares,-20000);});
for(const side of ['bid','ask'])for(let level=1;level<=5;level++){
 test(`${side}第${level}档没有成交：同价增加50或减少20均统计，不因换档遗漏`,()=>{
  const price=Number((side==='bid'?10-(level-1)*.01:10.01+(level-1)*.01).toFixed(2)),k=side+':'+price;
  for(const [after,expected]of [[15000,5000],[8000,-2000]]){const r=audited([depth(0,{volumes:{[k]:10000}}),depth(1,{volumes:{[k]:after}}),response(2)]),z=queue(r,side,price);assert.equal(z.executed_shares,0);assert.equal(z.net_change_shares,expected);assert.equal(z.added_shares,Math.max(0,expected));assert.equal(z.cancellation_shares,Math.max(0,-expected));assert.equal(z.addition_rate_pct,null);}
 });
}
function bookRows(at,side,prices,quantities={},opposite){const e=depth(at,opposite||{});e.payload.rows=e.payload.rows.filter(r=>r.side!==side).concat(prices.map((price,i)=>({side,level:i+1,price,volume:quantities[price]??3000})));return e;}
for(const side of ['bid','ask']){
 test(`${side}价差内新最优挂单从可证0计算新增，旧价移档数量没变不撤`,()=>{
  const e=[depth(0,{bid:10,ask:10.03,volumes:{'ask:10.03':3000,'bid:10':3000}}),depth(1,{bid:side==='bid'?10.02:10,ask:side==='ask'?10.01:10.03,volumes:{[side+':'+(side==='bid'?10.02:10.01)]:5000,'ask:10.03':3000,'bid:10':3000}}),response(2)],r=audited(e),z=queue(r,side,side==='bid'?10.02:10.01);assert.equal(z.before_shares,0);assert.equal(z.before_basis,'proven_zero');assert.equal(z.added_shares,5000);assert.equal(queue(r,side,side==='bid'?10:10.03).net_change_shares,0);
 });
 test(`${side}五档内部空白价位新出现要补，挤出旧尾档不能算撤`,()=>{
  const prices=side==='ask'?[10.03,10.05,10.06,10.08,10.09]:[10,9.98,9.97,9.95,9.94],newPrice=side==='ask'?10.04:9.99,newPrices=[prices[0],newPrice,...prices.slice(1,4)],e=[bookRows(0,side,prices),bookRows(1,side,newPrices,{[newPrice]:5000}),response(2)],r=audited(e);assert.equal(queue(r,side,newPrice).before_shares,0);assert.equal(queue(r,side,newPrice).added_shares,5000);assert.equal(queue(r,side,prices[4]).after_shares,null);assert.equal(queue(r,side,prices[4]).cancellation_shares,null);
 });
 test(`${side}新出现尾档原量在五档外：不能把后50手全部记新增`,()=>{
  const e=[depth(0),depth(1,side==='ask'?{bid:10,ask:10.02,volumes:{'ask:10.06':5000}}:{bid:9.99,ask:10.01,volumes:{'bid:9.95':5000}}),response(2)],price=side==='ask'?10.06:9.95,r=audited(e),z=queue(r,side,price);assert.equal(z.before_shares,null);assert.equal(z.added_shares,null);
 });
}
test('价差内新卖单期间成交80、期末20：净补100，成交分母80不把挂单算成交',()=>{
 const e=[depth(0,{bid:10,ask:10.03}),depth(1,{bid:10,ask:10.01,volumes:{'ask:10.01':2000}}),response(2)],r=audited(e,[namedTick(.5,8000,'buy',10.01,2,{active_direction:'buy'})]),z=queue(r,'ask',10.01);assert.equal(z.before_shares,0);assert.equal(z.after_shares,2000);assert.equal(z.executed_shares,8000);assert.equal(z.added_shares,10000);assert.equal(r.denominator_trade_shares,8000);
});
for(const side of ['ask','bid'])for(const count of [1,3,4,5,6,10,20]){
 test(`${side}连续扫${count}档：逐价成交补偿，前可见价位不产生假撤单`,()=>{
  const buy=side==='ask',a=depth(0),b=depth(1,{bid:buy?10:Number((10-count*.01).toFixed(2)),ask:buy?Number((10.01+count*.01).toFixed(2)):10.01});for(const e of [a,b])for(const row of e.payload.rows)row.volume=10000;
  const ts=Array.from({length:count},(_,i)=>namedTick((i+1)/(count+1),10000,side+'-'+i,Number((buy?10.01+i*.01:10-i*.01).toFixed(2)))),r=audited([a,b,response(2)],ts);assert.equal(buy?r.active_buy_shares:r.active_sell_shares,count*10000);assert.equal(buy?r.active_sell_shares:r.active_buy_shares,0);assert.equal(r.denominator_trade_shares,count*10000);
  for(let i=0;i<Math.min(5,count);i++){const z=queue(r,side,Number((buy?10.01+i*.01:10-i*.01).toFixed(2)));assert.equal(z.after_shares,0);assert.equal(z.executed_shares,10000);assert.equal(z.net_change_shares,0);assert.equal(z.cancellation_shares,0);}
 });
}
test('扫10档但原卖三100手只收到80手：净撤20，迟到20成交回补后撤0',()=>{
 const a=depth(0),b=depth(1,{bid:10,ask:10.11});for(const row of a.payload.rows)if(row.side==='ask')row.volume=10000;
 const e=[a,b,response(3)],ts=Array.from({length:10},(_,i)=>namedTick((i+1)/20,i===2?8000:10000,'p'+i,Number((10.01+i*.01).toFixed(2)))),r=audited(e,ts);assert.equal(queue(r,'ask',10.03).cancellation_shares,2000);assert.equal(r.source_trade_volume_shares,98000);
 const corrected=audited(e,[...ts,namedTick(.151,2000,'late',10.03,3)]);assert.equal(queue(corrected,'ask',10.03).cancellation_shares,0);assert.equal(corrected.source_trade_volume_shares,100000);
});
test('队列耗尽后同价不能自动换方向；新盘口重建挂量才能纠正继承',()=>{
 const a=depth(0,{volumes:{'ask:10.01':100}}),r=audited([a,depth(1),response(2)],[namedTick(.2,100,'first',10.01),namedTick(.4,100,'second',10.01)]),d=r.trade_decisions[1];assert.equal(d.active_direction,'buy');assert.equal(d.quote_queue_exhausted_before,true);assert.equal(d.quote_unconsumed_observed_quantity_shares,0);assert.equal(d.quote_authoritative_for_rule,false);assert.equal(d.confidence,'low');assert.equal(d.quote_quantity_overrun,true);
});
test('同价边吃边补超原挂量：数量守恒且依据降级，不凭空造真实补单事件',()=>{
 const e=[depth(0,{volumes:{'ask:10.01':100}}),depth(1,{volumes:{'ask:10.01':100}}),response(2)],r=audited(e,[namedTick(.2,150,'large',10.01)]);assert.equal(r.trade_decisions[0].quote_quantity_overrun,true);assert.equal(r.trade_decisions[0].confidence,'low');assert.equal(queue(r,'ask',10.01).added_shares,150);
});
test('深档前缀未由成交消耗解释时不把方向一致包装成高依据',()=>{
 const r=audited([depth(0),depth(1),response(2)],[namedTick(.2,100,'a',10.02),namedTick(.4,100,'b',10.03)]);assert.equal(r.trade_decisions[1].active_direction,'buy');assert.equal(r.trade_decisions[1].visible_sweep_prefix_consumed,false);assert.equal(r.trade_decisions[1].confidence,'low');assert.equal(r.trade_decisions[1].quote_evidence_kind,'visible_deeper');
});
test('有效部分连续档位可核实同价；缺一侧不填0，不因其错误扔掉另一侧',()=>{
 const a=depth(0),b=depth(1,{volumes:{'ask:10.01':105000}});b.payload.rows=b.payload.rows.filter(r=>r.side==='ask'&&r.level<=2);const r=audited([a,b,response(2)]);assert.equal(queue(r,'ask',10.01).added_shares,5000);assert.equal(queue(r,'bid',10).after_shares,null);assert.equal(queue(r,'bid',10).cancellation_shares,null);assert.equal(queue(r,'ask',10.05).after_shares,null);assert.equal(r.windows[0].snapshot_quality.after,'partial_observed_prefix');
});
test('部分连续盘口内部空价可证0但超可见前缀不能证0',()=>{
 const a=bookRows(0,'ask',[10.01,10.03,10.05,10.07,10.09]),b=bookRows(1,'ask',[10.01,10.02],{'10.02':5000}),r=audited([a,b,response(2)]);assert.equal(queue(r,'ask',10.02).before_shares,0);assert.equal(queue(r,'ask',10.02).added_shares,5000);assert.equal(queue(r,'ask',10.05).after_shares,null);assert.equal(queue(r,'ask',10.05).after_basis,'outside_observed_prefix');
});
test('缺失或非法买一不能把买二冒充买一；卖侧仍可核实',()=>{
 for(const corrupt of ['missing','null','negative','duplicate','unordered']){const a=depth(0),b=depth(1,{volumes:{'ask:10.01':101000}});if(corrupt==='missing')b.payload.rows=b.payload.rows.filter(r=>!(r.side==='bid'&&r.level===1));if(corrupt==='null')b.payload.rows[0].volume=null;if(corrupt==='negative')b.payload.rows[0].volume=-1;if(corrupt==='duplicate')b.payload.rows.push({...b.payload.rows[0]});if(corrupt==='unordered')[b.payload.rows[0].price,b.payload.rows[1].price]=[b.payload.rows[1].price,b.payload.rows[0].price];const r=audited([a,b,response(2)]);assert.equal(queue(r,'bid',10).after_shares,null);assert.equal(queue(r,'ask',10.01).added_shares,1000);}
});
test('矛盾交叉盘口不作有效快照，成交仍在观察范围内低依据归类',()=>{
 const bad=depth(.4,{bid:10.02,ask:10.01}),r=audited([depth(0),bad,depth(1),response(2)],[namedTick(.5,100,'a',10.01)]);assert.equal(r.matched_intervals_count,0);assert.equal(r.trade_decisions[0].quote_fresh,false);assert.equal(r.trade_decisions[0].confidence,'very_low');assert.equal(r.denominator_trade_shares,100);
});
test('0量最优行不能当可成交队列，明确后继正量才作best',()=>{
 const e=[depth(0,{volumes:{'ask:10.01':0}}),depth(1),response(2)],r=audited(e,[namedTick(.2,100,'a',10.02)]);assert.equal(r.trade_decisions[0].quote_best_ask,10.02);assert.equal(r.trade_decisions[0].quote_evidence_kind,'exact_best');assert.equal(r.trade_decisions[0].active_direction,'buy');assert.equal(r.trade_decisions[0].quote_observed_quantity_shares,100000);
});
test('同秒缺序号或重复序号：整组受影响记录降级，不只给第二笔打标记',()=>{
 for(const mode of ['missing','mixed','duplicate','unique']){const ts=[namedTick(.2,100,'a',10.01,2,['missing','mixed'].includes(mode)?{}:{transaction_count:1}),namedTick(.2,100,'b',10.02,2,mode==='missing'?{}:{transaction_count:mode==='duplicate'?1:2})],r=audited([depth(0),depth(1),response(2)],ts);for(const d of r.trade_decisions){assert.equal(d.time_order_uncertain,mode!=='unique');if(mode!=='unique')assert.equal(d.confidence,'very_low');}}
});
test('源主动字段相互矛盾不伪装明确方向，保留冲突再用盘口推断',()=>{
 const r=audited([depth(0),depth(1),response(2)],[namedTick(.2,100,'a',10.01,2,{active_direction:'buy',aggressor_side:'sell'})]),d=r.trade_decisions[0];assert.equal(d.source_direction_conflict,true);assert.equal(d.source_direction_values.length,2);assert.equal(d.source_field,null);assert.notEqual(d.fusion_status,'source_explicit');assert.equal(d.active_direction,'buy');assert.equal(d.confidence,'low');
});
test('明确源方向优先，保留与报价相反的依据，不拿订单ID硬编码',()=>{
 const r=audited([depth(0),depth(1),response(2)],[namedTick(.2,100,'a',10.01,2,{active_direction:'sell',bid_order_id:1,ask_order_id:2})]),d=r.trade_decisions[0];assert.equal(d.active_direction,'sell');assert.equal(d.source_field,'active_direction');assert.equal(d.fusion_status,'source_explicit');assert.equal(d.quote_direction,'buy');
});
test('新到达但源抓取仍旧的缓存报价，不能纠正发生在其后的逐笔反转',()=>{
 const e=[depth(0,{bid:10,ask:10.02,extra:{source_fetched_at:iso(0)}}),depth(.3,{bid:10,ask:10.01,extra:{source_fetched_at:iso(0)}}),depth(1),response(2)],r=audited(e,[namedTick(.2,100,'a',10.02),namedTick(.4,100,'b',10.01)]),d=r.trade_decisions[1];assert.equal(d.quote_updated_since_previous,false);assert.equal(d.quote_authoritative_for_rule,false);assert.equal(d.active_direction,'sell');assert.equal(d.quote_evidence_at,iso(0));
});
test('陈旧/未来不合理抓取时间明确降级，不忽略错误时间后冒充新报价',()=>{
 for(const source of [iso(-10),iso(2)]){const e=[depth(0,{extra:{source_fetched_at:source}}),depth(1),response(2)],r=audited(e,[namedTick(.2,100,'a',10.01)]),d=r.trade_decisions[0];assert.equal(d.quote_fresh,false);assert.equal(d.quote_authoritative_for_rule,false);assert.equal(d.confidence,'very_low');assert.equal(d.quote_fetch_time_invalid,source===iso(2));}
});
test('同抓取时间重复报价不重置消费台账，不能把已耗尽队列恢复成未消费',()=>{
 const e=[depth(0,{volumes:{'ask:10.01':100},extra:{source_fetched_at:iso(0)}}),depth(.3,{volumes:{'ask:10.01':100},extra:{source_fetched_at:iso(0)}}),depth(1),response(2)],r=audited(e,[namedTick(.2,100,'a',10.01),namedTick(.4,100,'b',10.01)]);assert.equal(r.trade_decisions[1].quote_queue_exhausted_before,true);assert.equal(r.trade_decisions[1].quote_authoritative_for_rule,false);assert.equal(r.trade_decisions[1].quote_assigned_consumption_before_shares,100);
});
test('后来帧和选点后才到的成交不反推历史；迟到插入后新报价优先只影响应有记录',()=>{
 const e=[depth(0,{bid:10,ask:10.03}),changingBook(.3,'buy',10.01),depth(1),response(3)],ts=[namedTick(.2,100,'a',10.02),namedTick(.4,100,'b',10.01,3)],h=audited(e,ts,session,base+2000),r=audited(e,ts);assert.equal(h.source_trade_volume_shares,100);assert.equal(h.trade_decisions.length,1);assert.equal(r.trade_decisions[1].active_direction,'buy');assert.equal(r.trade_decisions[1].reason,'new_best_quote_corrects_tick');
});
test('独立审计检出best优先、部分范围、耗尽量、源时间与序号依据篡改',()=>{
 const e=[changingBook(0,'buy',10.02),changingBook(.3,'buy',10.01),depth(1),response(2)],ts=[namedTick(.2,100,'a',10.02),namedTick(.4,100,'b',10.01)],r=audited(e,ts);
 const edits=[x=>x.windows.find(w=>w.trade_decisions.some(d=>d.id==='b')).trade_decisions.find(d=>d.id==='b').quote_authoritative_for_rule=false,x=>x.windows[0].snapshot_quality.before_ask_levels=1,x=>x.windows[0].trade_decisions[0].quote_unconsumed_observed_quantity_shares=0,x=>x.windows[0].trade_decisions[0].quote_evidence_at=iso(2),x=>x.windows[0].trade_decisions[0].time_order_uncertain=true];for(const edit of edits){const x=plain(r);edit(x);const a=Audit.calculate(e,ts,session,x);assert.ok(a.global_quantity_check==='mismatch'||a.windows.some(w=>w.status==='mismatch'));}
});

test('页面集成：连续新卖一下降与同价换侧在card/图/JSON一致，原始记录保持',async()=>{
 const h=await harness();try{
  const custom=(kind,at,rows)=>{h.setNow(at);const p=h.payload(kind,kind==='ticks'?rows:[]);if(kind==='depth')p.rows=rows;h.api.bookRecorder.capture(kind,p);};
  custom('depth',.1,changingBook(.1,'buy',10.02).payload.rows);await h.drain();custom('depth',.3,changingBook(.3,'buy',10.01).payload.rows);await h.drain();
  custom('ticks',2,[{time:(base+200)/1000,price:10.02,volume:5000},{time:(base+400)/1000,price:10.01,volume:5000}]);await h.drain();assert.equal(h.w.document.querySelector('#bookSideBid [data-field="activeBuy"] dd').textContent,'100');assert.equal(h.w.document.querySelector('#bookSideAsk [data-field="activeSell"] dd').textContent,'0');assert.equal(h.w.__bookWaveData.version,14);assert.equal(h.w.__bookWaveData.trades.filter(t=>t.direction==='buy').reduce((v,t)=>v+t.volume,0),10000);
  await h.api.bookRecorder.exportData('json');const d=JSON.parse(h.w.__export.text);assert.equal(d.schema_version,14);assert.equal(d.ticks.length,2);assert.equal(d.statistics.trade_decisions[1].reason,'new_best_quote_corrects_tick');assert.equal(d.statistics.integrity_audit.global_quantity_check,'pass');assert.ok(d.statistics.integrity_audit.windows.every(w=>w.status!=='mismatch'));assert.match(h.w.document.body.textContent,/及时新最优报价|有效成交前盘口/);
 }finally{h.close();}
});
