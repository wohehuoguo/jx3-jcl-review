import {parseLua} from './lua.js';
import {buildBuffCheckpoints} from './balance.js';
import {BOSSES, MAPS, SKILLS, BUFFS, MARKS, RULE_VERSION, skillInfo} from './data.js';

const num = x => Number.isFinite(Number(x)) ? Number(x) : 0;
const id = x => x == null ? '' : String(x);
const yes = x => x === true || x === 'true' || x === 1;
const isTable = x => x !== null && typeof x === 'object';
const sumDamage = r => [0,1,2,3,4].reduce((s,k) => s + Math.max(0,num(r?.[k])), 0);
const clampText = (s,n=200) => String(s || '').slice(0,n);
export const timeLabel = ms => {
  const s = Math.max(0, ms) / 1000;
  return String(Math.floor(s/60)).padStart(2,'0') + ':' + (s%60).toFixed(1).padStart(4,'0');
};
function personName(people, uid) { return people[uid]?.name || (uid ? '单位 #' + uid : '未知单位'); }

export function analyzeText(text, filename='未命名.jcl', options={}) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('文件为空，没有可分析的战斗事件。');
  if (!/\.jcl$/i.test(filename)) throw new Error('请选择战斗结束后生成的 .jcl 文件。');
  const people = Object.create(null), npcs = Object.create(null), events=[];
  const headers=[], mapIds=new Set(), badRows=[];
  const normalized = text.replace(/^\uFEFF/, '');
  let rows=0, parsed=0, badRowCount=0;
  // Read lines without a second full-file array.
  let offset=0;
  while (offset < normalized.length) {
    let end = normalized.indexOf('\n',offset);
    if (end < 0) end = normalized.length;
    const line = normalized.slice(offset,end).replace(/\r$/, ''); offset=end+1; rows++;
    if (!line.trim()) continue;
    try {
      const columns = line.split('\t');
      if (columns.length < 6) throw new Error('字段不足');
      const kind=num(columns[4]);
      if (!Number.isInteger(kind) || kind < 1 || kind > 100) throw new Error('事件类型无效');
      const t=Number(columns[3]), unix=Number(columns[2]);
      if (!Number.isFinite(t) || !Number.isFinite(unix)) throw new Error('时间无效');
      const d=parseLua(columns.slice(5).join('\t'));
      if (!isTable(d)) throw new Error('事件内容不是表');
      const e={line:rows, t, unix, frame:num(columns[1]), kind, raw:clampText(line,700)};
      parsed++;
      if (kind === 1) {
        const header={start:yes(d[1]), uuid:String(d[2] || ''), duration:num(d[3]), mapId:num(d[4]), t, unix, line:rows};
        headers.push(header); if(header.mapId) mapIds.add(header.mapId);
        e.action=header.start?'进战':'脱战'; e.duration=header.duration; e.mapId=header.mapId;
      } else if (kind===4) {
        const uid=id(d[1]);
        people[uid]={id:uid, name:clampText(d[2] || '角色 #'+uid,80), force:num(d[3]), kungfu:num(d[4])};
        continue;
      } else if (kind===8) {
        const uid=id(d[1]); npcs[uid]={id:uid,name:clampText(d[2],80),template:id(d[3]),owner:id(d[4])};
        continue;
      } else if (kind===13) {
        Object.assign(e,{target:id(d[1]),remove:yes(d[2]),skill:id(d[5]),stack:num(d[6]),level:num(d[9]),caster:id(d[10]),scheme:2,endFrame:num(d[7])});
      } else if (kind===19 || kind===20) {
        Object.assign(e,{caster:id(d[1]),skill:id(d[2]),level:num(d[3]),scheme:1,response:kind===20?num(d[4]):null});
      } else if (kind===21) {
        const r=isTable(d[9])?d[9]:Object.create(null);
        Object.assign(e,{caster:id(d[1]),target:id(d[2]),scheme:num(d[4]),skill:id(d[5]),level:num(d[6]),
          damage:sumDamage(r), damageEff:Math.max(0,num(r[13])),heal:Math.max(0,num(r[6])),healEff:Math.max(0,num(r[14])),
          absorb:Math.max(0,num(r[9])), reflected:Math.max(0,num(r[5]))});
      } else if ([22,23,24,25,26].includes(kind)) {
        Object.assign(e,{caster:id(d[1]),target:id(d[2]),scheme:num(d[3]),skill:id(d[4]),level:num(d[5]),immune:kind===23});
      } else if (kind===27) {
        Object.assign(e,{target:id(d[1]),delta:num(d[2]),caster:'',skill:'life',scheme:0,damage:Math.max(0,-num(d[2])),heal:Math.max(0,num(d[2]))});
      } else if (kind===28) {
        Object.assign(e,{target:id(d[1]),caster:id(d[2])});
      } else if ([5,9].includes(kind)) {
        Object.assign(e,{target:id(d[1]),fighting:yes(d[2]),hp:num(d[3]),hpMax:num(d[4])});
      } else if ([14,15,18].includes(kind)) {
        e.message=clampText(kind===15?d[2]:d[1],250);
      } else if (kind===17) {
        Object.assign(e,{target:id(d[1]),online:yes(d[2])});
      } else if ([2,3,6,7,10,11].includes(kind)) {
        e.target=id(d[1]);
      } else continue;
      events.push(e);
    } catch (error) {
      badRowCount++;
      if (badRows.length < 20) badRows.push({line:rows,message:clampText(error.message,90)});
    }
  }
  if (!parsed || !events.length) throw new Error('没有识别到 JCL 事件。请选择原始 .jcl 文件，不能用伤害统计 .jx3dat 代替。');
  events.sort((a,b)=>a.t-b.t || a.line-b.line);
  const starts=headers.filter(h=>h.start), ends=headers.filter(h=>!h.start);
  const start=starts[0]?.t ?? events[0].t;
  const last=ends.at(-1);
  const finish=last?.t ?? events.at(-1).t;
  const duration=Math.max(0, finish-start, last?.duration || 0);
  const absoluteStart=starts[0]?.unix || events[0].unix;
  const meta={filename:clampText(filename,250),encoding:options.encoding || '文本',rows,parsed,badRows,badRowCount,
    start,finish,duration,absoluteStart,server:clampText(starts[0]?.uuid.split('::')[1] || '',100),
    startMarker:!!starts.length,endMarker:!!ends.length,mapIds:[...mapIds],ruleVersion:RULE_VERSION};
  const warnings=[];
  let validation;
  if(mapIds.size>1) validation={status:'conflict',label:'地图记录冲突',reason:'同一文件出现多个地图 ID，暂不套用洛阳专项规则。'};
  else if(mapIds.size===1 && MAPS[[...mapIds][0]]) validation={status:'verified',label:'25人普通 · 已核对地图',reason:'日志内部地图 ID 为835，对应当前测试服25人普通洛阳之战资料。人数不参与难度判定。',mapId:835};
  else if(mapIds.size) validation={status:'other',label:'其他地图 / 版本待适配',reason:'日志内部地图 ID 为'+[...mapIds][0]+'；当前白名单仅含835，不从文件名猜测难度。'};
  else validation={status:'unknown',label:'副本类型待确认',reason:'没有读到内部地图 ID。即使文件名写着25人普通，也不会据此通过校验。'};
  if(!meta.startMarker) warnings.push('缺少进战标记，开场前的点名与 Buff 状态可能缺失。');
  if(!meta.endMarker) warnings.push('缺少脱战标记，本文件可能未记录完整。');
  if(badRows.length) warnings.push('有无法解析的日志行，相关机制和人数结论需复核。');
  if(Object.keys(people).length<25) warnings.push('识别到'+Object.keys(people).length+'名玩家：可能缺人参战或记录范围不全，不据此改变副本难度。');
  if(starts.length>1) warnings.push('文件有多个进战标记，当前按连续记录展示，请核对是否包含多次尝试。');
  if(options.demo) warnings.push('这是合成示例，用于体验界面与规则，不是真实玩家战报。');
  const bossScore=new Map(), templates=new Map();
  for(const b of BOSSES) for(const n of b.templates) templates.set(n,b);
  const npcBoss = uid => templates.get(npcs[uid]?.template);
  for(const e of events) {
    if(e.t<start)continue;
    for(const uid of [e.caster,e.target]) {
      const b=npcBoss(uid);
      if(b && [13,19,21,28].includes(e.kind)) bossScore.set(b.id,(bossScore.get(b.id)||0)+(e.kind===21?3:1));
    }
    const s=e.scheme===2?null:SKILLS[e.skill];
    if(s && [19,21,25].includes(e.kind)) bossScore.set(s.boss,(bossScore.get(s.boss)||0)+1);
  }
  const bossId=[...bossScore].sort((a,b)=>b[1]-a[1])[0]?.[0];
  const boss=BOSSES.find(b=>b.id===bossId) || {id:'unknown',name:'首领待识别',short:'首领待识别',index:0,templates:[]};
  const special=validation.status==='verified' && boss.id!=='unknown';
  if(boss.id==='unknown') warnings.push('未识别到已知首领的活动事件，仍可查看通用死亡日志。');
  const units={...npcs,...people};
  const markBuffs=new Set(Object.values(MARKS).flat().map(String));
  const counts=Object.create(null), buffState=new Map(), windows=[], openBuffs=new Map();
  const snapshots=[], phases=[], deathDrafts=[], dead=new Set(), deathKeys=new Set(), unknownSkills=new Set();
  const eventByLine=new Map(events.map(e=>[e.line,e]));
  let p2=false, knownColours=false;
  let totalDamage=0,totalHeal=0;
  const bossDead=new Set(), settleSeen=new Set(), settlements=[];
  function buffs(uid) { if(!buffState.has(uid)) buffState.set(uid,new Map()); return buffState.get(uid); }
  function colourSnapshot(t) {
    const roster=Object.keys(people).map(uid=>{
      const state=buffs(uid); return {id:uid,name:people[uid].name,red:state.get('34095')?.stack||0,blue:state.get('34096')?.stack||0,isolated:state.has('34097'),dead:dead.has(uid)};
    });
    const red=roster.filter(p=>p.red>0).length,blue=roster.filter(p=>p.blue>0).length;
    return {t,red,blue,gap:Math.abs(red-blue),known:knownColours,roster};
  }
  for(const e of events) {
    const pc=people[e.target], source=people[e.caster];
    if(e.kind===21) {
      const owner=npcs[e.caster]?.owner;
      const uid=source?e.caster:people[owner]?owner:null;
      if(uid) { counts[uid] ||= {damage:0,heal:0,taken:0,deaths:0}; counts[uid].damage+=e.damageEff || e.damage || 0; counts[uid].heal+=e.healEff || 0; totalDamage+=e.damageEff || e.damage || 0; totalHeal+=e.healEff || 0; }
      if(pc) { counts[e.target] ||= {damage:0,heal:0,taken:0,deaths:0}; counts[e.target].taken+=e.damageEff || e.damage || 0; }
      if(pc && (e.healEff || 0)>0) dead.delete(e.target);
    }
    if(e.kind===5 && pc && e.hp>0) dead.delete(e.target);
    if(e.kind===13) {
      const state=buffs(e.target), key=e.target+'|'+e.skill;
      if(e.remove || e.stack===0) {
        state.delete(e.skill);
        if(openBuffs.has(key)) { openBuffs.get(key).end=e.t; openBuffs.get(key).endLine=e.line;openBuffs.delete(key); }
      } else {
        state.set(e.skill,{id:e.skill,stack:e.stack,level:e.level,caster:e.caster,t:e.t,line:e.line});
        if(markBuffs.has(e.skill) && !openBuffs.has(key)) { const w={target:e.target,buff:e.skill,caster:e.caster,start:e.t,end:Infinity,line:e.line};windows.push(w);openBuffs.set(key,w); }
      }
      if(['34095','34096'].includes(e.skill)) p2=true;
    }
    if(special && boss.id==='b5') {
      if(e.kind===19 && ['45525','45526','45530','45521'].includes(e.skill)) knownColours=true;
      if(!p2 && [21,19].includes(e.kind) && [45711,45686,45682,45724,45697].includes(num(e.skill))) {
        p2=true;phases.push({t:e.t,label:'P2机制出现',line:e.line});
      }
      if([19,21].includes(e.kind) && ['45715','45717','45718'].includes(e.skill)) {
        const key=e.skill+'|'+Math.floor(e.t/500);
        if(!settleSeen.has(key)) {
          settleSeen.add(key);
          settlements.push({...colourSnapshot(e.t),skill:e.skill,line:e.line});
        }
        if(e.skill==='45718' && e.kind===21) knownColours=true;
      }
    }
    if(e.kind===13 && pc && ['34095','34096','34097'].includes(e.skill)) snapshots.push(colourSnapshot(e.t));
    if(e.kind===19 && special) {
      const phase= boss.id==='b1' && e.skill==='45489' ? '60%特殊机制' :
        boss.id==='b2' && e.skill==='46424' ? '接剑转阶段' :
        boss.id==='b3' && e.skill==='45912' ? '链舞火环' : null;
      if(phase && !phases.some(p=>p.label===phase && e.t-p.t<5000)) phases.push({t:e.t,label:phase,line:e.line});
    }
    if(e.kind===13 && special && boss.id==='b4' && e.skill==='34310' && !e.remove && e.stack>0) {
      if(!phases.some(p=>p.label==='邪气'+e.stack+'层' && e.t-p.t<1000)) phases.push({t:e.t,label:'邪气'+e.stack+'层',line:e.line});
    }
    if(e.kind===28) {
      if(e.t>=start && npcBoss(e.target)?.id===boss.id) bossDead.add(e.target);
      if(pc) {
        const key=e.target+'|'+e.t;
        if(deathKeys.has(key)) continue;
        deathKeys.add(key);dead.add(e.target);
        counts[e.target] ||= {damage:0,heal:0,taken:0,deaths:0}; counts[e.target].deaths++;
        deathDrafts.push({time:e.t,id:e.target,killer:e.caster,line:e.line,
          buffs:[...buffs(e.target).values()].filter(b=>BUFFS[b.id]).map(b=>({...b,name:BUFFS[b.id]}))});
      }
    }
    if([19,21,25].includes(e.kind) && e.skill && skillInfo(e).kind==='unknown') unknownSkills.add(e.skill);
  }
  // Normalize colour snapshots after all same-timestamp buffs have been processed.
  const compact=[];
  for(const s of snapshots) { if(compact.at(-1)?.t===s.t) compact[compact.length-1]=s; else compact.push(s); }
  const associations=[], groupByKey=new Map(), latestGroup=new Map();
  for(const e of events) {
    if(![21,23,25].includes(e.kind) || !people[e.target] || !SKILLS[e.skill] || e.scheme===2) continue;
    const sourceKey=e.skill+'|'+e.caster;
    let g=latestGroup.get(sourceKey);
    if(!g || e.t-g.time>200 || g.caster!==e.caster) {
      g={skill:e.skill,time:e.t,targets:new Map(),lines:[],marked:new Map(),caster:e.caster};
      groupByKey.set(sourceKey+'|'+e.t,g);latestGroup.set(sourceKey,g);
    }
    let victim=g.targets.get(e.target);
    if(!victim) {victim={id:e.target,name:people[e.target].name,damage:0,immune:false,hit:false,lines:[]};g.targets.set(e.target,victim);}
    if(e.kind===21) victim.damage+=e.damageEff || e.damage || 0;
    if(e.kind===23) victim.immune=true;
    if(e.kind===25 || e.kind===21) victim.hit=true;
    victim.lines.push(e.line);g.lines.push(e.line);
    for(const w of windows) {
      if(!(MARKS[e.skill] || []).includes(num(w.buff)) || !people[w.target]) continue;
      if(w.start>e.t || w.end+300<e.t) continue;
      g.marked.set(w.target,{id:w.target,name:people[w.target].name,buff:w.buff,buffName:BUFFS[w.buff],line:w.line});
    }
  }
  for(const g of groupByKey.values()) {
    if(!special || SKILLS[g.skill].boss!==boss.id) continue;
    if(!MARKS[g.skill] && !['share','colour','catch-fail','balance-fatal','balance-high','balance-clear','bomb'].includes(SKILLS[g.skill].kind)) continue;
    let marked=[...g.marked.values()];const hit=[...g.targets.values()];
    let orderAssociated=false;
    if(g.skill==='45697' && marked.length>1) {
      const intersection=marked.filter(p=>g.targets.has(p.id));
      if(intersection.length===1) {marked=intersection;orderAssociated=true;}
    }
    associations.push({key:g.skill+'-'+g.caster+'-'+g.time,skill:g.skill,markExpected:!!MARKS[g.skill],name:SKILLS[g.skill].name,time:g.time,marked,hit,
      markedUnhit:marked.filter(p=>!g.targets.has(p.id)),
      extraHit:hit.filter(p=>!g.marked.has(p.id)),
      lines:[...new Set([...g.lines,...marked.map(p=>p.line)])],
      note:orderAssociated?'同轮注视者中只有这一人出现在本次命中记录，按幽影默认目标必命中的机制关联；记录缺失时需要复核。':
        marked.length>1?'同一窗口有多名点名者，名单可能合并了多个圈，不据此拆分圈归属。':
        marked.length===1?'点名来自 Buff 记录，实际名单包含伤害、零伤命中与免疫事件；不自动判定谁应当承伤。':
        MARKS[g.skill]?'此窗口没有匹配到已知点名 Buff；仍列出实际命中名单，不据此判断未被点名。':'按本次技能窗口列出实际命中与免疫名单。'});
  }
  // An avoided skill may have marks but no damage/hit events. Keep that evidence too.
  const usedMarks=new Set(associations.flatMap(a=>a.marked.map(p=>p.line)));
  const markOnly=new Map();
  if(special)for(const w of windows){
    if(usedMarks.has(w.line)||!people[w.target])continue;
    const skill=Object.keys(MARKS).find(s=>MARKS[s].includes(num(w.buff))&&SKILLS[s]?.boss===boss.id);
    if(!skill)continue;
    const key=skill+'-'+Math.floor(w.start/1000);
    if(!markOnly.has(key))markOnly.set(key,{key:'mark-'+key,skill,name:SKILLS[skill].name,time:w.start,marked:[],hit:[],markExpected:true,markedUnhit:[],extraHit:[],lines:[],note:'记录到了关联 Buff，但没有匹配到后续玩家命中；可能成功规避、技能中断，或相关事件缺失，不标记为未到场。'});
    const g=markOnly.get(key),p={id:w.target,name:people[w.target].name,buff:w.buff,buffName:BUFFS[w.buff],line:w.line};
    g.marked.push(p);g.markedUnhit.push(p);g.lines.push(w.line);
  }
  associations.push(...markOnly.values());
  associations.sort((a,b)=>a.time-b.time);
  const deaths=deathDrafts.map((d,index)=>{
    const history=events.filter(e=>e.t>=d.time-8000 && e.t<=d.time && e.target===d.id && [13,21,23,25,26,27,28].includes(e.kind));
    const hits=history.filter(e=>(e.damage||e.damageEff||0)>0 && e.t>=d.time-1500);
    const matching=hits.filter(e=>d.killer && (e.caster===d.killer || npcs[e.caster]?.owner===d.killer));
    const hit=(matching.length?matching:hits).at(-1);
    const info=hit?skillInfo(hit):null;
    const delta=hit?d.time-hit.t:null;
    const confidence=hit && delta<=500 && info.kind==='lethal'?'confirmed':hit && delta<=500?'likely':'unknown';
    const assoc=hit?associations.find(a=>a.skill===hit.skill && Math.abs(a.time-hit.t)<200 && a.hit.some(p=>p.id===d.id)):null;
    const healing=history.reduce((s,e)=>s+(e.healEff ?? e.heal ?? 0),0);
    const damage=history.reduce((s,e)=>s+(e.damageEff || e.damage || 0),0);
    return {...d,key:'death-'+index,name:people[d.id].name,killerName:personName(units,d.killer),
      cause:info?.name || '缺少相邻伤害事件',causeSkill:hit?.skill||null,causeLine:hit?.line||null,confidence,damage,healing,delta,
      association:assoc?.key||null,relatedMarks:assoc?.marked || [],
      evidence:history.map(e=>e.line).slice(-100),
      note:!hit?'有重伤通知，但没有找到死亡前1.5秒的伤害事件，不能把更早的受击当作致命一击。':
        info.kind==='normal'||info.kind==='tank'?'当前记录可解释临死受击；坦克正常承伤或任务命中不自动算失误。':
        '死亡原因由相邻日志事件关联；点名与实际名单可在机制核对中查看。'};
  });
  const issues=[], issueKeys=new Set();
  function issue(key,title,detail,confidence,time,lines,victims=[],kind='mechanic') {
    if(issueKeys.has(key)) return;issueKeys.add(key);
    issues.push({key,title,detail,confidence,time,lines:[...new Set(lines)],victims,kind});
  }
  for(const a of associations) {
    const info=SKILLS[a.skill];
    const killed=deaths.filter(d=>d.causeSkill===a.skill && Math.abs(d.time-a.time)<2000);
    if(info.kind==='balance-fatal') issue(a.key,'戾煞触发致命结算','已记录到致命分支命中，按技能资料对应赤幽人数差至少5；具体可见人数另列，缺失状态不补成无色。','confirmed',a.time,a.lines,killed.map(d=>d.id));
    if(info.kind==='balance-high') issue(a.key,'戾煞触发高伤分支','记录到人数差3–4的高伤分支；本分支不会清色，继续核对后续状态。','confirmed',a.time,a.lines,killed.map(d=>d.id));
    if(info.kind==='catch-fail') issue(a.key,info.name.startsWith('赤')?'赤圈承接出现强化爆炸':'幽圈承接出现强化爆炸','日志记录到“强”分支。可能由未承接、煞气未转化或承接者重伤触发；展示命中名单，不直接指定漏接责任人。','confirmed',a.time,a.lines,killed.map(d=>d.id));
    if(info.kind==='overload') issue(a.key,'五层煞气爆发命中','记录到煞气爆发技能；点开查看爆发前的 Buff 与实际受击，只有关联事件足够时才能追到具体来源。','confirmed',a.time,a.lines,killed.map(d=>d.id));
    if(info.kind==='bomb' && killed.length) issue(a.key,'玄隼弹爆造成减员','本次爆炸与'+killed.length+'条死亡记录相邻；没有连续高度数据，不据此认定是哪位搬弹者操作失误。','likely',a.time,a.lines,killed.map(d=>d.id));
  }
  for(const d of deaths) {
    if(issues.some(i=>i.victims.includes(d.id) && Math.abs(i.time-d.time)<2000)) continue;
    const info=d.causeSkill?skillInfo({skill:d.causeSkill,scheme:eventByLine.get(d.causeLine)?.scheme}):null;
    if(info && !['normal','tank','unknown','utility'].includes(info.kind)) {
      const key=d.causeSkill+'-'+Math.floor(d.time/1500);
      issue(key,d.cause+'出现减员',d.relatedMarks.length?'已关联到点名 Buff；请直接核对被点名单与实际命中名单。':d.note,d.confidence,d.time,[d.line,d.causeLine].filter(Boolean),[d.id],'death');
    }
  }
  issues.sort((a,b)=>a.time-b.time);
  let outcome='unknown',outcomeLabel='结果待确认';
  const activityNpcs=Object.values(npcs).filter(n=>npcBoss(n.id)?.id===boss.id);
  const isDeadBoss = boss.id==='b3'
    ? activityNpcs.some(n=>['138932','139319'].includes(n.template)&&bossDead.has(n.id)) &&
      activityNpcs.some(n=>['138933','139322'].includes(n.template)&&bossDead.has(n.id))
    : bossDead.size>0;
  if(isDeadBoss) {outcome='victory';outcomeLabel='已记录首领击破';}
  else if(meta.endMarker && Object.keys(people).length>=2 && dead.size===Object.keys(people).length) {outcome='wipe';outcomeLabel='全员重伤后脱战';}
  else if(meta.endMarker && deaths.length>=Math.max(3,Math.ceil(Object.keys(people).length*.6))) {outcome='failed';outcomeLabel='大量减员后脱战';}
  else if(meta.endMarker) {outcome='reset';outcomeLabel=deaths.length?'减员后脱战 · 结果待确认':'已脱战 · 未确认击破';}
  for(const s of settlements) {
    const inconsistent=s.skill==='45715'?s.gap<5:s.skill==='45717'?![3,4].includes(s.gap):s.gap>2;
    if(inconsistent) {
      s.known=false;
      s.discrepancy='可见人数与本次技能分支不一致，可能存在状态缺失或同帧清除；请核对原始事件，不据此认定配平结果。';
      if(!warnings.includes(s.discrepancy))warnings.push(s.discrepancy);
    }
  }
  const finalState=settlements.at(-1) || compact.at(-1) || null;
  const summary= outcome==='victory'
    ? {title:'首领击破已记录',detail:'可以继续复盘其中的减员和机制命中；通关不等于没有失误。',confidence:'confirmed'}
    : issues.find(i=>i.title.includes('致命结算')) || issues.find(i=>i.confidence==='confirmed') || issues[0] ||
      {title:deaths.length?'已还原死亡记录，机制原因待核对':'没有足够证据判断团灭原因',detail:'查看死亡前受击、Buff 与机制名单；不会把最先死亡的人自动认定为责任人。',confidence:'unknown'};
  const checkpoints=special&&boss.id==='b5'?buildBuffCheckpoints(events,people,meta):[];
  const evidenceLines=new Set([
    ...deaths.flatMap(d=>d.evidence),...issues.flatMap(i=>i.lines),...associations.flatMap(a=>a.lines),...phases.map(p=>p.line),...checkpoints.flatMap(c=>c.lines)
  ]);
  const evidence=events.filter(e=>evidenceLines.has(e.line)).slice(0,6000).map(e=>{
    const info=e.skill?skillInfo(e):null;
    return {line:e.line,time:e.t,kind:e.kind,caster:personName(units,e.caster),target:personName(units,e.target),
      skill:e.skill||'',name:e.kind===28?'重伤通知':e.kind===13?BUFFS[e.skill]||'Buff #'+e.skill:
        e.kind===27?'生命变化':info?.name||e.action||e.message||'状态事件',
      damage:e.damageEff || e.damage || 0,healing:e.healEff ?? e.heal ?? 0,
      stack:e.stack,remove:e.remove,level:e.level,immune:e.immune,raw:e.raw};
  });
  const players=Object.values(people).map(p=>({...p,...(counts[p.id]||{damage:0,heal:0,taken:0,deaths:0})}));
  const timeline=[
    ...phases.map(p=>({...p,type:'phase',label:p.label})),
    ...issues.map(i=>({t:i.time,type:'issue',label:i.title,line:i.lines[0]})),
    ...deaths.map(d=>({t:d.time,type:'death',label:d.name+' · '+d.cause,line:d.line,key:d.key}))
  ].sort((a,b)=>a.t-b.t).slice(0,200);
  return {schema:1,analysisVersion:2,meta,validation,boss,outcome,outcomeLabel,summary,issues,deaths,associations,players,phases,timeline,evidence,
    balance:boss.id==='b5'?{snapshots:compact.filter((s,i)=>i===0||s.t-compact[i-1].t>200||i===compact.length-1).slice(-300),settlements,state:finalState,checkpoints}:null,
    stats:{damage:totalDamage,heal:totalHeal,deaths:deaths.length,deadPlayers:new Set(deaths.map(d=>d.id)).size,players:players.length,mechanics:associations.length,unknownSkills:unknownSkills.size},
    warnings,demo:!!options.demo};
}
