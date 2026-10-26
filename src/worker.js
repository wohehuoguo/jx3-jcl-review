import {decodeJcl} from './lua.js';
import {analyzeText} from './analyze.js';
self.onmessage = async ({data}) => {
  try {
    const {text,encoding}=decodeJcl(data.buffer);
    const report=analyzeText(text,data.filename,{encoding,demo:data.demo});
    const digest=await crypto.subtle.digest('SHA-256',data.buffer);
    report.id=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    self.postMessage({id:data.id,report});
  } catch(error) { self.postMessage({id:data.id,error:error.message || '解析失败'}); }
};
