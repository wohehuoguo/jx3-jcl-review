import {test} from 'node:test';
import assert from 'node:assert/strict';
import {analyzeText} from '../src/analyze.js';
import {demoFiles} from '../src/demo.js';
import {buildBuffCheckpoints} from '../src/balance.js';

const sample=demoFiles()[0];
const report=analyzeText(sample.text,sample.name),checkpoints=report.balance.checkpoints;
const person=(s,n)=>s.roster.find(p=>p.id===String(10000+n));

test('40 synthetic landings produce a full-team checkpoint without equating damage records with circles',()=>{
  const s=checkpoints[0];
  assert.equal(s.category,'circles');assert.equal(s.roster.length,25);
  assert.equal(s.red,10);assert.equal(s.blue,5);assert.equal(s.clear,10);
  assert.equal(person(s,25).red,0);assert.equal(person(s,11).blue,2);
  assert.match(s.note,/不能据此确认40圈接全/);
  const effects=sample.text.split('\n').filter(s=>s.includes('["5"]=45706,')||s.includes('["5"]=45708,'));
  assert.equal(effects.length,40);
});
test('front and back snapshots include delayed Buff gains and do not leak later ghost gains',()=>{
  const front=checkpoints.find(s=>s.category==='front'),back=checkpoints.find(s=>s.category==='back');
  assert.equal(person(front,25).red,3);assert.equal(person(front,1).red,1);
  assert.equal(person(back,1).red,2);assert.equal(person(back,20).blue,0);
  assert.equal(back.red,11);assert.equal(back.blue,5);
});
test('each ghost wave keeps an independent roster and the final wave is identified',()=>{
  const waves=checkpoints.filter(s=>s.category==='ghost');
  assert.equal(waves.length,3);
  assert.equal(person(waves[0],11).blue,3);assert.equal(person(waves[0],12).blue,2);
  assert.equal(person(waves[0],20).blue,1);
  assert.equal(person(waves[1],12).blue,3);assert.equal(person(waves[1],13).blue,2);
  assert.equal(person(waves[2],13).blue,3);assert.match(waves[2].label,/本段结束/);
  assert.equal(waves[2].red,11);assert.equal(waves[2].blue,6);
});
const people={'1':{name:'甲'},'2':{name:'乙'}};
const buff=(t,id,skill,stack,remove=false)=>({t,kind:13,line:t,target:id,skill,stack,remove,scheme:2});
const cast=(t,skill)=>({t,kind:19,line:t,skill});
const hit=(t,id,skill)=>({t,kind:21,line:t,target:id,skill,scheme:1});
const meta={start:0,finish:20000};
test('missing initial state remains unknown; red and blue are not automatically cancelled',()=>{
  const events=[cast(1000,'45687'),buff(2000,'1','34095',2),buff(2100,'1','34096',1),hit(3000,'1','45685')];
  const [s]=buildBuffCheckpoints(events,people,meta);
  assert.equal(s.known,false);assert.equal(s.clear,null);
  assert.equal(s.roster[0].red,2);assert.equal(s.roster[0].blue,1);
  assert.equal(s.roster[1].known,false);
});
test('a fully avoided back cast still has a checkpoint without inventing hits',()=>{
  const [s]=buildBuffCheckpoints([cast(1000,'45687'),cast(5000,'45696')],people,meta);
  assert.equal(s.category,'back');assert.equal(s.time,4999);assert.match(s.note,/未见玩家命中/);
});
test('separate landing sequences stay separate instead of merging different rounds',()=>{
  const events=[cast(0,'45526'),cast(1000,'45711'),hit(3000,'1','45706'),buff(3001,'1','34095',1),
    cast(5000,'45686'),cast(8000,'45711'),hit(10000,'2','45708'),buff(10001,'2','34096',1)];
  const s=buildBuffCheckpoints(events,people,meta).filter(s=>s.category==='circles');
  assert.equal(s.length,2);assert.equal(s[0].blue,0);assert.equal(s[1].blue,1);
});
test('recorded removal, isolation and deaths are reflected in the later checkpoint',()=>{
  const events=[cast(0,'45526'),buff(100,'1','34095',3),cast(1000,'45696'),hit(3000,'1','45697'),
    buff(3001,'1','34095',0,true),buff(3002,'1','34097',1),{t:3010,line:3010,kind:28,target:'1'}];
  const [s]=buildBuffCheckpoints(events,people,meta);
  assert.equal(s.roster[0].red,0);assert.equal(s.roster[0].isolated,true);assert.equal(s.roster[0].dead,true);
  assert.ok(s.lines.includes(3001));assert.ok(s.lines.includes(3002));
});
test('encounter snapshots are disabled when the internal map has not passed validation',()=>{
  const r=analyzeText(sample.text.replace(/835}/g,'834}'),'x.jcl');
  assert.deepEqual(r.balance.checkpoints,[]);
});
