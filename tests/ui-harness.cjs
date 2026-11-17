'use strict';
const {JSDOM}=require('jsdom');
const {IDBFactory,IDBKeyRange}=require('fake-indexeddb');
const fs=require('node:fs'),path=require('node:path');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const main=[...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)].at(-1)[1];
const ui=fs.readFileSync(path.join(__dirname,'../ui-parity.js'),'utf8');
const base=Date.parse('2026-11-17T01:30:00Z');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function harness({presentation=true}={}){
 const dom=new JSDOM(html.replace(/<script[\s\S]*?<\/script>/gi,''),{url:'https://test.invalid/',runScripts:'outside-only',pretendToBeVisual:true}),w=dom.window;
 Object.assign(w,{indexedDB:new IDBFactory(),IDBKeyRange,__now:base});
 w.eval(`const NativeDate=Date;Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[window.__now]));}static now(){return window.__now;}};`);
 w.setInterval=()=>0;w.clearInterval=()=>{};w.confirm=()=>true;
 const rows=(overrides={})=>['bid','ask'].flatMap(side=>[1,2,3,4,5].map(level=>{const price=Number((side==='bid'?10-(level-1)*.01:10+level*.01).toFixed(2));return {side,level,price,volume:overrides[side+':'+price]??100000};}));
 const payload=(kind,records=[],overrides={})=>({source:'THSDK',api:kind==='depth'?'depth':'tick_level1',code:'600036',fetched_at:new w.Date().toISOString(),bounds:{mode:'available-day',day:'2026-11-17'},history:{complete:false},rows:kind==='depth'?rows(overrides):records});
 const calls=[];w.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>payload(String(url).includes('/api/depth')?'depth':'ticks')};};
 const amended=main.replace(/function download\(name,text,type\)\{[^\n]+\}/,'function download(name,text,type){window.__export={name,text,type};}');
 w.eval(amended+'\nwindow.__test={state,bookRecorder,tickRowStats,tickCountRows,DerivedRateReset,BookThreeSecondCalculator,BookStatisticsAudit};marketPhase=()=>({open:true,label:"交易时段",day:"2026-11-17"});');
 if(presentation)w.eval(ui);
 await wait(20);w.document.getElementById('result').hidden=false;
 const api=w.__test;api.state.code='600036';api.state.chartDate='2026-11-17';await api.bookRecorder.begin('600036');await wait(70);
 async function capture(kind,second,{records=[],volumes={}}={}){w.__now=base+second*1000;api.bookRecorder.capture(kind,payload(kind,records,volumes));await wait(60);}
 return {dom,w,api,capture,calls,payload,base,wait,text:id=>w.document.getElementById(id)?.textContent||'',close:()=>dom.window.close()};
}
module.exports={harness,wait,base,html,ui};
