import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseLua,decodeJcl} from '../src/lua.js';
import {analyzeText} from '../src/analyze.js';
import {demoFiles} from '../src/demo.js';

const files=demoFiles();
const reports=files.map(d=>analyzeText(d.text,d.name,{demo:true}));
const row=(t,kind,content)=>[0,0,1793016000,t,kind,content].join('\t')+'\n';
const head=(map=835)=>row(0,1,'{true,"zhcn_hd::测试区_测试服::x",0,'+map+'}');
const actors=row(0,4,'{10001,"甲",0,0}')+row(0,4,'{10002,"乙",0,0}')+row(0,8,'{900001,"突利和顺",139306,0}');

test('Lua sparse fields, negative/zero keys, strings and nil match literal semantics',()=>{
  const a=parseLua('{1,nil,3,[0]=7,[-2]=-1.2e3,foo="中\\\\文",["a"]="\\065\\n", [999999999999999999]="id"}');
  assert.equal(a[1],1);assert.equal(a[2],undefined);assert.equal(a[3],3);assert.equal(a[0],7);
  assert.equal(a[-2],-1200);assert.equal(a.foo,'中\\文');assert.equal(a.a,'A\n');
  assert.equal(a['999999999999999999'],'id');
});
test('Lua prototype keys stay inert and source code cannot execute',()=>{
  const a=parseLua('{["__proto__"]={polluted=true},constructor="literal"}');
  assert.equal(Object.getPrototypeOf(a),null);assert.equal({}.polluted,undefined);
  for(const s of ['os.execute("x")','{x=function() end}','{1}; alert(1)','{x=NaN}','{x=1/0}'])assert.throws(()=>parseLua(s));
  assert.throws(()=>parseLua('{'.repeat(80)+'}'.repeat(80)));
});
test('UTF-8 and GBK are decoded without assuming one encoding',()=>{
  assert.equal(decodeJcl(new TextEncoder().encode('中文')).text,'中文');
  const result=decodeJcl(new Uint8Array([0xd6,0xd0,0xce,0xc4]));
  assert.equal(result.text,'中文');assert.match(result.encoding,/GB/);
});
test('all five examples pass through actual parsing and keep their demo flag',()=>{
  assert.deepEqual(new Set(reports.map(r=>r.boss.id)),new Set(['b1','b2','b3','b4','b5']));
  assert.ok(reports.every(r=>r.demo&&r.validation.status==='verified'&&r.meta.badRows.length===0&&r.stats.players===25));
  assert.equal(reports.find(r=>r.boss.id==='b1').outcome,'victory');
  assert.ok(reports.filter(r=>r.boss.id!=='b1').every(r=>r.outcome==='wipe'));
});
test('map ID is authoritative, never filename or a full 25-player roster',()=>{
  const text=files[0].text.replace(/835}/g,'834}');
  assert.equal(analyzeText(text,'25人普通洛阳之战(835).jcl').validation.status,'other');
  const missing=head().replace(',835}', '}')+actors+row(300,19,'{900001,45485,1}');
  assert.equal(analyzeText(missing,'25人普通洛阳之战(835).jcl').validation.status,'unknown');
  const short=head()+actors+row(300,19,'{900001,45485,1}')+row(500,1,'{false,"x",500,835}');
  const r=analyzeText(short,'x.jcl');
  assert.equal(r.stats.players,2);assert.equal(r.validation.status,'verified');
  assert.ok(r.warnings.some(s=>s.includes('不据此改变副本难度')));
});
test('conflicting maps disable encounter-specific rules',()=>{
  const r=analyzeText(files[0].text+row(127000,1,'{false,"x",127000,836}'),'x.jcl');
  assert.equal(r.validation.status,'conflict');assert.equal(r.associations.length,0);
});
test('ghost mark recipients and actual hits are reconciled without an expected roster',()=>{
  const r=reports[0],first=r.associations.find(a=>a.skill==='45697');
  assert.deepEqual(first.marked.map(p=>p.name),['归雁']);
  assert.deepEqual(first.hit.map(p=>p.name),['归雁','听荷']);
  assert.deepEqual(first.extraHit.map(p=>p.name),['听荷']);
  assert.ok(first.lines.some(line=>r.evidence.find(e=>e.line===line)?.kind===13));
});
test('red/blue layer totals are never confused with player counts',()=>{
  const s=reports[0].balance.state;
  assert.equal(s.red,11);assert.equal(s.blue,6);assert.equal(s.gap,5);
  assert.equal(s.roster.find(p=>p.name==='玄墨').red,3);
  assert.equal(reports[0].summary.title,'戾煞触发致命结算');
});
test('colour snapshot contradictions are flagged instead of presented as a successful balance',()=>{
  const text=files[0].text.replaceAll('["5"]=45715','["5"]=45718');
  const r=analyzeText(text,'x.jcl');
  assert.equal(r.balance.state.known,false);
  assert.match(r.balance.state.discrepancy,/不一致/);
});
test('two casters using the same skill on the same timestamp keep separate hit groups',()=>{
  const text=head()+actors+row(1000,21,'{900001,10001,false,1,45462,1,false,2,{[0]=500}}')+
    row(1000,21,'{900002,10002,false,1,45462,1,false,2,{[0]=500}}');
  const r=analyzeText(text,'x.jcl');
  assert.equal(r.associations.length,2);
  assert.equal(r.associations.reduce((n,a)=>n+a.hit.length,0),2);
});
test('zero-damage hit and immunity events count as visible participation',()=>{
  const text=head()+actors+row(1000,13,'{10001,false,1,false,34238,1,999,false,1,900001}')+
    row(2000,23,'{900001,10001,1,45462,1}')+row(2001,25,'{900001,10002,1,45462,1}')+
    row(3000,1,'{false,"x",3000,835}');
  const r=analyzeText(text,'x.jcl'),a=r.associations[0];
  assert.equal(a.hit.length,2);assert.equal(a.marked.length,1);
  assert.equal(a.hit[0].immune,true);assert.equal(a.hit[1].damage,0);
});
test('marks with no later hit remain visible without being labelled absent',()=>{
  const text=head()+actors+row(1000,13,'{10001,false,1,false,34238,1,999,false,1,900001}')+row(15000,1,'{false,"x",15000,835}');
  const r=analyzeText(text,'x.jcl');
  assert.equal(r.associations.length,1);assert.equal(r.associations[0].hit.length,0);
  assert.match(r.associations[0].note,/不标记为未到场/);
});
test('multiple simultaneous marks are retained rather than assigning one source blindly',()=>{
  const r=reports.find(r=>r.boss.id==='b1'),a=r.associations.find(a=>a.skill==='45462');
  assert.equal(a.marked.length,3);assert.match(a.note,/合并/);
});
test('a death without a recent hit stays unknown and keeps the death notification',()=>{
  const text=head()+actors+row(5000,21,'{900001,10001,false,1,45462,1,false,2,{[0]=30000,[13]=30000}}')+
    row(15000,28,'{10001,900001}')+row(16000,1,'{false,"x",16000,835}');
  const r=analyzeText(text,'x.jcl');
  assert.equal(r.deaths[0].confidence,'unknown');assert.equal(r.deaths[0].causeSkill,null);
  assert.ok(r.deaths[0].evidence.includes(6));
});
test('resurrected players may die again, while duplicate notifications are not doubled',()=>{
  const text=head()+actors+row(1000,28,'{10001,900001}')+row(1000,28,'{10001,900001}')+
    row(2000,21,'{10002,10001,false,1,1000,1,false,2,{[6]=1000,[14]=1000}}')+
    row(3000,28,'{10001,900001}')+row(4000,1,'{false,"x",4000,835}');
  const r=analyzeText(text,'x.jcl');
  assert.equal(r.deaths.length,2);assert.equal(r.stats.deadPlayers,1);
});
test('malformed and incomplete records are reported, never silently called complete',()=>{
  const r=analyzeText(head()+actors+'invalid-row\n'+row(1000,28,'{10001,900001}'),'x.jcl');
  assert.equal(r.meta.badRows.length,1);assert.equal(r.meta.endMarker,false);
  assert.ok(r.warnings.some(w=>w.includes('无法解析')));
  assert.throws(()=>analyzeText('','x.jcl'));
  assert.throws(()=>analyzeText(head(),'x.jcl.log'));
});
