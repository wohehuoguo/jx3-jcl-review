import {BOSSES,SOURCES,RULE_VERSION} from './data.js';
import {timeLabel} from './analyze.js';
import {demoFiles} from './demo.js';
import {getReports,saveReport,getSetting,setSetting} from './storage.js';
import {discoverJcl} from './files.js';

const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const compact=n=>n>=1e8?(n/1e8).toFixed(2)+'亿':n>=1e4?(n/1e4).toFixed(1)+'万':Math.round(n).toLocaleString('zh-CN');
const exact=n=>Math.round(n||0).toLocaleString('zh-CN');
const badge=(confidence)=>`<span class="confidence ${esc(confidence)}">${{confirmed:'确认事件',likely:'相邻推断',unknown:'待确认'}[confidence]||'待确认'}</span>`;
const state={reports:[],demos:[],demo:false,selected:null,boss:'all',outcome:'all',map:'verified',search:'',tab:'overview',detailSearch:'',eventKind:'all',eventLimit:200,busy:false};
let directory=null,paused=false,scanning=false,scanGeneration=0,lastScan=null,scanTimer=null,observed=new Map(),pendingCount=0,dirErrors=0;
let worker,serial=0;
const jobs=new Map();
function makeWorker() {
  worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{
    const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);clearTimeout(job.timeout);
    if(data.error)job.reject(new Error(data.error));else job.resolve(data.report);
  };
  worker.onerror=()=>{
    for(const job of jobs.values()){clearTimeout(job.timeout);job.reject(new Error('解析线程中断，请刷新后重新导入。'));}
    jobs.clear();worker.terminate();worker=null;
  };
}
async function parseFile(file,demo=false) {
  if(file.size>128*1024*1024) throw new Error(file.name+' 超过128MB，当前版本暂不处理超大日志。');
  if(!worker)makeWorker();
  const buffer=await file.arrayBuffer(), id=++serial;
  return new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{
      jobs.delete(id);worker?.terminate();worker=null;
      reject(new Error('解析超过90秒，已停止。请单独导入该文件，或核对文件是否损坏。'));
    },90000);
    jobs.set(id,{resolve,reject,timeout});
    worker.postMessage({id,buffer,filename:file.name,demo},[buffer]);
  });
}
function toast(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').hidden=true,6000);}
function busy(on,text='正在读取日志') {
  state.busy=on;$('#progress-strip').hidden=!on;$('#progress-text').textContent=text;
  for(const selector of ['#demo-button','#file-button','#directory-button','#scan-button']) $(selector).disabled=on;
}
const dateText=r=>{
  const date=new Date(r.meta.absoluteStart*1000);
  if(!Number.isFinite(date.getTime()))return '时间未知';
  return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(date);
};
const durationText=r=>Math.floor(r.meta.duration/60000)+':'+String(Math.floor(r.meta.duration/1000)%60).padStart(2,'0');
const current=()=> (state.demo?state.demos:state.reports).find(r=>r.id===state.selected);
const all=()=> (state.demo?state.demos:state.reports).slice().sort((a,b)=>b.meta.absoluteStart-a.meta.absoluteStart);
const failed=r=>['wipe','failed'].includes(r.outcome);
function filtered() {
  const q=state.search.toLocaleLowerCase();
  return all().filter(r=>(state.boss==='all'||r.boss.id===state.boss) &&
    (state.map==='all'||r.validation.status==='verified') &&
    (state.outcome==='all'||state.outcome==='failed'&&(failed(r)||r.deaths.length&&r.outcome!=='victory')||
      state.outcome==='victory'&&r.outcome==='victory'||state.outcome==='unknown'&&['unknown','reset'].includes(r.outcome)) &&
    (!q||(r.boss.name+' '+r.meta.filename+' '+r.meta.server).toLocaleLowerCase().includes(q)));
}
function renderNav() {
  const reports=all();
  $('#nav-total').textContent=reports.length;
  $('#boss-nav').innerHTML=BOSSES.map(b=>`<button class="boss-nav ${state.boss===b.id?'active':''}" data-boss="${b.id}"><span class="number">0${b.index}</span><span>${esc(b.short)}</span><b>${reports.filter(r=>r.boss.id===b.id).length||''}</b></button>`).join('');
  $('.boss-nav[data-boss="all"]').classList.toggle('active',state.boss==='all');
}
function renderList() {
  const reports=filtered();
  if(!reports.some(r=>r.id===state.selected)) {state.selected=reports[0]?.id||null;state.tab='overview';}
  $('#battle-count').textContent=reports.length;
  const verified=all().filter(r=>r.validation.status==='verified').length;
  $('#scan-summary').textContent=all().length?`共 ${all().length} 场 · 已核对25普通 ${verified} 场 · 其他或待确认 ${all().length-verified} 场`:'目录中的其他副本会自动分开标记';
  $('#battle-list').innerHTML=reports.length?reports.map((r,i)=>`<button class="battle-item ${r.id===state.selected?'selected':''}" data-report="${r.id}" aria-pressed="${r.id===state.selected}"><span class="battle-item-head"><strong>${esc(r.boss.short)}</strong><span class="battle-seq">${r.boss.index?'0'+r.boss.index:'—'}</span></span><span class="battle-item-meta"><i class="result-dot ${r.outcome==='victory'?'victory':r.deaths.length?'failed':''}"></i><time>${esc(dateText(r))}</time><span class="duration">${durationText(r)}</span></span><p class="battle-item-detail">${esc(r.validation.status!=='verified'?r.validation.label:r.outcome==='victory'?'首领击破':r.deaths.length?r.stats.deadPlayers+'人重伤 · '+r.deaths.length+'次死亡':r.validation.status!=='verified'?r.validation.label:'结果待确认')}</p></button>`).join(''):
    '<div class="no-battles">没有符合筛选的日志<br>可切换“全部日志与待确认”</div>';
}
function render() {
  $('#demo-notice').hidden=!state.demo;
  renderNav();renderList();renderReport();updateConnection();
}
function personChip(p,kind='',extra='') {
  return `<span class="person-chip ${esc(kind)}">${esc(p.name)}${extra?'<em>'+esc(extra)+'</em>':''}</span>`;
}
function emptyHTML() {
  return `<section class="empty-state"><svg class="empty-illustration" viewBox="0 0 110 110" fill="none" aria-hidden="true"><rect x="19" y="10" width="66" height="86" rx="5" fill="#f1f5e9" stroke="#b5c89d"/><path d="M28 29h29M28 40h43M28 51h23M28 62h34M28 73h16" stroke="#bacaa7" stroke-width="2"/><circle cx="76" cy="77" r="20" fill="#e7efdb" stroke="#91ab77"/><path d="M65 77l8 8 15-18" stroke="#7e9f61" stroke-width="2.5"/><path d="M9 20v61a7 7 0 007 7" stroke="#d8e3c9"/></svg><span class="eyebrow">A CLEARER VIEW OF EVERY FIGHT</span><h2>看清每一次战斗。</h2><p>点了谁，谁实际承伤，谁在什么时刻倒下。<br>把事件放回时间线，复盘就有据可循。</p><div class="empty-buttons"><button class="button primary" data-action="connect">▱ 连接日志目录</button><button class="button secondary" data-action="files">＋ 读取 JCL 文件</button></div><button class="text-button" data-action="demo">先体验五首领示例战报 →</button><div class="steps"><div><span class="step-number">01</span><strong>选日志目录</strong><small>递归发现多个角色下的 JCL，无需绑定账号</small></div><div><span class="step-number">02</span><strong>校验副本</strong><small>依据内部地图 ID，筛选洛阳25人普通</small></div><div><span class="step-number">03</span><strong>核对战斗</strong><small>新增日志自动解析，名单与证据一起看</small></div></div><p class="empty-hint">支持多文件拖入。目录持续扫描建议使用桌面 Chrome 或 Edge；页面关闭后停止。</p></section>`;
}
function renderReport() {
  const r=current();
  if(!r){$('#report-view').innerHTML=emptyHTML();return;}
  const tabs=[['overview','战斗总览',''],['mechanics','点名与承伤',r.associations.length],['deaths','死亡日志',r.deaths.length],['events','关联证据',r.evidence.length]];
  $('#report-view').innerHTML=`<div class="report-heading"><div><span class="eyebrow">LUOYANG / ENCOUNTER ${r.boss.index||'—'}</span><h2>${esc(r.boss.name)}</h2><div class="report-meta"><span class="validation-badge ${r.validation.status==='verified'?'':'warning'}">${esc(r.validation.status==='verified'?'25人普通 · 地图835':r.validation.label)}</span><span>${esc(dateText(r))}</span><span class="separator">·</span><span>${esc(r.meta.server||'区服未记录')}</span></div></div><div class="report-actions"><button class="button secondary" data-action="export" aria-label="导出当前战报 JSON">↓ <span class="export-label">导出战报</span></button></div></div><div class="stats-grid"><div class="stat-card"><span class="stat-label">战斗时长</span><strong class="stat-value">${durationText(r)}</strong><span class="stat-sub">${esc(r.outcomeLabel)}</span></div><div class="stat-card danger"><span class="stat-label">死亡记录</span><strong class="stat-value">${r.deaths.length}<small class="stat-unit">次</small></strong><span class="stat-sub">${r.stats.deadPlayers}人重伤 · 战复后再次死亡单独记录</span></div><div class="stat-card"><span class="stat-label">识别到的团队成员</span><strong class="stat-value">${r.stats.players}<small class="stat-unit">人</small></strong><span class="stat-sub">人数只展示，不作为副本难度依据</span></div><div class="stat-card"><span class="stat-label">机制核对窗口</span><strong class="stat-value">${r.associations.length}<small class="stat-unit">组</small></strong><span class="stat-sub">点名 Buff × 实际命中名单</span></div></div><nav class="tabs" aria-label="战报详情">${tabs.map(([key,label,n])=>`<button class="tab ${state.tab===key?'active':''}" data-tab="${key}" aria-current="${state.tab===key?'page':'false'}">${label}${n!==''?'<small>'+n+'</small>':''}</button>`).join('')}</nav><div id="tab-content"></div><details class="report-footnote"><summary>识别依据与记录完整度 · ${r.meta.startMarker?'进战✓':'缺进战标记'} / ${r.meta.endMarker?'脱战✓':'缺脱战标记'} / ${esc(r.meta.encoding)}</summary><p>${esc(r.validation.reason)}</p><ul>${r.warnings.map(w=>'<li>'+esc(w)+'</li>').join('')}<li>日志里的命中、免疫和零伤事件会一起核对；点名之外被命中不自动等于操作失误。</li><li>没有副本全团连续坐标，不根据名单推算走位。未知技能保留 ID。</li><li>规则依据：${esc(RULE_VERSION)}，需要真实日志持续校准。</li></ul><button class="text-button" data-action="help">查看资料来源与使用说明 →</button></details><span class="report-footnote file-label">${esc(r.meta.filename)} · ${r.meta.parsed.toLocaleString()}条记录 · ${esc(r.id.slice(0,12))}</span>`;
  renderTab();
}
function renderTab() {
  const r=current();if(!r)return;
  $('#tab-content').innerHTML=state.tab==='overview'?overviewHTML(r):state.tab==='mechanics'?mechanicsHTML(r):state.tab==='deaths'?deathsHTML(r):eventsHTML(r);
}
function deathRows(r,limit=Infinity) {
  const q=state.detailSearch.toLocaleLowerCase();
  const list=r.deaths.filter(d=>!q||(d.name+' '+d.cause+' '+d.killerName).toLocaleLowerCase().includes(q)).slice(0,limit);
  if(!list.length)return '<p class="empty-inline">没有符合条件的重伤记录。</p>';
  return '<div class="mini-deaths">'+list.map(d=>`<div class="death-row"><time>${timeLabel(d.time-r.meta.start)}</time><span class="death-name">${esc(d.name)}</span><span class="death-cause" title="${esc(d.cause)}">${esc(d.cause)}</span><button class="text-button" data-death="${esc(d.key)}">看证据 ↗</button></div>`).join('')+'</div>';
}
function balanceHTML(r) {
  const s=r.balance?.state;
  if(!s)return `<div class="note-panel"><div class="section-heading"><h3><span class="section-index">02</span>怎么读这份战报</h3></div><p>先看关键事件，再看点名与实际承伤名单。<br>点击任意死亡记录，查看之前8秒内的伤害、治疗与 Buff。</p><button class="text-button" data-tab="mechanics">打开点名与承伤 →</button></div>`;
  const total=s.red+s.blue;
  return `<section class="balance-panel"><div class="section-heading"><h3><span class="section-index">02</span>赤幽人数核对</h3><small>${timeLabel(s.t-r.meta.start)} · ${r.balance.settlements.length?'结算窗口':'最近状态'}</small></div><div class="balance-counts"><div class="colour-number">${s.red}<small>赤</small></div><span class="ratio-colon">:</span><div class="colour-number blue">${s.blue}<small>幽</small></div><div class="balance-gap">记录人数差<b>${s.gap}</b></div></div><div class="ratio-bar"><span class="red" style="width:${total?s.red/total*100:0}%"></span><span class="blue" style="width:${total?s.blue/total*100:0}%"></span></div><p class="balance-caption">按携带颜色的人数计，单人多层只算1人。${esc(s.discrepancy|| (s.known?'已观察到P1或清色基线，仍请核对记录完整度。':'未确认初始状态；这里只展示可见记录，不把未记录者当无色。'))}</p><div class="balance-faces">${s.roster.filter(p=>p.red||p.blue||p.isolated).slice(0,18).map(p=>personChip(p,p.red?'red':p.blue?'blue':'muted',(p.red?'赤'+p.red:p.blue?'幽'+p.blue:'')+(p.isolated?'·隔绝':''))).join('')}</div></section>`;
}
function overviewHTML(r) {
  const events=r.timeline.filter(e=>e.type!=='death').slice(0,4);
  if(r.deaths[0])events.push({t:r.deaths[0].time,type:'death',label:'首次重伤 · '+r.deaths[0].name,key:r.deaths[0].key});
  events.sort((a,b)=>a.t-b.t);
  const first=r.deaths[0];
  return `<section class="summary-card ${r.outcome==='victory'?'success':''}"><div class="summary-top"><span>${r.outcome==='victory'?'本次战斗':'本次战斗 · 关键线索'}</span>${badge(r.summary.confidence)}</div><h3>${esc(r.summary.title)}</h3><p>${esc(r.summary.detail)}</p>${r.summary.lines?.length?'<button class="text-button" data-lines="'+r.summary.lines.join(',')+'">核对相关事件 →</button>':''}</section><div class="overview-columns"><section class="timeline-panel"><div class="section-heading"><h3><span class="section-index">01</span>关键事件时间线</h3><small>按实际记录排列</small></div><div class="timeline-list">${events.length?events.map(e=>`<button class="timeline-event ${e.type}" ${e.key?'data-death="'+e.key+'"':e.line?'data-line="'+e.line+'"':'disabled'}><time>${timeLabel(e.t-r.meta.start)}</time><span class="event-point"></span><span>${esc(e.label)}</span></button>`).join(''):'<p class="empty-inline">尚未匹配到关键机制事件。</p>'}</div><p class="timeline-tail">${first?'首次减员发生在 '+timeLabel(first.time-r.meta.start)+'；先后关系不直接等于责任。':'当前未发现玩家重伤通知。'}</p></section>${balanceHTML(r)}</div><div class="section-heading"><h3><span class="section-index">03</span>死亡记录</h3><small>点击查看死亡前8秒</small></div>${deathRows(r,5)}${r.deaths.length>5?'<div class="all-deaths"><button class="text-button" data-tab="deaths">查看全部 '+r.deaths.length+' 次死亡 →</button></div>':''}<div class="section-heading"><h3><span class="section-index">04</span>点名与实际名单</h3><button class="text-button" data-tab="mechanics">完整核对 →</button></div>${r.associations.length?mechanicCard(r.associations.find(a=>a.marked.length)||r.associations[0],r):'<p class="empty-inline">没有匹配到已知机制窗口，仍可查看死亡与关联事件。</p>'}`;
}
function mechanicCard(a,r) {
  const deaths=r.deaths.filter(d=>a.hit.some(p=>p.id===d.id)&&d.time>=a.time&&d.time-a.time<=2000);
  const relatedState=a.skill==='45954', hasMarkRule=!!a.markExpected;
  const markLabel=relatedState?'关联状态':'点名记录';
  const note=relatedState?'关联状态来自携弹或倒计时 Buff，不等于投弹点名或爆炸来源；仅供对照实际命中。':a.note;
  return `<article class="mechanic-card"><div class="mechanic-header"><time>${timeLabel(a.time-r.meta.start)}</time><h3>${esc(a.name)}</h3><button class="text-button" data-lines="${a.lines.join(',')}">事件证据 ↗</button></div>${a.marked.length||hasMarkRule?`<div class="roster-line"><span class="roster-label">${markLabel}<b>${a.marked.length}</b></span><div class="roster-members">${a.marked.length?a.marked.map(p=>personChip(p,'mark',relatedState?p.buffName:'')).join(''):'<span class="empty-inline">未匹配到关联 Buff</span>'}</div></div>`:''}<div class="roster-line"><span class="roster-label">实际命中<b>${a.hit.length}</b></span><div class="roster-members">${a.hit.map(p=>personChip(p,'',p.immune?'免疫':p.damage?compact(p.damage):'命中')).join('')}</div></div>${!relatedState&&a.marked.length&&a.extraHit.length?`<div class="roster-line"><span class="roster-label">点名外命中<b>${a.extraHit.length}</b></span><div class="roster-members">${a.extraHit.map(p=>personChip(p,'muted')).join('')}</div></div>`:''}${deaths.length?`<div class="roster-line"><span class="roster-label">随后重伤<b>${deaths.length}</b></span><div class="roster-members">${deaths.map(p=>personChip(p,'red')).join('')}</div></div>`:''}<p class="mechanic-note">${esc(note)} · <span>s${a.skill}</span></p></article>`;
}
function mechanicsHTML(r) {
  return `<p class="mechanic-intro">不需要预设分组。直接看每次点了谁、谁实际承伤或命中、各有几人；有多个圈但不能拆分时，保留合并名单。</p><div class="view-toolbar"><input type="search" data-search="mechanics" aria-label="搜索机制或玩家" placeholder="搜索技能或玩家名" value="${esc(state.detailSearch)}"></div><div id="mechanic-rows">${mechanicRows(r)}</div>`;
}
function mechanicRows(r) {
  const q=state.detailSearch.toLocaleLowerCase();
  const list=r.associations.filter(a=>!q||(a.name+' '+a.marked.map(p=>p.name).join(' ')+' '+a.hit.map(p=>p.name).join(' ')).toLocaleLowerCase().includes(q));
  return list.map(a=>mechanicCard(a,r)).join('') || '<p class="empty-inline">没有匹配的机制窗口。未知技能的原始 ID 会保留在死亡证据中。</p>';
}
function deathsHTML(r) {
  return `<div class="view-toolbar"><input type="search" data-search="deaths" aria-label="搜索死亡玩家或死因" placeholder="搜索玩家、死因、击杀者" value="${esc(state.detailSearch)}"></div><p class="mechanic-intro">每次重伤单独记录，包括战复后的再次死亡。致命技能由相邻日志推断；缺少证据时保留未知。</p><div id="death-rows">${deathRows(r)}</div><div class="section-heading"><h3>团队数值参考</h3><small>不以总治疗量直接判断失误</small></div><div class="data-table-wrap"><table class="data-table"><thead><tr><th>玩家</th><th>输出</th><th>有效治疗</th><th>承伤</th><th>重伤</th></tr></thead><tbody>${r.players.slice().sort((a,b)=>b.deaths-a.deaths||b.damage-a.damage).map(p=>`<tr><td>${esc(p.name)}</td><td class="numeric">${compact(p.damage)}</td><td class="numeric">${compact(p.heal)}</td><td class="numeric">${compact(p.taken)}</td><td class="numeric">${p.deaths}</td></tr>`).join('')}</tbody></table></div>`;
}
function eventsHTML(r) {
  return `<p class="mechanic-intro">展示与死亡、点名和关键机制有关的事件。原始 JCL 始终留在本机；点击行号可核对记录。</p><div class="view-toolbar"><input type="search" data-search="events" aria-label="搜索关联事件" placeholder="搜索玩家、技能名、技能 ID" value="${esc(state.detailSearch)}"><select id="event-kind" aria-label="筛选事件类型"><option value="all">全部事件</option><option value="damage">伤害与命中</option><option value="heal">治疗</option><option value="buff">Buff变化</option><option value="death">重伤</option></select></div><div id="event-rows">${eventRows(r)}</div>`;
}
function eventRows(r) {
  const q=state.detailSearch.toLocaleLowerCase();
  const list=r.evidence.filter(e=>(!q||(e.caster+' '+e.target+' '+e.name+' '+e.skill).toLocaleLowerCase().includes(q))&&
    (state.eventKind==='all'||state.eventKind==='damage'&&(e.damage||[23,25].includes(e.kind))||
      state.eventKind==='heal'&&e.healing||state.eventKind==='buff'&&e.kind===13||state.eventKind==='death'&&e.kind===28));
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr><th>时间</th><th>事件</th><th>目标</th><th>数值 / 状态</th><th>证据</th></tr></thead><tbody>${list.slice(0,state.eventLimit).map(e=>`<tr><td>${timeLabel(e.time-r.meta.start)}</td><td><button class="pill-link" data-line="${e.line}">${esc(e.name)}</button></td><td>${esc(e.target==='未知单位'?'—':e.target)}</td><td>${e.damage?'<span class="event-amount">'+compact(e.damage)+'</span>':e.healing?'<span class="event-amount heal">+'+compact(e.healing)+'</span>':e.kind===13?e.remove?'移除':e.stack+'层':e.immune?'免疫':'—'}</td><td><button class="text-button" data-line="${e.line}">L${e.line}</button></td></tr>`).join('')}</tbody></table></div><p class="empty-inline">${list.length?`显示 ${Math.min(list.length,state.eventLimit)} / ${list.length} 条`:'没有符合条件的关联事件'}</p>${list.length>state.eventLimit?'<button class="button secondary" data-action="more-events">再显示200条</button>':''}`;
}
function openDialog(title,html) {
  $('#dialog-title').textContent=title;$('#dialog-content').innerHTML=html;
  if(!$('#detail-dialog').open)$('#detail-dialog').showModal();
}
function evidenceHTML(lines,r) {
  const set=new Set(lines.map(Number));
  const list=r.evidence.filter(e=>set.has(e.line));
  return list.length?list.map(e=>`<div class="evidence-event"><time>${timeLabel(e.time-r.meta.start)}</time><div><strong>${esc(e.name)}</strong><small>${esc(e.caster)} → ${esc(e.target)}${e.damage?' · 伤害 '+exact(e.damage):e.healing?' · 治疗 '+exact(e.healing):e.kind===13?' · '+(e.remove?'移除':e.stack+'层'):e.immune?' · 免疫':''}</small></div><button class="text-button" data-line="${e.line}">L${e.line} ↗</button></div>`).join(''):'<p class="dialog-description">这段记录没有保留可展示的事件，当前证据不足。</p>';
}
function showDeath(key) {
  const r=current(),d=r?.deaths.find(x=>x.key===key);if(!d)return;
  openDialog(d.name+' · '+timeLabel(d.time-r.meta.start),`<span>${badge(d.confidence)}</span><p class="dialog-description">临死受击：<strong>${esc(d.cause)}</strong>。${esc(d.note)}</p><div class="dialog-stats"><span>前8秒记录伤害<b>${compact(d.damage)}</b></span><span>前8秒有效治疗<b>${compact(d.healing)}</b></span><span>击杀者<b>${esc(d.killerName)}</b></span></div>${d.buffs.length?'<h3 class="dialog-content-heading">重伤通知时可见 Buff</h3><div class="roster-members">'+d.buffs.map(b=>personChip({name:b.name},b.id==='34095'?'red':b.id==='34096'?'blue':'',b.stack+'层')).join('')+'</div>':''}${d.relatedMarks.length?'<h3 class="dialog-content-heading">关联点名 Buff</h3><div class="roster-members">'+d.relatedMarks.map(p=>personChip(p,'mark',p.buffName)).join('')+'</div>':''}<h3 class="dialog-content-heading">死亡前8秒 · 伤害、治疗与状态</h3>${evidenceHTML(d.evidence,r)}`);
}
function showLine(line) {
  const r=current(),e=r?.evidence.find(x=>x.line===Number(line));if(!e){toast('该事件没有保留详细证据。');return;}
  openDialog('L'+e.line+' · '+e.name,`<p class="dialog-description">${timeLabel(e.time-r.meta.start)} · ${esc(e.caster)} → ${esc(e.target)}<br>事件码 ${e.kind}${e.skill?' · 技能 / Buff ID '+esc(e.skill):''}${e.level?' · 等级 '+e.level:''}</p><h3 class="dialog-content-heading">原始日志行（最多保留700字符）</h3><pre class="raw-log">${esc(e.raw)}</pre>`);
}
function showHelp() {
  openDialog('怎么用照夜复盘',`<section class="help-section"><h3>01 · 连接日志目录</h3><p>在茗伊团队工具中开启“战斗事件记录”“在秘境启用”和“保存附近所有角色”。从旁边的齿轮打开数据目录，选择包含 combat_logs 的目录；也可以选多个角色目录的上一级。最小战斗时间建议调低，以保留开场秒灭的日志。</p><p>桌面 Chrome / Edge 支持读取目录并持续发现新文件。页面关闭后停止扫描；再次打开可能需要重新授予权限。只请求读取权限，不修改原始文件。不支持持续目录访问的浏览器仍可读取文件或导入文件夹快照。</p></section><button class="button secondary folder-help" data-action="folder">导入文件夹快照（不持续扫描）</button><section class="help-section"><h3>02 · 怎样校验25人普通</h3><p>读取 JCL 内部进脱战事件中的地图 ID，当前参考资料将835对应到25人普通洛阳之战。再依据已知 NPC 模板、施法与命中识别首领。文件名与实到人数仅供参考。未知地图、新版本或冲突记录显示待确认，不套用其他难度规则。</p><p>这是类型与字段完整度核对，不宣称已对日志做官方防篡改认证。当前规则：${esc(RULE_VERSION)}。</p></section><section class="help-section"><h3>03 · 点了谁，谁实际承伤</h3><p>从 Buff 获得者和时间窗口关联点名；实际名单包含伤害、零伤命中与免疫事件。多人同时被点时可能合并多个圈，日志没有圈归属就保留合并名单。点名外被命中、没出现在命中列表，都不自动等于失误。</p><p>幽影斩同轮注视者中若只有一人出现在该次命中列表，会按默认目标必命中的机制关联到该人，仍需在真实日志中校准。无需输入预期分组。</p></section><section class="help-section"><h3>04 · 怎样判断死亡与团灭</h3><p>每条重伤通知关联之前8秒的伤害、治疗和 Buff；优先查找临死1.5秒内的同击杀者受击。固定致命机制与相邻受击推断分开标记。没有证据就保留未知，不把最先倒下者直接认定为责任人。</p><p>依据首领重伤记录确认击破；全员重伤后脱战可标记团灭。部分减员或主动重置无法可靠区分时保留结果待确认。只提供日志事实与线索，不通过总治疗量直接分配责任。</p></section><section class="help-section"><h3>05 · 本机数据与导出</h3><p>解析在当前浏览器的工作线程中完成，无网络上传或 AI 调用。分析结果与所选目录句柄保存在当前浏览器本机；不同设备或浏览器不会同步。原始 JCL 不复制到云端。可导出当前战报 JSON 备份。相同内容只保存一份；不同记录者的同场日志暂分别展示。</p><p>体验版没有真实洛阳JCL样本回归，内置五场均为明确标注的合成示例。未知技能保留数字 ID，不伪造技能名或全团位置。</p></section><section class="help-section"><h3>资料与源码</h3><ul>${SOURCES.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)} ↗</a></li>`).join('')}<li><a href="https://github.com/wohehuoguo/jx3-jcl-review" target="_blank" rel="noopener noreferrer">照夜网页源码 ↗</a></li></ul></section>`);
}
async function importFiles(files,{demo=false}={}) {
  const selected=Array.from(files).filter(f=>/\.jcl$/i.test(f.name));
  if(!selected.length){toast('没有找到 .jcl 文件；进行中的 .jcl.log 会在战斗结束后再解析。');return;}
  if(state.busy){toast('当前正在解析，请稍后再导入。');return;}
  busy(true);
  const errors=[];let added=0,duplicates=0;
  if(!demo){
    state.demo=false;state.selected=null;state.boss='all';state.outcome='all';state.search='';state.tab='overview';state.detailSearch='';
    $('#battle-search').value='';$('#outcome-filter').value='all';
  }
  const newReports=[];
  for(let i=0;i<selected.length;i++){
    $('#progress-text').textContent=`本机解析 ${i+1} / ${selected.length} · ${selected[i].name}`;
    try {
      const report=await parseFile(selected[i],demo), pool=demo?state.demos:state.reports;
      if(pool.some(r=>r.id===report.id)){duplicates++;continue;}
      pool.push(report);newReports.push(report);added++;
      if(!demo) {try{await saveReport(report);}catch{toast('当前浏览器无法保存本机历史，战报仍可在本页查看并导出。');}}
      if(!state.selected)state.selected=report.id;
      render();
    }catch(error){errors.push(error.message);}
  }
  if(!demo && newReports.length && !newReports.some(r=>r.validation.status==='verified')) {
    state.map='all';$('#map-filter').value='all';state.selected=newReports[0].id;
  }
  busy(false);render();
  toast(`新增 ${added} 场${duplicates?'，跳过'+duplicates+'份重复文件':''}${errors.length?'；'+errors.length+'份读取失败：'+errors[0]:''}`);
}
async function loadDemo() {
  if(state.busy)return;
  state.demo=true;state.boss='all';state.outcome='all';state.map='verified';state.tab='overview';state.detailSearch='';state.search='';
  $('#battle-search').value='';$('#outcome-filter').value='all';$('#map-filter').value='verified';
  if(!state.demos.length)await importFiles(demoFiles().map(d=>new File([d.text],d.name,{type:'text/plain'})),{demo:true});
  state.selected=state.demos.find(r=>r.boss.id==='b5')?.id||state.demos[0]?.id;render();
}
async function connectDirectory() {
  if(state.busy)return;
  if(!window.showDirectoryPicker){$('#folder-input').click();toast('当前浏览器支持文件夹快照导入；持续扫描请使用桌面 Chrome / Edge。');return;}
  try {
    const handle=await window.showDirectoryPicker({id:'zhaoye-jcl-logs',mode:'read'});
    directory=handle;paused=false;scanGeneration++;observed=new Map();state.demo=false;
    try{await setSetting('directory',handle);await setSetting('observed',[]);}catch{toast('目录已连接，但当前浏览器不能记住授权，下次访问请重新选择。');}
    startScanning();await scanDirectory();
  }catch(error){if(error.name!=='AbortError')toast('目录未能连接：'+error.message);}
}
function updateConnection() {
  $('#connection-dot').classList.toggle('connected',!!directory&&!paused);
  $('#connection-title').textContent=directory?(paused?'目录扫描已暂停':scanning?'正在读取目录':directory.name+' · 已连接'):'尚未连接日志目录';
  $('#connection-detail').textContent=directory?
    (scanning?'仅扫描 .jcl，进行中的日志留待战斗结束':`${lastScan?'最近扫描 '+lastScan:'每15秒检查新日志'}${pendingCount?' · '+pendingCount+'份进行中':''}${dirErrors?' · '+dirErrors+'个目录未能读取':''} · 页面关闭后停止`):
    '选择包含 JCL 的文件夹，自动发现新战斗';
  for(const s of ['#scan-button','#pause-button','#disconnect-button'])$(s).hidden=!directory;
  $('#pause-button').textContent=paused?'继续扫描':'暂停扫描';
}
function startScanning() {
  clearInterval(scanTimer);
  scanTimer=setInterval(()=>{if(directory&&!paused&&!state.busy&&!scanning)scanDirectory();},15000);
  updateConnection();
}
async function scanDirectory() {
  if(!directory||scanning||state.busy)return;
  const generation=scanGeneration;scanning=true;pendingCount=0;dirErrors=0;updateConnection();
  try {
    const found=await discoverJcl(directory,{observed,isCancelled:()=>generation!==scanGeneration});
    if(found.cancelled||generation!==scanGeneration)return;
    const {files}=found;pendingCount=found.pending;dirErrors=found.errors;
    if(found.skippedDepth)toast('部分目录层级超过16层，请改选更靠近 combat_logs 的目录，以免遗漏。');
    const batch=files.slice(0,60);
    if(batch.length && generation===scanGeneration) {
      await importFiles(batch.map(x=>x.file));
      // Failed files remain retryable via manual import; avoid re-parsing them every poll.
      for(const item of batch)observed.set(item.key,item.signature);
      try{await setSetting('observed',[...observed]);}catch{}
    }
    if(files.length>60)toast('本次处理最近60份新日志，剩余'+(files.length-60)+'份将在后续扫描继续处理。');
    lastScan=new Intl.DateTimeFormat('zh-CN',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date());
  }catch(error) {paused=true;toast((error.name==='NotAllowedError'?'读取目录需要重新授权。':'目录扫描未完成：')+error.message);}
  finally{scanning=false;updateConnection();renderList();}
}
function exportReport() {
  const r=current();if(!r)return;
  const blob=new Blob([JSON.stringify(r,null,2)],{type:'application/json'});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='照夜-'+r.boss.short.replace(/[\/\\]/g,'-')+'-'+r.id.slice(0,8)+(r.demo?'-合成示例':'')+'.json';
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.boss){state.boss=button.dataset.boss;state.selected=null;state.tab='overview';state.detailSearch='';render();}
  else if(button.dataset.report){state.selected=button.dataset.report;state.tab='overview';state.detailSearch='';renderList();renderReport();if(innerWidth<760)$('#report-view').scrollIntoView({behavior:'smooth',block:'start'});}
  else if(button.dataset.tab){state.tab=button.dataset.tab;state.detailSearch='';state.eventKind='all';state.eventLimit=200;renderReport();}
  else if(button.dataset.death)showDeath(button.dataset.death);
  else if(button.dataset.line)showLine(button.dataset.line);
  else if(button.dataset.lines)openDialog('机制关联事件',evidenceHTML(button.dataset.lines.split(','),current()));
  else if(button.dataset.action) {
    const actions={connect:connectDirectory,files:()=>$('#file-input').click(),folder:()=>$('#folder-input').click(),demo:loadDemo,help:showHelp,export:exportReport,
      'more-events':()=>{state.eventLimit+=200;$('#event-rows').innerHTML=eventRows(current());}};
    actions[button.dataset.action]?.();
  }
});
$('#file-button').onclick=()=>$('#file-input').click();
$('#directory-button').onclick=connectDirectory;
$('#demo-button').onclick=loadDemo;
$('#file-input').onchange=async e=>{await importFiles(e.target.files);e.target.value='';};
$('#folder-input').onchange=async e=>{$('#detail-dialog').close();await importFiles(e.target.files);e.target.value='';};
$('#help-button').onclick=showHelp;
$('#dialog-close').onclick=()=>$('#detail-dialog').close();
$('#detail-dialog').addEventListener('click',e=>{if(e.target===$('#detail-dialog'))$('#detail-dialog').close();});
$('#leave-demo').onclick=()=>{state.demo=false;state.selected=null;state.tab='overview';render();};
$('#battle-search').oninput=e=>{state.search=e.target.value;renderList();renderReport();};
$('#outcome-filter').onchange=e=>{state.outcome=e.target.value;renderList();renderReport();};
$('#map-filter').onchange=e=>{state.map=e.target.value;renderList();renderReport();};
$('#scan-button').onclick=scanDirectory;
$('#pause-button').onclick=async()=>{
  if(!directory)return;
  if(paused){
    try {
      let permission=await directory.queryPermission({mode:'read'});
      if(permission!=='granted')permission=await directory.requestPermission({mode:'read'});
      if(permission!=='granted'){toast('未获得目录读取权限，扫描仍暂停。');return;}
      paused=false;startScanning();scanDirectory();
    }catch(error){toast('目录权限恢复失败，请重新选择目录。'+error.message);}
  }else{paused=true;scanGeneration++;}
  updateConnection();
};
$('#disconnect-button').onclick=async()=>{
  scanGeneration++;directory=null;paused=false;clearInterval(scanTimer);
  try{await setSetting('directory',null);}catch{}updateConnection();toast('已断开目录。已解析的本机战报仍然保留。');
};
document.addEventListener('input',e=>{
  if(!e.target.dataset.search)return;
  state.detailSearch=e.target.value;
  const r=current();if(!r)return;
  if(e.target.dataset.search==='deaths')$('#death-rows').innerHTML=deathRows(r);
  else if(e.target.dataset.search==='mechanics')$('#mechanic-rows').innerHTML=mechanicRows(r);
  else {state.eventLimit=200;$('#event-rows').innerHTML=eventRows(r);}
});
document.addEventListener('change',e=>{if(e.target.id==='event-kind'){state.eventKind=e.target.value;state.eventLimit=200;$('#event-rows').innerHTML=eventRows(current());}});
let dragDepth=0;
document.addEventListener('dragenter',e=>{if(e.dataTransfer?.types.includes('Files')){e.preventDefault();dragDepth++;$('#drop-overlay').hidden=false;}});
document.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});
document.addEventListener('dragleave',e=>{e.preventDefault();if(--dragDepth<=0){dragDepth=0;$('#drop-overlay').hidden=true;}});
document.addEventListener('drop',e=>{e.preventDefault();dragDepth=0;$('#drop-overlay').hidden=true;if(e.dataTransfer?.files.length)importFiles(e.dataTransfer.files);});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&directory&&!paused)scanDirectory();});
window.addEventListener('beforeunload',()=>{clearInterval(scanTimer);worker?.terminate();});
async function init() {
  render();
  state.reports=(await getReports()).filter(r=>r.schema===1&&!r.demo);
  directory=await getSetting('directory');
  observed=new Map(await getSetting('observed')||[]);
  if(directory) {
    try {
      const permission=await directory.queryPermission({mode:'read'});
      if(permission==='granted'){startScanning();await scanDirectory();}
      else {paused=true;updateConnection();toast('已记住日志目录，点击“继续扫描”可恢复读取授权。');}
    }catch{directory=null;}
  }
  if(state.reports.length){
    if(!state.reports.some(r=>r.validation.status==='verified')){state.map='all';$('#map-filter').value='all';}
    state.selected=all()[0]?.id;render();
  }
  else if(!directory)await loadDemo();
  else render();
}
init().catch(error=>{busy(false);render();toast('本机历史读取失败，可重新选择日志文件：'+error.message);});
