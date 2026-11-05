import {buildGroups, prepareRows, matches, plan, timeline, visibleGroups, firstOpening, queueDays, todayInStockholm, encodeFilters, decodeFilters, shortMonths, ordinal, stockholmNow} from './planner.mjs';

const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => Number.isFinite(value) ? Math.round(value).toLocaleString('sv-SE') : '–';
const monthName = date => `${shortMonths[Number(date.slice(5,7))-1]} ${date.slice(0,4)}`;
const dateName = date => date ? `${Number(date.slice(8,10))} ${monthName(date)}` : 'Okänd';
const url = value => {
  if (!value) return '';
  try { const u = new URL(value,location.href); return ['http:','https:'].includes(u.protocol)?u.href:''; } catch { return ''; }
};
const today = todayInStockholm();
const defaults = {view:'explore',profile:{days:null,asOf:today},month:0,horizon:12,query:'',category:'all',districts:[],area:'',rentMax:null,sizeMin:null,sizeMax:null,floor:'all',elevator:false,excludeLimited:false,moveBy:'',favorites:[],compare:[],onlyFavorites:false,reachableOnly:false,sort:'relevance',radiusCenter:null,radiusKm:3,showMap:matchMedia('(min-width: 761px)').matches};
let saved = {};
try {
  const raw=JSON.parse(localStorage.getItem('sssb-explorer-v1')||'{}');
  saved={...decodeFilters(raw.filters||''),favorites:Array.isArray(raw.favorites)?raw.favorites.filter(s=>typeof s==='string').slice(0,500):[],compare:Array.isArray(raw.compare)?raw.compare.filter(s=>typeof s==='string').slice(0,3):[]};
} catch { /* Local persistence is optional, e.g. in private browsing. */ }
const state={...defaults,...saved,...decodeFilters(location.search)};
state.month=Math.min(Math.floor(state.month),Math.floor(state.horizon));
let rows=[],groups=[],allGroups=[],shown=[],data,days=null,cardLimit=18,map,markers,circle,centerMarker,picking=false,detailId=null,detailTab='history',toastTimer,renderTimer,mapPositionKey;
function persist(){try{localStorage.setItem('sssb-explorer-v1',JSON.stringify({filters:encodeFilters(state),favorites:state.favorites,compare:state.compare}));}catch{}}
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,4000);}
function mutate(changes){Object.assign(state,changes);cardLimit=18;render();persist();}
function schedule(changes){Object.assign(state,changes);clearTimeout(renderTimer);renderTimer=setTimeout(()=>{cardLimit=18;render();persist();},180);}
function sourceLabel(e){return !e?'Historik saknas':e.basis==='observed'?`Observerat: ${monthName(e.month+'-01')}`:e.basis==='seasonal'?`Säsongsunderlag: ${monthName(e.source+'-01')}`:'Uppskattning · månadshistorik saknas';}
function size(g){return Number.isFinite(g.sizeMin)?`${num(g.sizeMin)}${g.sizeMin!==g.sizeMax?'–'+num(g.sizeMax):''} m²`:'Yta okänd';}
function rent(g){return g.rentMin==null?'Hyra saknas':`${num(g.rentMin)}${g.rentMin!==g.rentMax?'–'+num(g.rentMax):''} kr/mån`;}
function image(g,cls=''){return g.photo?`<img class="${cls}" src="${esc(url(g.photo))}" alt="${esc(g.photoCaption)}" loading="lazy">`:'';}
function groupById(id){return groups.find(g=>g.id===id)||allGroups.find(g=>g.id===id);}
function planCopy(p){return p.estimate?`<span class="estimate-number">${num(p.estimate.median)} ködagar</span> i median <span class="muted">· ${p.estimate.n} obs.</span>`:'Ingen användbar köhistorik ännu';}
function card(g){
  const p=g.plan||plan(g,today,state.month,days),fav=state.favorites.includes(g.id),checked=state.compare.includes(g.id);
  const opening=g.opening||firstOpening(g,today,days,state.horizon,state.moveBy);
  return `<article class="housing-card"><div class="card-image">${image(g)}<span class="image-label">${g.photo?'Områdesbild / annonsexempel':'Bild saknas'}</span><button class="favorite" data-favorite="${esc(g.id)}" aria-pressed="${fav}" aria-label="${fav?'Ta bort':'Spara'} ${esc(g.name)} i ${esc(g.area)} som favorit">${fav?'♥':'♡'}</button></div><div class="card-content"><p class="location">${esc(g.district)} · ${esc(g.area)}</p><h3>${esc(g.name)}</h3><div class="specs"><span>${size(g)}</span><span class="rent">${rent(g)}</span></div>${g.contract==='limited'?'<p class="limited">Tidsbegränsat / särskilda avtalsvillkor</p>':''}<div class="card-plan"><span class="badge ${p.level}">${esc(p.label)}</span><p>${planCopy(p)}</p><p class="small muted">${sourceLabel(p.estimate)}</p>${days!=null&&opening&&opening.offset>state.month?`<p>Sök från <strong>${monthName(opening.date)}</strong> enligt modellen</p>`:''}<p class="muted">${p.moveDate?`Uppskattad inflyttning: ${monthName(p.moveDate)}`:'Inflyttningshistorik saknas'}</p></div><div class="card-actions"><label class="check"><input type="checkbox" data-compare="${esc(g.id)}" ${checked?'checked':''}>Jämför</label><button data-detail="${esc(g.id)}">Utforska →</button></div></div></article>`;
}
function render(){
  days=queueDays(state.profile,today);
  groups=buildGroups(rows,state);
  shown=visibleGroups(groups,state,today,days);
  syncControls();renderTimeline();renderCards();renderFilterChips();renderMap();
  $('favorite-count').textContent=state.favorites.length;
  $('favorites-toggle').setAttribute('aria-pressed',state.onlyFavorites);
  $('map-toggle').setAttribute('aria-pressed',state.showMap);
  $('map-panel').hidden=!state.showMap;
  $('explorer-layout').classList.toggle('without-map',!state.showMap);
  for(const view of ['explore','available','statistics'])$(`${view}-view`).hidden=state.view!==view;
  document.querySelectorAll('[data-view]').forEach(b=>{const on=b.dataset.view===state.view;b.classList.toggle('selected',on);if(on)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('compare-bar').hidden=state.compare.length===0;
  $('compare-label').textContent=`${state.compare.length} av 3 valda`;
  $('compare-open').disabled=state.compare.length<2;
  if(state.view==='available')renderAvailable();
  if(state.view==='statistics')renderStatistics();
}
function syncControls(){
  const values={'search':state.query,'horizon':state.horizon,'rent-max':state.rentMax,'size-min':state.sizeMin,'size-max':state.sizeMax,'floor':state.floor,'move-by':state.moveBy,'sort':state.sort,'radius':state.radiusKm,'queue-days':days};
  for(const [id,value]of Object.entries(values))if(document.activeElement!==$(id))$(id).value=value??'';
  for(const [id,key]of [['elevator','elevator'],['exclude-limited','excludeLimited'],['reachable-only','reachableOnly']])$(id).checked=state[key];
  $('reachable-only').disabled=days==null;
  document.querySelectorAll('[data-category]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.category===state.category));
  document.querySelectorAll('[data-district]').forEach(b=>{if(b.type==='checkbox')b.checked=state.districts.includes(b.dataset.district);else b.setAttribute('aria-pressed',state.districts.includes(b.dataset.district));});
  $('district-summary').textContent=state.districts.length?`Områden (${state.districts.length})`:'Områden';
  const count=['rentMax','sizeMin','sizeMax'].filter(k=>state[k]!=null).length+['elevator','excludeLimited','moveBy'].filter(k=>state[k]).length+(state.floor!=='all');
  $('filter-summary').textContent=count?`Fler filter (${count})`:'Fler filter';
}
function renderTimeline(){
  const cohort=state.onlyFavorites?groups.filter(g=>state.favorites.includes(g.id)):groups;
  const t=timeline(cohort,today,days,state.horizon,state.moveBy),max=Math.max(1,...t.map(m=>m.count));
  $('timeline').innerHTML=t.map(m=>`<button class="month ${m.offset===state.month?'selected':''}" data-month="${m.offset}" aria-pressed="${m.offset===state.month}" aria-label="Sök ${monthName(m.date)}, ${days==null?'ange ködagar':m.count+' typer når typisk nivå'}"><span class="month-name">${m.offset===0?'Nu · ':''}${monthName(m.date)}</span><strong>${days==null?'–':m.count}</strong><small>${days==null?'ange ködagar':'bostadstyper'}</small><small class="new">${days==null?'&nbsp;':m.offset===0?'inom din nivå':m.newCount?'+'+m.newCount+' nya möjligheter':'inga nya typer'}</small><span class="month-track"><i style="width:${100*m.count/max}%"></i></span></button>`).join('');
  const selected=t[state.month];
  $('timeline-context').textContent=days==null?'Ange ködagar och välj när du vill söka.':`Sök ${state.month?dateName(selected.date):'idag'} · ${num(days+ordinal(selected.date)-ordinal(today))} egna ködagar`;
  if(days==null){$('planning-insight').innerHTML='Se vilka hem dina ködagar kan öppna.<small>Jämför att söka nu med att vänta. Spara favoriter för att hitta rätt tid att flytta.</small>';return;}
  const next=t[1],favorites=cohort.filter(g=>state.favorites.includes(g.id));
  const favoriteOpenings=favorites.map(g=>({g,o:firstOpening(g,today,days,state.horizon,state.moveBy)})).filter(x=>x.o&&x.o.offset>0).sort((a,b)=>a.o.offset-b.o.offset);
  const recommendation=favoriteOpenings[0];
  $('planning-insight').innerHTML=`<strong>${next?.newCount?`Söker du nästa månad öppnas ${next.newCount} nya bostadstyper.`:`${t[0].count} bostadstyper når typisk nivå redan nu.`}</strong><small>${recommendation?`Din favorit ${esc(recommendation.g.name)} i ${esc(recommendation.g.area)} når typisk nivå i ${monthName(recommendation.o.date)}.`:`${next?.newCount?'': 'Nästa månad öppnas inga nya typer med dina filter. '}Prognosen upprepar observerad säsong; tillgängliga annonser kan variera.`}</small>`;
}
function renderCards(){
  $('result-title').textContent=state.onlyFavorites?'Dina sparade bostadstyper':'Utforska bostadstyper';
  $('result-count').textContent=`${shown.length} typer · ${new Set(shown.flatMap(g=>g.rows.map(r=>r.objektNr))).size} kända bostäder · sökmånad ${monthName(plan({months:[],closed:[],leadDays:null},today,state.month,days).date)}`;
  $('cards').innerHTML=shown.length?shown.slice(0,cardLimit).map(card).join(''):`<div class="empty"><strong>${state.onlyFavorites?'Inga favoriter matchar just nu':'Inga bostadstyper matchar'}</strong>${state.onlyFavorites?'Spara bostäder med hjärtat eller ändra dina filter.':'Prova större radie, lägre våning eller färre filter. Saknad information räknas inte som en match.'}</div>`;
  $('show-more').hidden=shown.length<=cardLimit;
}
function renderFilterChips(){
  const chips=[];
  if(state.area)chips.push(['area',state.area]);
  if(state.radiusCenter)chips.push(['radiusCenter',`${state.radiusKm} km från vald punkt`]);
  if(state.query)chips.push(['query',state.query]);
  if(state.category!=='all')chips.push(['category',{studio:'Ettor',apartment:'Lägenheter',room:'Rum'}[state.category]||state.category]);
  if(state.rentMax!=null)chips.push(['rentMax',`Max ${num(state.rentMax)} kr`]);
  if(state.sizeMin!=null)chips.push(['sizeMin',`Min ${state.sizeMin} m²`]);
  if(state.sizeMax!=null)chips.push(['sizeMax',`Max ${state.sizeMax} m²`]);
  if(state.floor!=='all')chips.push(['floor',$('floor').selectedOptions[0]?.textContent||'Våningsfilter']);
  if(state.elevator)chips.push(['elevator','Hiss']);
  if(state.excludeLimited)chips.push(['excludeLimited','Utan känd tidsbegränsning']);
  if(state.moveBy)chips.push(['moveBy',`Flytta senast ${dateName(state.moveBy)}`]);
  $('active-filters').innerHTML=chips.map(([k,v])=>`<button data-clear="${k}">${esc(v)} ×</button>`).join('')+state.districts.map(d=>`<button data-district="${esc(d)}">${esc(d)} ×</button>`).join('');
}
function initMap(){
  if(map||!state.showMap||state.view!=='explore')return;
  if(!globalThis.L){$('map').textContent='Kartan kunde inte laddas. Du kan fortfarande välja områden i filtret.';return;}
  map=L.map('map',{scrollWheelZoom:false}).setView([59.348,18.035],11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
  markers=L.layerGroup().addTo(map);
  map.on('click',e=>{if(!picking)return;picking=false;$('pick-radius').setAttribute('aria-pressed','false');$('pick-radius').textContent='Ändra mittpunkt';mutate({radiusCenter:{lat:e.latlng.lat,lon:e.latlng.lng}});});
}
function renderMap(){
  if(!state.showMap||state.view!=='explore')return;
  // Reveal the panel before Leaflet measures it (e.g. after the mobile toggle).
  $('map-panel').hidden=false;$('explore-view').hidden=false;initMap();if(!map)return;
  markers.clearLayers();const buildings=new Map();
  for(const g of shown)for(const r of g.buildings){const key=r.buildingId||r.street;const item=buildings.get(key)||{r,types:[],reachable:false};item.types.push(g.id);item.reachable||=g.plan.reachable;buildings.set(key,item);}
  for(const {r,types,reachable}of buildings.values()){
    L.circleMarker([r.lat,r.lon],{radius:7,weight:2,color:'#fffdf9',fillColor:reachable?'#294e3e':'#a47d56',fillOpacity:.9,bubblingMouseEvents:false}).addTo(markers)
      .bindTooltip(`${esc(r.district)} · ${esc(r.omrade)}<br>${esc(r.street)}<br>${new Set(types).size} typer${days!=null&&reachable?' · minst en når typisk nivå':''}`)
      .on('click',e=>{if(picking){picking=false;$('pick-radius').setAttribute('aria-pressed','false');mutate({radiusCenter:{lat:e.latlng.lat,lon:e.latlng.lng}});}else mutate({area:state.area===r.omrade?'':r.omrade});});
  }
  if(circle)map.removeLayer(circle);if(centerMarker)map.removeLayer(centerMarker);
  if(state.radiusCenter){circle=L.circle([state.radiusCenter.lat,state.radiusCenter.lon],{radius:state.radiusKm*1000,color:'#294e3e',weight:2,fillOpacity:.07}).addTo(map);centerMarker=L.circleMarker([state.radiusCenter.lat,state.radiusCenter.lon],{radius:4,color:'#a84c37',fillOpacity:1}).addTo(map);}
  $('map-note').textContent=picking?'Klicka på kartan för att välja mittpunkt.':'Klicka på en markör för att välja SSSB-område. Grönt: minst en typ når din nivå. Positionerna är ungefärliga; radien mäts fågelvägen.';
  const positionKey=JSON.stringify([state.area,state.districts,state.query,state.radiusCenter,state.radiusKm]);
  requestAnimationFrame(()=>{
    map.invalidateSize();
    if(positionKey!==mapPositionKey){
      if(state.radiusCenter&&circle)map.fitBounds(circle.getBounds(),{padding:[20,20],maxZoom:14});
      else if(buildings.size)map.fitBounds([...buildings.values()].map(({r})=>[r.lat,r.lon]),{padding:[24,24],maxZoom:14});
      mapPositionKey=positionKey;
    }
  });
}
function renderAvailable(){
  const active=rows.filter(r=>!r.closed&&matches(r,state)&&r.deadline&&r.deadline>stockholmNow()).sort((a,b)=>a.deadline.localeCompare(b.deadline));
  $('available-count').textContent=`${active.length} annonser matchar dina filter`;
  $('available-cards').innerHTML=active.length?active.map(r=>`<article class="housing-card"><div class="card-image">${r.bilder?.[0]?.fil?`<img src="${esc(url(r.bilder[0].fil))}" alt="Områdesbild från ${esc(r.omrade)}" loading="lazy">`:''}</div><div class="card-content"><p class="location">${esc(r.district)} · ${esc(r.omrade)}</p><h3>${esc(r.adress)}</h3><p class="specs">${esc(r.typ)} · ${num(r.yta)} m² · ${num(r.rentNum)} kr/mån</p><div class="card-plan"><p><strong>${num(r.kodagar)} ködagar</strong> hos köledaren · ${num(r.antalSokande)} sökande</p><p>Ansök senast ${dateName(r.deadline)} kl. ${esc(r.deadline.slice(11,16))}</p><p>Inflyttning ${dateName(r.inflyttningDatum)}</p>${r.contractType==='limited'?'<p class="limited">Särskilda avtalsvillkor</p>':''}</div><div class="card-actions"><button data-detail="${esc(r.archetypeId)}">Se bostadstyp</button><a href="${esc(url(r.detaljUrl))}" target="_blank" rel="noopener">SSSB ↗</a></div></div></article>`).join(''):'<div class="empty"><strong>Inga öppna annonser matchar</strong>Utforska bostadstyperna för att planera nästa steg, eller ändra dina filter.</div>';
}
function renderStatistics(){
  const closed=rows.filter(r=>r.closed&&Number.isFinite(r.kodagar));
  const stats=[[allGroups.length,'observerade bostadstyper'],[new Set(rows.map(r=>r.objektNr)).size,'kända enskilda bostäder'],[closed.length,'avslutade köobservationer'],[new Set(closed.map(r=>r.deadline?.slice(0,7))).size,'månader med observationer']];
  $('data-overview').innerHTML=stats.map(([n,l])=>`<div class="data-stat"><strong>${num(n)}</strong><span>${l}</span></div>`).join('');
  $('archive-count').textContent=`(${rows.length} annonser, alla filter borttagna)`;
  if($('archive').open)renderArchive();
}
function renderArchive(){
  $('archive-rows').innerHTML=[...rows].sort((a,b)=>(b.deadline||'').localeCompare(a.deadline||'')).map(r=>`<tr><td>${esc(r.adress)}</td><td>${esc(r.district)} · ${esc(r.omrade)}</td><td>${esc(r.typ)} / ${num(r.yta)} m²</td><td>${num(r.rentNum)}</td><td>${num(r.kodagar)}${r.closed?'':' (pågår)'}</td><td>${r.sekunderForeDeadline==null?'Okänt':r.sekunderForeDeadline<0?'Efter deadline':r.sekunderForeDeadline<3600?`${num(r.sekunderForeDeadline/60)} min`:`${num(r.sekunderForeDeadline/3600)} tim`}</td><td>${esc(r.deadline?.slice(0,10))}</td></tr>`).join('');
}
function openDetail(id){
  const g=groupById(id);if(!g)return;detailId=id;detailTab='history';renderDetail(g);$('detail-dialog').showModal();
}
function renderDetail(g){
  const p=plan(g,today,state.month,days),opening=firstOpening(g,today,days,state.horizon,state.moveBy),sample=g.sample;
  $('detail-content').innerHTML=`<div class="dialog-heading"><div><p class="eyebrow">${esc(g.district)} · ${esc(g.area)}</p><h2 id="detail-title">${esc(g.name)} · ${size(g)}</h2></div><button class="close" data-close="detail-dialog" aria-label="Stäng bostad">×</button></div><div class="detail-top"><figure class="detail-photo">${image(g)}<figcaption>${esc(g.photoCaption)}. Annonsexempel, inte nödvändigtvis din framtida bostad.</figcaption></figure><div class="detail-facts"><div><small>Observerad hyra</small><strong>${rent(g)}</strong></div><div><small>Kända bostäder av typen</small><strong>${g.unitCount}</strong></div><div><small>Avslutade observationer</small><strong>${g.n}</strong></div><div><small>Öppna, kända bostäder</small><strong>${g.active.length}</strong></div><div class="full"><small>Avtalsvillkor</small><p class="small">${g.contract==='limited'?esc(sample.contractNote||'Särskilda avtalsvillkor anges i annonsen. Kontrollera villkoren hos SSSB.'):'Ingen tidsbegränsning identifierad i de insamlade annonstexterna. Kontrollera alltid den aktuella annonsen.'}</p></div></div></div><div class="detail-plan"><strong>${days==null?'Ange dina ködagar för en personlig flyttplan':opening?`Tidigaste sökmånad inom din plan: ${monthName(opening.date)}`:'Når inte typisk nivå inom din valda plan'}</strong><p>${days==null?'Historiken nedan visar konkurrensen för den här typen.':opening?`${num(opening.days)} egna dagar mot ${num(opening.estimate.median)} i historisk median. ${opening.moveDate?'Uppskattad inflyttning '+dateName(opening.moveDate)+'.':''}`:'Prova längre tidshorisont eller jämför en annan bostadstyp.'}</p><p>${sourceLabel(opening?.estimate||p.estimate)}. ${g.leadDays==null?'Inflyttningshistorik saknas.':`Typisk tid från deadline till inflyttning: ${g.leadDays} dagar (${g.leadN} annonser).`}</p></div><section class="chart-section"><div class="chart-header"><h3>Konkurrensen över året</h3><div class="chart-tabs"><button data-chart="history" aria-pressed="true">Observerad historik</button><button data-chart="future" aria-pressed="false">Din prognos</button></div></div><div id="detail-chart" class="chart-wrap"></div><div class="chart-legend"><span class="legend-key">Median</span><span class="legend-key range">Mittspann 25–75 %</span><span class="legend-key personal">Dina ködagar</span><span class="legend-key pooled">Säsongsunderlag saknas</span></div><p id="chart-note" class="chart-note"></p></section><div class="detail-links">${sample.planlosning?`<button id="show-plan">Visa exempel på planlösning</button><a href="${esc(url(sample.planlosning))}" target="_blank" rel="noopener">Öppna PDF ↗</a>`:'<span class="small muted">Ingen sparad planlösning.</span>'}${sample.areaSource?`<a href="${esc(url(sample.areaSource))}" target="_blank" rel="noopener">Om ${esc(g.area)} hos SSSB ↗</a>`:''}<button data-favorite="${esc(g.id)}" class="quiet">${state.favorites.includes(g.id)?'♥ Sparad favorit':'♡ Spara favorit'}</button></div><div id="plan-container" hidden></div><section class="observation-list"><h3>Exempel ur underlaget</h3><p class="small muted">${g.curated?'Namngiven bostadstyp':'Automatisk gruppering efter område, rumstyp och yta'}. ${groups.some(x=>x.id===g.id)?'Dina bostadsfilter gäller även här.':'Visar hela typen eftersom den ligger utanför dina aktuella filter.'} Olika planlösningar kan förekomma.</p>${g.rows.slice(0,8).map(r=>`<div class="observation-row"><span>${esc(r.adress)} · våning ${esc(r.vaning)}<br><span class="muted">${num(r.rentNum)} kr/mån · ${dateName(r.deadline)}</span></span><span>${num(r.kodagar)} ködagar${r.closed?'':' · pågår'}${r.planlosning?`<br><a href="${esc(url(r.planlosning))}" target="_blank" rel="noopener">Denna bostads ritning ↗</a>`:''}</span></div>`).join('')}</section>`;
  renderChart(g);
}
function renderChart(g){
  const future=detailTab==='future';
  const entries=future?Array.from({length:state.horizon+1},(_,i)=>{const p=plan(g,today,i,days);return {month:p.date.slice(0,7),...p.estimate,personal:p.days};}):g.months.map(m=>({...m,personal:days,basis:'observed'}));
  document.querySelectorAll('[data-chart]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.chart===detailTab));
  if(!entries.length){$('detail-chart').innerHTML='<p class="empty">Ingen avslutad köhistorik för den här typen med dessa filter.</p>';return;}
  const width=Math.max(620,entries.length*66),height=295,left=48,right=15,top=22,bottom=54,plotH=height-top-bottom,step=(width-left-right)/entries.length;
  const ceiling=Math.max(100,...entries.flatMap(e=>[e.q75||0,e.median||0,e.personal||0]))*1.12;
  const y=n=>top+plotH*(1-n/ceiling),x=i=>left+step*(i+.5),bar=Math.min(30,step*.5);
  const grid=Array.from({length:5},(_,i)=>{const n=ceiling*i/4;return `<line x1="${left}" y1="${y(n)}" x2="${width-right}" y2="${y(n)}" stroke="#dcded5"/><text x="${left-9}" y="${y(n)+4}" text-anchor="end" font-size="12" fill="#657067">${num(n)}</text>`;}).join('');
  const bars=entries.map((e,i)=>`<g><title>${monthName(e.month+'-01')}: ${e.n?`${num(e.median)} dagar i median, mittspann ${num(e.q25)}–${num(e.q75)}, ${e.n} observationer. ${sourceLabel(e)}`:'Historik saknas'}</title>${e.n?`<rect x="${x(i)-bar/2}" y="${y(e.median)}" width="${bar}" height="${Math.max(1,y(0)-y(e.median))}" fill="${e.basis==='pooled'?'url(#pooled)':'#294e3e'}" rx="2"/><rect x="${x(i)-bar/2-4}" y="${y(e.q75)}" width="${bar+8}" height="${Math.max(2,y(e.q25)-y(e.q75))}" fill="#c0ccbb" opacity=".65"/><line x1="${x(i)-bar/2-5}" y1="${y(e.median)}" x2="${x(i)+bar/2+5}" y2="${y(e.median)}" stroke="#294e3e" stroke-width="3"/><text x="${x(i)}" y="${Math.max(14,y(e.q75)-7)}" text-anchor="middle" font-size="12" fill="#252b27">${num(e.median)}</text>`:`<text x="${x(i)}" y="${y(0)-8}" text-anchor="middle" font-size="12">–</text>`}<text x="${x(i)}" y="${height-30}" text-anchor="middle" font-size="12" fill="#252b27">${shortMonths[Number(e.month.slice(5,7))-1]}</text><text x="${x(i)}" y="${height-13}" text-anchor="middle" font-size="11" fill="#657067">${future?e.month.slice(0,4):`n=${e.n}`}</text></g>`).join('');
  const points=entries.map((e,i)=>e.personal==null?null:`${x(i)},${y(e.personal)}`).filter(Boolean);
  const line=points.length?`<polyline points="${points.join(' ')}" fill="none" stroke="#a84c37" stroke-width="2.5"/>${entries.map((e,i)=>e.personal==null?'':`<circle cx="${x(i)}" cy="${y(e.personal)}" r="3" fill="#a84c37"><title>${num(e.personal)} egna ködagar</title></circle>`).join('')}`:'';
  $('detail-chart').innerHTML=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${future?'Prognos med dina växande ködagar':'Observerade ködagar per månad'}"><defs><pattern id="pooled" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)"><rect width="6" height="6" fill="#f0e9d5"/><line x1="0" y1="0" x2="0" y2="6" stroke="#b7ad91" stroke-width="3"/></pattern></defs>${grid}${bars}${line}</svg>`;
  const measured=g.n?`${g.nearDeadline} av ${g.n} observationer gjordes högst fem minuter före deadline. ${g.noApplicants} saknade sökande.`:'';
  $('chart-note').textContent=(future?'Samma observerade kalendermånad återanvänds. Streckade staplar använder samlad historik eftersom månadsunderlag saknas. Egna dagar räknas till den 15:e i framtida månader. ':'Staplarna visar den senast observerade köledaren i avslutade annonser. Den röda linjen visar dina ködagar idag som jämförelse. År: '+[...new Set(g.months.map(m=>m.month.slice(0,4)))].join(', ')+'. ')+measured+' Få observationer och tidiga mätningar ger ett svagare underlag. Mittspannet är inte ett konfidensintervall.';
}
function openCompare(){
  const selected=state.compare.map(groupById).filter(Boolean);
  $('compare-content').innerHTML=`<p class="small muted" style="margin-bottom:20px">Jämförelsen använder dina filter där de matchar; sparade typer utanför filtren visas med hela sitt underlag. Siffrorna beskriver historisk konkurrens, inte en garanterad tilldelning.</p><div class="compare-grid">${selected.map(g=>{const p=plan(g,today,state.month,days),opening=firstOpening(g,today,days,state.horizon,state.moveBy);return `<article class="compare-column">${image(g)}<p class="location">${esc(g.district)} · ${esc(g.area)}</p><h3>${esc(g.name)} · ${size(g)}</h3><dl><dt>Observerad hyra</dt><dd>${rent(g)}</dd><dt>Tidigaste sökmånad i din plan</dt><dd>${days==null?'Ange dina ködagar':opening?monthName(opening.date):'Inte inom vald period'}</dd><dt>Uppskattad inflyttning då</dt><dd>${opening?.moveDate?dateName(opening.moveDate):'Okänd'}</dd><dt>Nivå i vald sökmånad</dt><dd>${p.estimate?num(p.estimate.median)+' dagar':'Historik saknas'}</dd><dt>Underlag</dt><dd class="small">${sourceLabel(p.estimate)} · ${p.estimate?.n||0} obs.</dd></dl><div style="margin-top:18px">${Array.from({length:state.horizon+1},(_,i)=>{const m=plan(g,today,i,days);return `<div class="compare-month ${m.reachable?'yes':''}"><span>${monthName(m.date)}${m.estimate?.basis==='pooled'?' *':''}</span><span>${!m.estimate?'Historik saknas':days==null?num(m.estimate.median)+' dagar':m.reachable?'✓ når median':'– under median'}</span></div>`;}).join('')}</div><p class="small muted">* Samlad historik; säsongsunderlag saknas.</p><button class="text-button" data-compare-detail="${esc(g.id)}">Utforska bostadstyp →</button></article>`;}).join('')}</div>`;
  $('compare-dialog').showModal();
}
function toggleFavorite(id){state.favorites=state.favorites.includes(id)?state.favorites.filter(x=>x!==id):[...state.favorites,id];render();persist();if($('detail-dialog').open&&detailId===id){const activeTab=detailTab;renderDetail(groupById(id));detailTab=activeTab;renderChart(groupById(id));}}
function toggleDistrict(district){mutate({districts:state.districts.includes(district)?state.districts.filter(x=>x!==district):[...state.districts,district]});}

document.addEventListener('click',event=>{
  const b=event.target.closest('button,a[data-action]');if(!b)return;
  if(b.dataset.view){mutate({view:b.dataset.view});return;}
  if(b.dataset.category){mutate({category:b.dataset.category});return;}
  if(b.dataset.month!=null){mutate({month:Number(b.dataset.month)});return;}
  if(b.dataset.detail){openDetail(b.dataset.detail);return;}
  if(b.dataset.compareDetail){$('compare-dialog').close();openDetail(b.dataset.compareDetail);return;}
  if(b.dataset.favorite){toggleFavorite(b.dataset.favorite);return;}
  if(b.dataset.close){$(b.dataset.close).close();return;}
  if(b.dataset.chart){detailTab=b.dataset.chart;renderChart(groupById(detailId));return;}
  if(b.dataset.district){toggleDistrict(b.dataset.district);return;}
  if(b.dataset.clear){const key=b.dataset.clear;mutate({[key]:defaults[key]});return;}
  if(b.id==='show-plan'){
    const box=$('plan-container'),g=groupById(detailId);box.hidden=!box.hidden;
    if(!box.hidden&&!box.firstChild)box.innerHTML=`<p class="small muted">Planlösning för ${esc(g.sample.adress)}. Andra bostäder av typen kan ha en annan plan.</p><iframe class="plan-frame" title="Exempel på planlösning" src="${esc(url(g.sample.planlosning))}"></iframe>`;
    b.textContent=box.hidden?'Visa exempel på planlösning':'Dölj planlösning';
  }
});
document.addEventListener('change',e=>{
  const el=e.target;
  if(el.dataset.district){toggleDistrict(el.dataset.district);return;}
  if(el.dataset.compare){
    if(el.checked&&state.compare.length>=3){el.checked=false;toast('Du kan jämföra högst tre bostadstyper åt gången.');return;}
    state.compare=el.checked?[...state.compare,el.dataset.compare]:state.compare.filter(id=>id!==el.dataset.compare);render();persist();
  }
});
$('queue-days').addEventListener('input',e=>schedule({profile:{days:e.target.value===''?null:Math.min(30000,Math.max(0,Math.floor(Number(e.target.value)))),asOf:today}}));
$('search').addEventListener('input',e=>schedule({query:e.target.value}));
for(const [id,key] of [['rent-max','rentMax'],['size-min','sizeMin'],['size-max','sizeMax']])$(id).addEventListener('input',e=>schedule({[key]:e.target.value===''?null:Math.max(0,Number(e.target.value))}));
for(const [id,key] of [['floor','floor'],['sort','sort'],['move-by','moveBy']])$(id).addEventListener('change',e=>mutate({[key]:e.target.value}));
for(const [id,key] of [['elevator','elevator'],['exclude-limited','excludeLimited'],['reachable-only','reachableOnly']])$(id).addEventListener('change',e=>mutate({[key]:e.target.checked}));
$('horizon').addEventListener('change',e=>mutate({horizon:Number(e.target.value),month:Math.min(state.month,Number(e.target.value))}));
$('radius').addEventListener('change',e=>mutate({radiusKm:Number(e.target.value)}));
$('favorites-toggle').addEventListener('click',()=>mutate({onlyFavorites:!state.onlyFavorites}));
$('map-toggle').addEventListener('click',()=>mutate({showMap:!state.showMap}));
$('pick-radius').addEventListener('click',()=>{picking=!picking;$('pick-radius').setAttribute('aria-pressed',picking);$('pick-radius').textContent=picking?'Klicka på kartan…':'Välj mittpunkt';renderMap();});
$('map-reset').addEventListener('click',()=>{picking=false;$('pick-radius').setAttribute('aria-pressed','false');mutate({radiusCenter:null,area:'',districts:[]});if(map)map.setView([59.348,18.035],11);});
$('clear-districts').addEventListener('click',()=>mutate({districts:[]}));
$('reset-filters').addEventListener('click',()=>{const reset={};for(const k of ['query','category','districts','area','rentMax','sizeMin','sizeMax','floor','elevator','excludeLimited','moveBy','radiusCenter','reachableOnly'])reset[k]=defaults[k];mutate(reset);});
$('show-more').addEventListener('click',()=>{cardLimit+=18;renderCards();});
$('compare-clear').addEventListener('click',()=>mutate({compare:[]}));
$('compare-open').addEventListener('click',openCompare);
$('archive').addEventListener('toggle',()=>{if($('archive').open)renderArchive();});
$('share').addEventListener('click',async()=>{
  const link=new URL(location.href);link.search=encodeFilters(state);if($('detail-dialog').open&&detailId)link.searchParams.set('home',detailId);link.hash='';
  try{await navigator.clipboard.writeText(link.href);toast('Länk kopierad — med filter, sökmånad och ködagar.');}catch{prompt('Kopiera länken till din sökning:',link.href);}
});
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
window.addEventListener('popstate',()=>{Object.assign(state,defaults,decodeFilters(location.search));render();});

async function load(){
  try{
    const response=await fetch('data.json',{cache:'no-cache'});if(!response.ok)throw new Error(`HTTP ${response.status}`);
    data=await response.json();if(!Array.isArray(data.listings))throw new Error('Felaktigt dataformat');
    rows=prepareRows(data.listings,today,stockholmNow());allGroups=buildGroups(rows);
    const ids=new Set(allGroups.map(g=>g.id));state.compare=state.compare.filter(id=>ids.has(id));
    const districts=[...new Set(rows.map(r=>r.district))].sort((a,b)=>a.localeCompare(b,'sv'));
    $('district-options').innerHTML=districts.map(d=>`<label class="check"><input type="checkbox" data-district="${esc(d)}">${esc(d)}</label>`).join('');
    $('area-chips').innerHTML=['Bergshamra','Norra Djurgården','Gärdet','Huvudsta','Flemingsberg'].filter(d=>districts.includes(d)).map(d=>`<button data-district="${esc(d)}" aria-pressed="false">${esc(d)}</button>`).join('');
    const last=data.senastInsamlad||data.genererad,stale=last&&(Date.now()-Date.parse(last)>86400000);
    $('freshness').textContent=last?`Senast insamlat ${dateName(last)}${stale?' · underlaget kan ha blivit äldre':''}`:'Insamlingstid saknas';
    $('footer-date').textContent=`Dataexport ${dateName(data.genererad)}`;
    $('load-state').hidden=true;$('app').hidden=false;render();
    const id=new URLSearchParams(location.search).get('home');if(id)openDetail(id);
  }catch(error){$('load-state').textContent=`Bostadsdata kunde inte hämtas. Ladda om sidan för att försöka igen. (${error.message})`;}
}
load();
