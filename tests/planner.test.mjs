import test from 'node:test';
import assert from 'node:assert/strict';
import {quantile,queueDays,searchDate,prepareRows,buildGroups,seasonalEstimate,plan,firstOpening,timeline,matches,encodeFilters,decodeFilters,visibleGroups} from '../docs/planner.mjs';
const today='2026-09-22';
const base={archetypeId:'studio',archetypeName:'Etta',omrade:'Kungshamra',district:'Bergshamra',municipality:'Solna',typ:'1 rum & kök',typOvergripande:'Studentetta',yta:18,hyra:'7 000',floorNum:0,floorKind:'ground',hiss:'Ja',lat:59.38,lon:18.02,status:'stangd',publiceratDatum:'2026-06-01',deadline:'2026-06-15T16:00',inflyttningDatum:'2026-08-01',kodagar:100,antalSokande:3,sekunderForeDeadline:60};
const group = listings => buildGroups(prepareRows(listings,today))[0];
test('median and spread retain zero, ignore missing values',()=>{assert.equal(quantile([0,null,100,NaN],.5),50);assert.equal(quantile([], .5),null);});
test('queue days count calendar days through DST and leap days',()=>{assert.equal(queueDays({days:350,asOf:'2026-03-28'},'2026-03-30'),352);assert.equal(queueDays({days:0,asOf:'2024-02-28'},'2024-03-01'),2);assert.equal(queueDays({days:null},today),null);});
test('future dates use mid-month and cross year boundary',()=>{assert.equal(searchDate('2026-12-31',1),'2027-01-15');assert.equal(searchDate(today,0),today);});
test('catalog deduplicates units while preserving separate advertisement observations',()=>{
 const g=group([{...base,objektNr:'one'},{...base,objektNr:'one',publiceratDatum:'2026-07-01',deadline:'2026-07-15T16:00',hyra:'7 200',kodagar:200},{...base,objektNr:'two',kodagar:0,antalSokande:0}]);
 assert.equal(g.n,3);assert.equal(g.unitCount,2);assert.equal(g.noApplicants,1);assert.equal(g.median,100);assert.equal(g.rentMax,7200);assert.equal(g.months.length,2);
});
test('seasonal forecast repeats latest observed same calendar month, not a trend',()=>{
 const g=group([{...base,objektNr:'a',deadline:'2025-06-15T16:00',kodagar:50},{...base,objektNr:'b',kodagar:100},{...base,objektNr:'c',deadline:'2026-07-15T16:00',kodagar:900}]);
 assert.equal(seasonalEstimate(g,'2027-06-15').median,100);assert.equal(seasonalEstimate(g,'2027-06-15').source,'2026-06');assert.equal(seasonalEstimate(g,'2025-06-15').median,50);
 const missing=seasonalEstimate(g,'2027-01-15');assert.equal(missing.basis,'pooled');assert.equal(missing.median,100);assert.equal(missing.n,3);
 assert.equal(seasonalEstimate(g,'2024-06-15'),null);
});
test('opening can occur, close with next season, then reopen without counting as new',()=>{
 const g=group([{...base,objektNr:'a',deadline:'2025-09-01T16:00',kodagar:100},{...base,objektNr:'b',deadline:'2025-10-01T16:00',kodagar:900},{...base,objektNr:'c',deadline:'2025-11-01T16:00',kodagar:100}]);
 const t=timeline([g],today,150,2);assert.deepEqual(t.map(m=>m.count),[1,0,1]);assert.deepEqual(t.map(m=>m.newCount),[1,0,0]);
});
test('waiting accrues days and move deadline uses historical lead time',()=>{
 const g=group([{...base,objektNr:'a',kodagar:370,deadline:'2026-09-01T16:00',inflyttningDatum:'2026-11-01'}]);
 const opening=firstOpening(g,today,350,12);assert.equal(opening.offset,1);assert.equal(opening.days,373);assert.equal(opening.moveDate,'2026-12-15');
 assert.equal(firstOpening(g,today,350,1,'2026-11-30'),null);assert.equal(plan(g,today,0,null).days,null);
});
test('unknown move-in dates cannot satisfy move-by filter',()=>{
 const g=group([{...base,objektNr:'a',inflyttningDatum:null}]);assert.equal(firstOpening(g,today,1000,12,'2027-12-01'),null);
 assert.equal(visibleGroups([g],{moveBy:'2027-12-01'},today,1000).length,0);
});
test('floor, geography, rent and radius filters are applied to history as well',()=>{
 const r=prepareRows([{...base,objektNr:'a'}],today)[0];assert.equal(matches(r,{floor:'above'}),false);assert.equal(matches(r,{floor:'ground'}),true);assert.equal(matches({...r,floorNum:null},{floor:'above'}),false);
 assert.equal(matches(r,{query:'bergshamra'}),true);assert.equal(matches(r,{query:'solna'}),true);assert.equal(matches(r,{rentMax:6000}),false);assert.equal(matches(r,{radiusCenter:{lat:0,lon:0},radiusKm:5}),false);assert.equal(matches({...r,lat:null},{radiusCenter:{lat:59.38,lon:18.02},radiusKm:5}),false);
 const result=buildGroups(prepareRows([{...base,objektNr:'a',floorNum:0},{...base,objektNr:'b',floorNum:3,kodagar:800}],today),{floor:'high'});assert.equal(result[0].n,1);assert.equal(result[0].median,800);
});
test('active observations are excluded from historical medians',()=>{
 const g=group([{...base,objektNr:'a'},{...base,objektNr:'b',status:'aktiv',deadline:'2027-01-01T16:00',kodagar:9999}]);assert.equal(g.n,1);assert.equal(g.median,100);assert.equal(g.active.length,1);
});
test('URL roundtrip preserves exact seasonal planning inputs and zero queue days',()=>{
 const state={profile:{days:0,asOf:today},month:3,horizon:12,districts:['Bergshamra','Gärdet'],floor:'high',elevator:true,radiusCenter:{lat:59.35,lon:18.05},radiusKm:3};
 const decoded=decodeFilters(encodeFilters(state));assert.equal(decoded.profile.days,0);assert.deepEqual(decoded.districts,state.districts);assert.deepEqual(decoded.radiusCenter,state.radiusCenter);assert.equal(decoded.month,3);
 assert.equal(decodeFilters('?days=-4').profile,undefined);assert.equal(decodeFilters('?radius=999,1,3').radiusCenter,undefined);assert.equal(decodeFilters('?month=999').month,18);
});
test('same-day deadlines use explicit Stockholm wall time rather than browser timezone',()=>{
 const r={...base,status:'aktiv',deadline:'2026-09-22T16:00'};
 assert.equal(prepareRows([r],today,'2026-09-22T15:59')[0].closed,false);
 assert.equal(prepareRows([r],today,'2026-09-22T16:00')[0].closed,true);
});
test('URL settings reject unsupported choices and normalize fractional months',()=>{
 const d=decodeFilters('?category=invalid&floor=invalid&sort=invalid&month=1.5&horizon=0&moveBy=garbage');
 assert.equal(d.category,undefined);assert.equal(d.floor,undefined);assert.equal(d.sort,undefined);assert.equal(d.month,1);assert.equal(d.horizon,12);assert.equal(d.moveBy,undefined);
});
