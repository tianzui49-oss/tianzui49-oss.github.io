(() => {
'use strict';
const boot=window.__STABLE_RECORDS_BOOTSTRAP__;
if(!boot||typeof boot.items!=='object')throw Error('服务器记录区未就绪；未使用旧浏览器历史代替');
const WATCH='stock-watchlist-v1';let current=boot,pending=new Map(),values=new Map(Object.entries(boot.items).map(([k,v])=>[k,JSON.stringify(v)])),busy=false,failed=false,timer=null,seq=0;
const health=new Map(), queue=[];let running=0;
function emit(){window.dispatchEvent(new CustomEvent('stable-records-state',{detail:{items:Object.fromEntries(values),status:getStatus()}}));}
function getStatus(){return failed?'failed':busy||pending.size?'saving':'saved';}
function slot(fn){return new Promise((resolve,reject)=>{queue.push({fn,resolve,reject});pump();});}
function pump(){while(running<2&&queue.length){const x=queue.shift();running++;Promise.resolve().then(x.fn).then(x.resolve,x.reject).finally(()=>{running--;pump();});}}
async function api(path,body,attempt=0){return slot(async()=>{const text=body===undefined?null:JSON.stringify(body);const r=await fetch('/api/records/'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:text,credentials:'same-origin',keepalive:text!==null&&text.length<55000});let data;try{data=await r.json();}catch{throw Error('服务器返回格式暂不可用');}if(!r.ok){const e=Error(data.error||'服务器请求失败（'+r.status+'）');e.status=r.status;throw e;}return data;});}
function apply(b){if(!b||!b.items)return;current=b;values=new Map([...values].filter(([k])=>k.startsWith('stock-chart-')||k.startsWith('thsdk-last-valid-depth-v1:')));for(const [k,v]of Object.entries(b.items))values.set(k,JSON.stringify(v));for(const [k,x]of pending){if(x.value===null)values.delete(k);else values.set(k,x.value);}emit();}
async function refreshMetadata(){await ready;const b=await api('bootstrap');apply(b);return b;}
function schedule(ms=100){if(timer)clearTimeout(timer);timer=setTimeout(()=>void flush(),ms);}
async function flush(){if(busy||!pending.size)return;if(timer)clearTimeout(timer);timer=null;const batch=new Map(pending);busy=true;failed=false;emit();try{await ready;await api('kv',{items:Object.fromEntries([...batch].map(([k,x])=>[k,x.value===null?null:JSON.parse(x.value)]))});for(const [k,x]of batch)if(pending.get(k)?.seq===x.seq)pending.delete(k);busy=false;failed=false;emit();if(pending.size)schedule();}catch(e){busy=false;failed=true;emit();schedule(10000);}}
const storage={getStatus,getItem(k){return values.has(String(k))?values.get(String(k)):null;},setItem(k,v){k=String(k);v=String(v);values.set(k,v);pending.set(k,{value:v,seq:++seq});failed=false;emit();schedule(k===WATCH?0:350);},removeItem(k){k=String(k);values.delete(k);pending.set(k,{value:null,seq:++seq});failed=false;emit();schedule();}};
// Only this one legacy key may be read. Never open the old IndexedDB or read legacy history/chart keys.
let imported=null;
if(!Object.prototype.hasOwnProperty.call(boot.items,WATCH)){
 try{const raw=window.localStorage.getItem(WATCH);if(raw!==null){const a=JSON.parse(raw);if(Array.isArray(a)&&a.every(x=>x&&/^\d{6}$/.test(x.code))){imported=a.map(x=>({code:x.code,name:String(x.name||x.code)}));values.set(WATCH,JSON.stringify(imported));}}}catch{}
}
const ready=imported?api('watchlist/import',{items:imported}).then(b=>{apply(b);return b;}).catch(e=>{failed=true;emit();throw e;}):Promise.resolve(boot);
async function transactionRead(ops){await ready;return (await api('transaction',{mode:'readonly',ops})).results;}
async function allRows(store,code){for(let retry=0;retry<2;retry++){let cursor=null,out=[];try{do{const params=new URLSearchParams({store,code,limit:'200'});if(cursor)params.set('cursor',cursor);const p=await api('rows?'+params);if(!Array.isArray(p.values))throw Error('记录页格式无效');out.push(...p.values);cursor=p.next;}while(cursor);return out;}catch(e){if(e.status!==409||retry)throw e;}}}
function transaction(names,mode='readonly'){
 if(mode!=='readonly')throw Error('逐笔与盘口由服务器采集，本页不写入原始记录');
 if(!Array.isArray(names))names=[names];if(names.some(x=>!['events','ticks','latest'].includes(x)))throw Error('未知记录类型');
 const ops=[],requests=[],tx={oncomplete:null,onerror:null,onabort:null,error:null};
 const add=(store,method,key,index)=>{const r={result:undefined,error:null,onsuccess:null,onerror:null};ops.push({store,method,key,...(index?{index}: {})});requests.push(r);return r;};
 tx.objectStore=name=>{if(!names.includes(name))throw Error('记录类型不在事务中');return {get:key=>add(name,'get',key),index:index=>{if(index!=='code')throw Error('未知索引');return {getAll:key=>add(name,'getAll',key,'code')};},getAll:key=>add(name,'getAll',key,'code')};};
 queueMicrotask(async()=>{try{await ready;const results=await Promise.all(ops.map(async op=>op.method==='getAll'?allRows(op.store,op.key):(await transactionRead([op]))[0]));results.forEach((v,i)=>{requests[i].result=v;requests[i].onsuccess?.({target:requests[i]});});queueMicrotask(()=>tx.oncomplete?.({target:tx}));}catch(e){tx.error=e;requests.forEach(r=>{r.error=e;r.onerror?.({target:r});});queueMicrotask(()=>{tx.onerror?.({target:tx});tx.onabort?.({target:tx});});}});return tx;
}
let resetPending=null;
async function reset(codes){await ready;await flush();if(pending.has(WATCH))throw Error('请先等待自选名单保存成功');await refreshMetadata();const normalized=[...new Set(codes)].sort();const signature=normalized.join(',');if(!resetPending||resetPending.signature!==signature)resetPending={signature,id:globalThis.crypto?.randomUUID?.()||('reset-'+Date.now()+'-'+Math.random().toString(36).slice(2))};const r=await api('reset',{codes:normalized,epochs:Object.fromEntries(normalized.map(c=>[c,current.heads?.[c]||0])),request_id:resetPending.id});resetPending=null;await refreshMetadata();return r;}
async function loadStockCaches(code,day){await ready;const b=await api('stock-cache?code='+encodeURIComponent(code)+(day?'&day='+encodeURIComponent(day):''));for(const k of [...values.keys()])if((k.startsWith('stock-chart-'+code+'-')||k==='thsdk-last-valid-depth-v1:'+code)&&!pending.has(k))values.delete(k);for(const [k,v]of Object.entries(b.items||{}))if(!pending.has(k))values.set(k,JSON.stringify(v));}
async function remove(codes){await ready;await flush();if(pending.has(WATCH))throw Error('请等待自选保存');const result=await api('watchlist/remove',{codes:[...new Set(codes)]});await refreshMetadata();return result;}
async function archives(){await ready;return api('archives');}
async function restore(batch_id){batch_id=Number(batch_id);await ready;const r=await api('restore',{batch_id});await refreshMetadata();return r;}
async function refreshHealth(codes){await ready;const keys=['collector-status',...codes.map(c=>'collector-health:'+c)];const results=await transactionRead(keys.map(key=>({store:'latest',method:'get',key})));keys.forEach((k,i)=>health.set(k,results[i]));return results;}
function collectorStatus(code){return health.get(code?'collector-health:'+code:'collector-status')||{};}
window.StableRecords={storage,ready,api,loadStockCaches,refreshMetadata,refreshHealth,getStatus,reset,remove,archives,restore,collectorStatus,recordDB:{open:async()=>{await ready;return {transaction};}},retry:()=>void flush(),heads:()=>current.heads||{},cutoffs:()=>current.cutoffs||{}};
document.addEventListener('visibilitychange',()=>{if(document.hidden)void flush();});window.addEventListener('pagehide',()=>void flush());
ready.then(()=>emit()).catch(()=>{});
})();
