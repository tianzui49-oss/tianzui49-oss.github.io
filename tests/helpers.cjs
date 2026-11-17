'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
function embedded(name,marker){const start=html.indexOf('const '+name+' ='),end=html.indexOf(marker,start);if(start<0||end<0)throw Error(name+' missing');const context={module:{exports:{}},console};vm.runInNewContext(html.slice(start,end+marker.length),context);return context.module.exports;}
const Calc=embedded('BookThreeSecondCalculator',"if (typeof module !== 'undefined') module.exports = BookThreeSecondCalculator;");
const Audit=embedded('BookStatisticsAudit',"if(typeof module!=='undefined')module.exports=BookStatisticsAudit;");
const base=Date.parse('2026-11-17T09:30:00+08:00');
const iso=second=>new Date(base+second*1000).toISOString();
const session={id:'adjacent-v11',code:'600036',day:'2026-11-17',started_at:iso(0)};
function depth(second,options={}){
 const bid=options.bid??10,ask=options.ask??10.01;
 const rows=['bid','ask'].flatMap(side=>Array.from({length:5},(_,i)=>{const price=Number((side==='bid'?bid-i*.01:ask+i*.01).toFixed(2));return {side,level:i+1,price,volume:options.volumes?.[side+':'+price]??100000};}));
 return {kind:'depth',code:session.code,session_id:session.id,segment_id:options.segment||'continuous',received_at:iso(second),gap_limit_ms:options.limit??5000,payload:{rows},...(options.extra||{})};
}
function response(second,options={}){return {kind:'tick_response',code:session.code,session_id:session.id,segment_id:'continuous',received_at:iso(second),row_count:options.count??0,payload_metadata:{bounds:{mode:'available-day',day:session.day},history:{complete:options.complete??false},...(options.metadata||{})},...(options.extra||{})};}
function tick(second,volume,options={}){return {id:options.id||`trade-${second}-${volume}-${options.price??10}`,code:session.code,first_received_at:iso(options.recv??second+1),row:{time:(base+second*1000)/1000,price:options.price??10,volume},...(options.extra||{})};}
const calculate=(events,ticks=[],cutoff=Infinity)=>Calc.calculate(events,ticks,session,cutoff);
const plain=value=>JSON.parse(JSON.stringify(value));
module.exports={Calc,Audit,base,iso,session,depth,response,tick,calculate,plain,html};
