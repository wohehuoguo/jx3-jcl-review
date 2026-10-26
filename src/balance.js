const colours=new Set(['34095','34096','34097']);
const categories={
  '45711':'circles','45706':'circles','45708':'circles','45705':'circles','45707':'circles',
  '45686':'front','45682':'front','45687':'back','45685':'back',
  '45696':'ghost','45697':'ghost','45724':'settle','45715':'settle','45717':'settle','45718':'settle'
};
const casts=new Set(['45711','45686','45687','45696','45724']);
const hits=new Set(['45706','45708','45705','45707','45682','45685','45697','45715','45717','45718']);
const labels={circles:'接圈后',front:'一式后',back:'背面二式后',ghost:'幽影引导后',settle:'戾煞命中后'};

// Read observed state only. Never synthesize cancellations or assume all 40 circles were caught.
export function buildBuffCheckpoints(events,people,meta) {
  const sessions=[];
  let active=null;
  for(const e of events) {
    if(e.t<meta.start||e.t>meta.finish||e.scheme===2)continue;
    const cast=e.kind===19&&casts.has(e.skill);
    const hit=[21,23,25].includes(e.kind)&&hits.has(e.skill)&&people[e.target];
    if(!cast&&!hit)continue;
    const category=categories[e.skill];
    const newCast=cast&&(!active||e.t-active.start>200);
    if(!active||active.category!==category||newCast) {
      if(active)active.end=e.t;
      active={category,start:e.t,end:meta.finish,cast:cast?e:null,hits:[]};sessions.push(active);
    }
    if(hit)active.hits.push(e);
  }
  const points=[],rounds={};
  function add(session,label,group=[],extra={}) {
    const last=group.at(-1), ideal=last?last.t+500:session.end-1;
    const time=Math.max(session.start,Math.min(ideal,session.end-1,meta.finish));
    const nextGroup=extra.nextTime;
    points.push({key:'buff-'+session.category+'-'+session.start+'-'+points.length,
      time:nextGroup?Math.min(time,nextGroup-1):time,label,category:session.category,
      triggerLines:[...new Set([session.cast?.line,...group.map(e=>e.line)].filter(Boolean))],
      note:session.category==='circles'
        ?'取本段最后命中后0.5秒内的可见状态；只有施法时取下一机制前。命中条数不等于圈数，不能据此确认40圈接全。'
        :group.length?'取本次最后命中后0.5秒内的可见 Buff；遇到下一机制会提前截断。'
        :'只记录到施法，未见玩家命中；可能全员规避、技能中断或日志缺失，快照取下一机制前。',
      ...extra});
  }
  for(const s of sessions) {
    const round=rounds[s.category]=(rounds[s.category]||0)+1;
    if(s.category==='ghost'&&s.hits.length) {
      const waves=[];
      for(const e of s.hits) {
        if(!waves.length||e.t-waves.at(-1)[0].t>200)waves.push([]);
        waves.at(-1).push(e);
      }
      waves.forEach((wave,i)=>add(s,`第${round}段幽影 · 第${i+1}次后${i===waves.length-1?' / 本段结束':''}`,wave,
        {wave:i+1,waves:waves.length,nextTime:waves[i+1]?.[0].t,
          note:`本段记录到${waves.length}次命中窗口，不能仅凭窗口数认定三次均已完整记录。取该次命中后0.5秒内可见状态。`}));
    } else add(s,`第${round}段${labels[s.category]}`,s.hits);
  }
  if(!points.length)return [];
  points.sort((a,b)=>a.time-b.time);
  const state=new Map(Object.keys(people).map(id=>[id,{red:0,blue:0,isolated:false,dead:false,lines:new Map()}]));
  const out=[];let cursor=0,known=false;
  for(const point of points.slice(0,200)) {
    while(cursor<events.length&&events[cursor].t<=point.time) {
      const e=events[cursor++],p=state.get(e.target);
      if(e.kind===19&&['45525','45526','45530','45521'].includes(e.skill))known=true;
      if(e.kind===21&&e.skill==='45718'&&e.scheme!==2)known=true;
      if(!p)continue;
      if(e.kind===13&&colours.has(e.skill)) {
        const value=e.remove?0:e.stack;
        if(e.skill==='34095')p.red=value;
        else if(e.skill==='34096')p.blue=value;
        else p.isolated=value>0;
        p.lines.set(e.skill,e.line);
      }
      if(e.kind===28)p.dead=true;
      if((e.kind===5&&e.hp>0)||(e.kind===21&&e.healEff>0))p.dead=false;
    }
    const roster=Object.keys(people).map(id=>({id,name:people[id].name,red:state.get(id).red,
      blue:state.get(id).blue,isolated:state.get(id).isolated,dead:state.get(id).dead,known}));
    const red=roster.filter(p=>p.red>0).length,blue=roster.filter(p=>p.blue>0).length;
    out.push({...point,known,roster,red,blue,gap:Math.abs(red-blue),
      clear:known?roster.filter(p=>!p.red&&!p.blue).length:null,
      isolated:roster.filter(p=>p.isolated).length,
      lines:[...new Set([...point.triggerLines,...[...state.values()].flatMap(p=>[...p.lines.values()])])]});
  }
  return out;
}
