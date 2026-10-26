let dbPromise;
const fallback=new Map();
function db() {
  return dbPromise ||= new Promise((resolve,reject)=>{
    const req=indexedDB.open('zhaoye-jcl-local',1);
    req.onupgradeneeded=()=>{for(const name of ['settings','reports']) if(!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);};
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function transaction(store,mode,action) {
  const database=await db();
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(store,mode);
    const request=action(tx.objectStore(store));
    let result;
    request.onsuccess=()=>{result=request.result;};
    tx.oncomplete=()=>resolve(result);
    tx.onerror=()=>reject(tx.error);
    tx.onabort=()=>reject(tx.error || new Error('本机存储操作中断'));
  });
}
export async function getSetting(key) {
  try { return await transaction('settings','readonly',s=>s.get(key)); } catch { return fallback.get(key); }
}
export async function setSetting(key,value) {
  fallback.set(key,value);
  return transaction('settings','readwrite',s=>s.put(value,key));
}
export async function getReports() {
  try { return (await transaction('reports','readonly',s=>s.getAll())) || []; } catch { return []; }
}
export async function saveReport(report) {
  return transaction('reports','readwrite',s=>s.put(report,report.id));
}
