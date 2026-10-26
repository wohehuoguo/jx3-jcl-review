/* Synthetic, clearly labelled fixtures go through the same parser as user files. */
const names=['听雨','照川','浮白','知微','晚舟','松间','望舒','青岚','枕流','见山','归雁','长风','折枝','问渠','疏桐','清和','南星','白榆','鹿鸣','听荷','云深','远岫','惊鸿','竹眠','玄墨'];
function lua(value) {
  if(value===null || value===undefined) return 'nil';
  if(typeof value==='string') return JSON.stringify(value);
  if(typeof value!=='object') return String(value);
  return '{'+Object.entries(value).map(([k,v])=>'['+JSON.stringify(Array.isArray(value)?Number(k)+1:k)+']='+lua(v)).join(',')+'}';
}
function fixture(boss,template,hour=21) {
  const records=[];const base=Math.floor(Date.parse('2026-10-26T'+String(hour).padStart(2,'0')+':00:00+08:00')/1000);
  const npc='900001';const pc=i=>String(10000+i);
  const add=(t,type,d)=>records.push({t,type,d});
  const buff=(t,i,skill,stack=1,remove=false)=>add(t,13,{1:pc(i),2:remove,3:1,4:false,5:skill,6:stack,7:99999,8:false,9:1,10:npc});
  const hit=(t,i,skill,amount=6000,caster=npc)=>add(t,21,{1:caster,2:pc(i),3:false,4:1,5:skill,6:1,7:false,8:2,9:{0:amount,13:amount}});
  const heal=(t,i,amount=16000)=>add(t,21,{1:pc(2),2:pc(i),3:false,4:1,5:1200,6:1,7:false,8:2,9:{6:amount,14:amount}});
  const death=(t,i)=>add(t,28,{1:pc(i),2:npc});
  const cast=(t,skill)=>add(t,19,{1:npc,2:skill,3:1});
  add(0,1,{1:true,2:'zhcn_hd::电信一区_梦江南::'+base+'::synthetic-example',3:0,4:835});
  for(let i=1;i<=25;i++) add(0,4,{1:pc(i),2:names[i-1],3:0,4:0});
  add(0,8,{1:npc,2:boss,3:template,4:0,5:0,6:0,7:0});
  const finish=t=> {
    add(t,1,{1:false,2:'zhcn_hd::电信一区_梦江南::'+base+'::synthetic-example',3:t,4:835});
    records.sort((a,b)=>a.t-b.t);
    return records.map(r=>[0,Math.floor(r.t/62.5),base+Math.floor(r.t/1000),r.t,r.type,lua(r.d)].join('\t')).join('\n')+'\n';
  };
  return {records,pc,npc,add,buff,hit,heal,death,cast,finish};
}
export function demoFiles() {
  const files=[];
  const five=fixture('史朝义',139312,21);
  five.cast(2000,45526);five.cast(60000,45711);
  for(let i=1;i<=10;i++) five.buff(76000+i, i,34095);
  for(let i=11;i<=15;i++) five.buff(76000+i, i,34096,2);
  five.cast(90000,45686);five.hit(92000,25,45682,58000);five.buff(92001,25,34095,3);five.heal(92500,25,50000);
  for(const [i,b] of [[11,34115],[12,34114],[13,34113]]) five.buff(103000,i,b);
  five.cast(103050,45696);
  for(const [i,t] of [[11,105050],[12,106550],[13,108050]]) {
    five.hit(t,i,45697,4900);five.buff(t+1,i,34096,3);five.heal(t+600,i,4900);
  }
  five.hit(105050,20,45697,4900);five.buff(105051,20,34096,1);
  for(const [i,b] of [[11,34115],[12,34114],[13,34113]]) five.buff(109000,i,b,0,true);
  five.cast(120000,45724);
  for(let i=1;i<=25;i++) {five.hit(125000,i,45715,99999999);five.death(125010+i,i);}
  files.push({name:'示例-25人普通洛阳之战(835)-史朝义.jcl',text:five.finish(126000),label:'幽影点名与配平失衡'});
  const four=fixture('阿史那承庆',139323,20);
  four.cast(1000,46491);four.buff(1500,25,34208);four.hit(6500,25,45551,35000);four.buff(6700,25,34208,0,true);four.heal(8000,25,35000);
  four.cast(40000,45937);four.buff(60000,3,34256);four.buff(65200,3,34256,0,true);four.buff(66000,24,34258);
  for(let i=1;i<=25;i++) {four.hit(76000,i,45954,180000);four.death(76040+i,i);}
  files.push({name:'示例-25人普通洛阳之战(835)-阿史那承庆.jcl',text:four.finish(78000),label:'炸弹爆炸减员'});
  const two=fixture('田承嗣',139329,19);
  two.cast(6000,46424);two.buff(8000,25,34329);
  for(const [i,t] of [[25,10000],[25,11000],[25,12000]]) two.hit(t,i,46095,40000);
  two.heal(10500,25,65000);two.death(12020,25);
  for(let i=1;i<25;i++) {two.hit(12300,i,46424,999999);two.death(12350+i,i);}
  files.push({name:'示例-25人普通洛阳之战(835)-田承嗣.jcl',text:two.finish(14000),label:'接剑窗口失败'});
  const one=fixture('突利和顺',139306,18);
  one.cast(15000,45485);
  for(const i of [3,4,5]) one.buff(15010,i,34238);
  one.hit(22000,3,45462,32000);one.hit(22000,7,45462,32000);one.heal(23000,7,32000);
  one.cast(45000,45488);one.hit(50000,8,45494,999999);one.death(50030,8);
  one.add(130000,28,{1:one.npc,2:one.pc(1)});
  files.push({name:'示例-25人普通洛阳之战(835)-突利和顺.jcl',text:one.finish(131000),label:'通关中的水墙减员'});
  const three=fixture('伊曼·逐焰',139322,17);
  three.add(0,8,{1:'900002',2:'伊曼·寂夜',3:139319,4:0});
  three.buff(30000,4,34597);three.hit(35000,4,45909,27000);three.hit(35000,9,45909,27000);
  three.buff(35001,4,34539,2);three.buff(35001,9,34539,2);
  three.hit(37000,9,45909,32000);three.buff(37001,9,34539,3);three.heal(38000,9,20000);
  for(let i=1;i<=25;i++) {three.hit(62000,i,45912,90000);three.death(62050+i,i);}
  files.push({name:'示例-25人普通洛阳之战(835)-伊曼双首领.jcl',text:three.finish(65000),label:'逐猎点名与火环减员'});
  return files;
}
