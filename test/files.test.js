import {test} from 'node:test';
import assert from 'node:assert/strict';
import {discoverJcl} from '../src/files.js';

const file=(name,time=10,size=20)=>({kind:'file',getFile:async()=>({name,lastModified:time,size})});
const dir=children=>({kind:'directory',async *entries(){yield* Object.entries(children);}});

test('recursively finds several accounts, ignores active files and sorts newest first',async()=>{
  const tree=dir({a:dir({combat_logs:dir({'old.jcl':file('old.jcl'), 'active.jcl.log':file('active.jcl.log')})}),
    b:dir({'NEW.JCL':file('NEW.JCL',30),'readme.txt':file('readme.txt')}),
    '.git':dir({'skip.jcl':file('skip.jcl',50)})});
  const r=await discoverJcl(tree);
  assert.deepEqual(r.files.map(x=>x.key),['b/NEW.JCL','a/combat_logs/old.jcl']);
  assert.equal(r.pending,1);assert.equal(r.errors,0);
});
test('unchanged paths skip; new, changed and combat-finished renamed files appear on the next scan',async()=>{
  const children={'a.jcl':file('a.jcl'),'pending.jcl.log':file('pending.jcl.log')}, tree=dir(children);
  const first=await discoverJcl(tree), observed=new Map(first.files.map(f=>[f.key,f.signature]));
  assert.equal((await discoverJcl(tree,{observed})).files.length,0);
  children['a.jcl']=file('a.jcl',11);children['new.jcl']=file('new.jcl',40);
  delete children['pending.jcl.log'];children['finished.jcl']=file('finished.jcl',20);
  const r=await discoverJcl(tree,{observed});
  assert.deepEqual(r.files.map(x=>x.key),['new.jcl','finished.jcl','a.jcl']);
  assert.equal(r.pending,0);
});
test('unreadable file does not hide other logs',async()=>{
  const tree=dir({'bad.jcl':{kind:'file',getFile:async()=>{throw new Error('busy');}},'good.jcl':file('good.jcl')});
  const r=await discoverJcl(tree);assert.equal(r.errors,1);assert.equal(r.files.length,1);
});
test('revoked directory permission surfaces for the resume authorization flow',async()=>{
  const tree={kind:'directory',async *entries(){throw Object.assign(new Error('denied'),{name:'NotAllowedError'});}};
  await assert.rejects(discoverJcl(tree),{name:'NotAllowedError'});
});
test('entry limits stop broad scans; deep scans report skipped branches',async()=>{
  await assert.rejects(discoverJcl(dir({'a.jcl':file('a.jcl'),'b.jcl':file('b.jcl')}),{maxEntries:1}),{code:'SCAN_LIMIT'});
  const r=await discoverJcl(dir({a:dir({b:dir({'x.jcl':file('x.jcl')})})}),{maxDepth:1});
  assert.equal(r.skippedDepth,1);assert.equal(r.files.length,0);
});
test('disconnect or pause cancels discovery so a partial batch is not imported',async()=>{
  const r=await discoverJcl(dir({'a.jcl':file('a.jcl')}),{isCancelled:()=>true});
  assert.equal(r.cancelled,true);assert.equal(r.files.length,0);
});
