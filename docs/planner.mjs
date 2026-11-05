/* Pure catalogue, filtering and seasonal planning logic. Also used by Node tests. */
export const DAY = 86400000;
export const MONTH_NAMES = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'];
export const shortMonths = ['jan','feb','mar','apr','maj','jun','jul','aug','sep','okt','nov','dec'];
export const normalize = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const ordinal = value => Math.floor(Date.parse(String(value).slice(0,10) + 'T12:00:00Z') / DAY);
export const datePlus = (value, days) => new Date((ordinal(value) + days) * DAY).toISOString().slice(0,10);
export const todayInStockholm = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const stockholmNow = () => new Intl.DateTimeFormat('sv-SE', {timeZone:'Europe/Stockholm',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ', 'T');

export function searchDate(today, offset) {
  if (!offset) return today;
  const d = new Date(today.slice(0,7) + '-01T12:00:00Z');
  d.setUTCMonth(d.getUTCMonth() + offset);
  d.setUTCDate(15);
  return d.toISOString().slice(0,10);
}

export function quantile(values, p) {
  const arr = values.filter(Number.isFinite).sort((a,b) => a-b);
  if (!arr.length) return null;
  const position = (arr.length-1)*p, lower = Math.floor(position);
  return arr[lower] + (arr[Math.ceil(position)]-arr[lower]) * (position-lower);
}
export const median = values => quantile(values, .5);

export function queueDays(profile, today) {
  if (profile.days === null || profile.days === '' || profile.days === undefined) return null;
  const days = Number(profile.days);
  if (!Number.isFinite(days) || days < 0) return null;
  const elapsed = profile.asOf && Number.isFinite(ordinal(profile.asOf)) ? Math.max(0, ordinal(today)-ordinal(profile.asOf)) : 0;
  return Math.floor(days + elapsed);
}

export function distanceKm(a, b) {
  const rad = Math.PI/180;
  const dlat = (b.lat-a.lat)*rad, dlon = (b.lon-a.lon)*rad;
  const h = Math.sin(dlat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dlon/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}

export function prepareRows(listings, today, localTime = today + 'T00:00') {
  return listings.map(r => ({
    ...r,
    archetypeId: r.archetypeId || `${r.omrade}|${r.typ}|${r.yta}`,
    archetypeName: r.archetypeName || r.typ,
    district: r.district || r.omrade,
    rentNum: r.rentNum ?? (Number(String(r.hyra || '').replace(/\D/g,'')) || null),
    category: r.typOvergripande === 'Studentrum' ? 'room' : r.typOvergripande === 'Studentetta' ? 'studio' : 'apartment',
    searchText: normalize([r.adress,r.omrade,r.district,r.municipality,...(r.areaAliases || [])].join(' ')),
    closed: r.status === 'stangd' || (!!r.deadline && r.deadline <= localTime),
  }));
}

export function matches(r, filters) {
  if (filters.query && !r.searchText.includes(normalize(filters.query.trim()))) return false;
  if (filters.category !== 'all' && filters.category && r.category !== filters.category) return false;
  if (filters.districts?.length && !filters.districts.includes(r.district)) return false;
  if (filters.area && r.omrade !== filters.area) return false;
  if (filters.rentMax != null && (r.rentNum == null || r.rentNum > filters.rentMax)) return false;
  if (filters.sizeMin != null && (r.yta == null || r.yta < filters.sizeMin)) return false;
  if (filters.sizeMax != null && (r.yta == null || r.yta > filters.sizeMax)) return false;
  if (filters.floor === 'above' && !(r.floorNum >= 1)) return false;
  if (filters.floor === 'high' && !(r.floorNum >= 3)) return false;
  if (filters.floor === 'ground' && r.floorKind !== 'ground') return false;
  if (filters.elevator && normalize(r.hiss) !== 'ja') return false;
  if (filters.excludeLimited && r.contractType === 'limited') return false;
  if (filters.radiusCenter && filters.radiusKm) {
    if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon) || distanceKm(filters.radiusCenter, r) > filters.radiusKm) return false;
  }
  return true;
}

export function summarize(observations) {
  const usable = observations.filter(r => Number.isFinite(r.kodagar));
  const values = usable.map(r=>r.kodagar);
  return {
    n: values.length, units: new Set(usable.map(r=>r.objektNr)).size,
    q25: quantile(values,.25), median: median(values), q75:quantile(values,.75),
    nearDeadline: usable.filter(r=>r.sekunderForeDeadline!=null && r.sekunderForeDeadline>=0 && r.sekunderForeDeadline<=300).length,
    noApplicants: usable.filter(r=>r.antalSokande===0).length,
  };
}

export function buildGroups(rows, filters = {}) {
  const byId = new Map();
  for (const r of rows) {
    if (!matches(r,filters)) continue;
    if (!byId.has(r.archetypeId)) byId.set(r.archetypeId,[]);
    byId.get(r.archetypeId).push(r);
  }
  return [...byId].map(([id, list]) => {
    list.sort((a,b)=>(b.publiceratDatum||'').localeCompare(a.publiceratDatum||''));
    const latest = [...new Map([...list].reverse().map(r=>[r.objektNr,r])).values()];
    const sample = list.find(r=>r.bilder?.length) || list[0];
    const closed = list.filter(r=>r.closed && r.deadline && Number.isFinite(r.kodagar));
    const byMonth = new Map();
    for (const r of closed) {
      const m = r.deadline.slice(0,7);
      if (!byMonth.has(m)) byMonth.set(m,[]);
      byMonth.get(m).push(r);
    }
    const months = [...byMonth].sort(([a],[b])=>a.localeCompare(b)).map(([month,obs])=>({month,...summarize(obs)}));
    const rents = latest.map(r=>r.rentNum).filter(Number.isFinite);
    const leadTimes = closed.map(r=>r.inflyttningDatum ? ordinal(r.inflyttningDatum)-ordinal(r.deadline) : NaN).filter(n=>Number.isFinite(n)&&n>=0&&n<=365);
    return {
      id, rows:list, closed, months, ...summarize(closed),
      name:sample.archetypeName, area:sample.omrade, district:sample.district, municipality:sample.municipality,
      category:sample.category, contract:sample.contractType, curated:sample.curated,
      sizeMin:Math.min(...latest.map(r=>r.yta).filter(Number.isFinite)),
      sizeMax:Math.max(...latest.map(r=>r.yta).filter(Number.isFinite)),
      rentMin:rents.length?Math.min(...rents):null, rentMax:rents.length?Math.max(...rents):null,
      unitCount:latest.length, active:latest.filter(r=>!r.closed),
      photo:sample.bilder?.[0]?.fil, photoCaption:sample.bilder?.[0]?.text || `Områdesbild från ${sample.omrade}`,
      sample, buildings:[...new Map(latest.filter(r=>Number.isFinite(r.lat)&&Number.isFinite(r.lon)).map(r=>[r.buildingId||r.street,r])).values()],
      leadDays:median(leadTimes) == null?null:Math.round(median(leadTimes)), leadN:leadTimes.length,
    };
  });
}

export function seasonalEstimate(group, date) {
  // Repeat the latest observed same calendar month; never extrapolate a trend.
  const wanted = date.slice(5,7);
  const prior = group.months.filter(m=>m.month<=date.slice(0,7));
  const sameMonth = prior.filter(m=>m.month.slice(5,7)===wanted).at(-1);
  if (sameMonth) return {...sameMonth, basis:'seasonal', source:sameMonth.month};
  if (!prior.length) return null;
  const observations = group.closed.filter(r=>r.deadline.slice(0,7)<=date.slice(0,7));
  return {...summarize(observations), basis:'pooled', source:null};
}

export function assess(days, estimate) {
  if (!estimate || !estimate.n) return {level:'unknown',label:'Historik saknas',reachable:false};
  if (days == null) return {level:'neutral',label:`${Math.round(estimate.median)} dagar i median`,reachable:false};
  if (days>=estimate.q75) return {level:'strong',label:'Över historiskt mittspann',reachable:true};
  if (days>=estimate.median) return {level:'match',label:'Når typisk nivå',reachable:true};
  if (days>=estimate.q25) return {level:'near',label:'Nära typisk nivå',reachable:false};
  return {level:'below',label:'Behöver mer kötid',reachable:false};
}

export function plan(group, today, offset, currentDays) {
  const date = searchDate(today, offset);
  const estimate = seasonalEstimate(group,date);
  const days = currentDays == null?null:currentDays+ordinal(date)-ordinal(today);
  const moveDate = group.leadDays == null?null:datePlus(date,group.leadDays);
  return {date,days,estimate,moveDate,...assess(days,estimate)};
}

export function firstOpening(group,today,days,horizon=12,moveBy='') {
  if (days==null) return null;
  for (let offset=0;offset<=horizon;offset++) {
    const p=plan(group,today,offset,days);
    if (p.reachable && (!moveBy || (p.moveDate && p.moveDate<=moveBy))) return {offset,...p};
  }
  return null;
}

export function timeline(groups,today,days,horizon,moveBy='') {
  const opened = new Set();
  return Array.from({length:horizon+1},(_,offset)=>{
    const candidates = groups.map(group=>({group,...plan(group,today,offset,days)}));
    const reachable = candidates.filter(p=>p.reachable && (!moveBy || (p.moveDate && p.moveDate<=moveBy)));
    const fresh = reachable.filter(p=>!opened.has(p.group.id));
    reachable.forEach(p=>opened.add(p.group.id));
    return {offset,date:searchDate(today,offset),count:reachable.length,newCount:fresh.length,newIds:fresh.map(p=>p.group.id)};
  });
}

export function visibleGroups(groups, state, today, days) {
  let decorated = groups.map(g=>({...g,plan:plan(g,today,state.month||0,days),opening:firstOpening(g,today,days,state.horizon||12,state.moveBy)}));
  if (state.onlyFavorites) decorated=decorated.filter(g=>state.favorites?.includes(g.id));
  if (state.reachableOnly && days!=null) decorated=decorated.filter(g=>g.plan.reachable);
  if (state.moveBy) decorated=decorated.filter(g=>g.plan.moveDate && g.plan.moveDate<=state.moveBy);
  const sort=state.sort||'relevance';
  decorated.sort((a,b)=>{
    if(sort==='rent')return (a.rentMin??Infinity)-(b.rentMin??Infinity)||b.n-a.n;
    if(sort==='size')return b.sizeMax-a.sizeMax||b.n-a.n;
    if(sort==='days')return (a.plan.estimate?.median??Infinity)-(b.plan.estimate?.median??Infinity)||b.n-a.n;
    return Number(state.favorites?.includes(b.id))-Number(state.favorites?.includes(a.id)) ||
      (days==null?0:(a.opening?.offset??Infinity)-(b.opening?.offset??Infinity)) || b.n-a.n;
  });
  return decorated;
}

export function encodeFilters(state) {
  const params=new URLSearchParams();
  for(const key of ['query','category','area','floor','sort','moveBy']) if(state[key]&&state[key]!=='all')params.set(key,state[key]);
  for(const key of ['rentMax','sizeMin','sizeMax','month','horizon'])if(state[key]!=null)params.set(key,String(state[key]));
  for(const key of ['elevator','excludeLimited','reachableOnly'])if(state[key])params.set(key,'1');
  if(state.districts?.length)params.set('districts',state.districts.join('|'));
  if(state.radiusCenter&&state.radiusKm)params.set('radius',`${state.radiusCenter.lat.toFixed(5)},${state.radiusCenter.lon.toFixed(5)},${state.radiusKm}`);
  if(state.profile?.days!=null){params.set('days',state.profile.days);params.set('asof',state.profile.asOf);}
  return params.toString();
}

export function decodeFilters(search) {
  const p=new URLSearchParams(search), out={};
  for(const key of ['query','category','area','floor','sort','moveBy'])if(p.has(key))out[key]=p.get(key).slice(0,150);
  for(const key of ['rentMax','sizeMin','sizeMax','month','horizon']) {
    const n=Number(p.get(key)); if(p.has(key)&&Number.isFinite(n)&&n>=0)out[key]=Math.floor(Math.min(n,key==='month'||key==='horizon'?18:100000));
  }
  for(const key of ['elevator','excludeLimited','reachableOnly'])if(p.has(key))out[key]=p.get(key)==='1';
  if(p.has('districts'))out.districts=p.get('districts').split('|').slice(0,30);
  if(p.has('radius')){
    const [lat,lon,km]=p.get('radius').split(',').map(Number);
    if(Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=-90&&lat<=90&&lon>=-180&&lon<=180&&km>0&&km<=100){out.radiusCenter={lat,lon};out.radiusKm=km;}
  }
  if(p.has('days')&&Number.isFinite(Number(p.get('days')))&&Number(p.get('days'))>=0){
    const asOf=p.get('asof');out.profile={days:Math.min(30000,Math.floor(Number(p.get('days')))),asOf:/^\d{4}-\d{2}-\d{2}$/.test(asOf||'')?asOf:todayInStockholm()};
  }
  for (const [key, values] of Object.entries({category:['all','studio','apartment','room'],floor:['all','above','high','ground'],sort:['relevance','rent','days','size']})) {
    if (out[key] && !values.includes(out[key])) delete out[key];
  }
  if (out.horizon != null && ![3,6,12,18].includes(out.horizon)) out.horizon=12;
  if (out.moveBy && (!/^\d{4}-\d{2}-\d{2}$/.test(out.moveBy) || !Number.isFinite(ordinal(out.moveBy)))) delete out.moveBy;
  return out;
}
