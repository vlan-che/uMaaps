/* ============================================================
   nav.js — Треки, маршруты, таблицы, векторы, ведение по маршруту
   Версия: 4.1 (объединение треков) + 4.2 (3 режима + ограничения)
           + склонение произношения расстояний
   ============================================================ */
(function(){
'use strict';
const EARTH_R = 6371008.8;
const toRad = d => d*Math.PI/180;
const toDeg = r => r*180/Math.PI;

function normLon(lon){ if(!isFinite(lon)) return lon; return ((lon+180)%360+360)%360-180; }
function normLat(lat){ if(!isFinite(lat)) return lat; return Math.max(-90,Math.min(90,lat)); }
function f6(v){ if(!isFinite(v)) return v; return Number(v.toFixed(6)); }
function f6s(v){ if(!isFinite(v)) return String(v); return String(Number(v.toFixed(6))); }

function bearingBetween(lat1,lon1,lat2,lon2){
  const f1=toRad(lat1), f2=toRad(lat2), dl=toRad(lon2-lon1);
  const y=Math.sin(dl)*Math.cos(f2);
  const x=Math.cos(f1)*Math.sin(f2)-Math.sin(f1)*Math.cos(f2)*Math.cos(dl);
  return (toDeg(Math.atan2(y,x))+360)%360;
}
function distanceBetween(lat1,lon1,lat2,lon2){
  const f1=toRad(lat1), f2=toRad(lat2);
  const df=f2-f1, dl=toRad(lon2-lon1);
  const a=Math.sin(df/2)**2 + Math.cos(f1)*Math.cos(f2)*Math.sin(dl/2)**2;
  return 2*EARTH_R*Math.asin(Math.sqrt(a));
}
function fmtBearingShort(b){ if(b==null||!isFinite(b))return '  --°'; const n=Math.round(((b%360)+360)%360)%360; return String(n).padStart(3,' ')+'°'; }
function fmtDistShort(m){ if(m==null||!isFinite(m))return ' ___,___'; const km=m/1000; let v=km.toFixed(3); v=v.replace('.',','); return v.padStart(7,' '); }
function fmtPair(b,m){ return fmtBearingShort(b)+' '+fmtDistShort(m); }

function projectPointOnSegment(p,a,b){
  const latRef=(a.lat+b.lat)/2;
  const mPerDegLat=111320;
  const mPerDegLon=111320*Math.cos(latRef*Math.PI/180);
  const ax=(a.lon-p.lon)*mPerDegLon, ay=(a.lat-p.lat)*mPerDegLat;
  const bx=(b.lon-p.lon)*mPerDegLon, by=(b.lat-p.lat)*mPerDegLat;
  const dx=bx-ax, dy=by-ay; const len2=dx*dx+dy*dy;
  if(len2===0) return {lat:a.lat, lon:a.lon, t:0, d:Math.hypot(ax,ay)};
  let t=-(ax*dx+ay*dy)/len2; if(t<0)t=0; if(t>1)t=1;
  const cx=ax+dx*t, cy=ay+dy*t;
  return {lat:a.lat+(b.lat-a.lat)*t, lon:a.lon+(b.lon-a.lon)*t, t, d:Math.hypot(cx,cy)};
}
function projectPointOnPolyline(p,line){
  let best={d:Infinity};
  for(let i=0;i<line.length-1;i++){
    const r=projectPointOnSegment(p,line[i],line[i+1]);
    if(r.d<best.d) best={lat:r.lat,lon:r.lon,d:r.d,segIndex:i,t:r.t};
  }
  return best;
}
function findClosestVertex(p,line){
  let best={d:Infinity,idx:-1};
  for(let i=0;i<line.length;i++){
    const d=distanceBetween(p.lat,p.lon,line[i].lat,line[i].lon);
    if(d<best.d) best={d,idx:i};
  }
  return best;
}

/* ============================================================
   4.1: объединение ВСЕХ треков файла в единый path
   ============================================================ */
function extractPathFromGeoJSON(geo){
  const line = [];
  const pts  = [];
  function collect(g){
    if (!g) return;
    if (g.type === 'LineString'){
      for (const c of g.coordinates) line.push({lat:c[1], lon:c[0]});
    } else if (g.type === 'MultiLineString'){
      for (const s of g.coordinates)
        for (const c of s) line.push({lat:c[1], lon:c[0]});
    } else if (g.type === 'GeometryCollection'){
      for (const gg of (g.geometries||[])) collect(gg);
    } else if (g.type === 'Point'){
      pts.push({lat:g.coordinates[1], lon:g.coordinates[0]});
    } else if (g.type === 'MultiPoint'){
      for (const c of g.coordinates) pts.push({lat:c[1], lon:c[0]});
    }
  }
  if (geo.type === 'FeatureCollection'){
    for (const f of geo.features||[]) collect(f.geometry);
  } else if (geo.geometry){
    collect(geo.geometry);
  } else {
    collect(geo);
  }
  return { line, points: pts };
}

function extractSegmentsFromGeoJSON(geo){
  const segs=[];
  if(geo.type==='FeatureCollection'){
    for(const f of geo.features||[]){ const g=f.geometry; if(!g)continue;
      if(g.type==='LineString') segs.push(g.coordinates.map(c=>({lat:c[1],lon:c[0]})));
      else if(g.type==='MultiLineString') for(const s of g.coordinates) segs.push(s.map(c=>({lat:c[1],lon:c[0]})));
    }
  } else if(geo.geometry){
    const g=geo.geometry;
    if(g.type==='LineString') segs.push(g.coordinates.map(c=>({lat:c[1],lon:c[0]})));
    else if(g.type==='MultiLineString') for(const s of g.coordinates) segs.push(s.map(c=>({lat:c[1],lon:c[0]})));
  } else if(geo.type==='LineString'){
    segs.push(geo.coordinates.map(c=>({lat:c[1],lon:c[0]})));
  } else if(geo.type==='MultiLineString'){
    for(const s of geo.coordinates) segs.push(s.map(c=>({lat:c[1],lon:c[0]})));
  }
  return segs;
}

const routeLayersGroup  = L.layerGroup().addTo(map);
const extraLinesGroup   = L.layerGroup().addTo(map);
const segNumLayerGroup  = L.layerGroup().addTo(map);
const trackOverlayGroup = L.layerGroup().addTo(map);

let activeRoute=null, guidance=null;
let linearPoints=[], extendedPoints=[];
let currentDir='forward';
let routeStartMarker=null, routeEndMarker=null;
let segmentId=0;
const segmentBreaks=[];
let segmentPaused=false;

function makeDoubleLine(latlngs,opts){
  opts=opts||{}; const dash=opts.dash||null; const innerW=opts.innerW||3; const haloW=opts.haloW||6;
  return L.layerGroup([
    L.polyline(latlngs,{color:'#ffffff', weight:haloW, opacity:0.9, dashArray:dash}),
    L.polyline(latlngs,{color:'#000000', weight:innerW+2, opacity:0.95, dashArray:dash}),
    L.polyline(latlngs,{color:'#ff9800', weight:innerW, opacity:1, dashArray:dash})
  ]);
}
function makeDoubleRing(latlng,color){
  return L.layerGroup([
    L.circleMarker(latlng,{radius:8,color:'#fff',weight:3,fill:false}),
    L.circleMarker(latlng,{radius:7,color:'#000',weight:3,fill:false}),
    L.circleMarker(latlng,{radius:5,color:color||'#ff9800',weight:2,fill:false})
  ]);
}
function makeDashedDoubleLine(latlngs){ return makeDoubleLine(latlngs,{dash:'8 6',innerW:2,haloW:5}); }
function makeDottedBeam(a,b){
  return L.layerGroup([
    L.polyline([a,b],{color:'#fff',weight:5,dashArray:'2 8',opacity:.95}),
    L.polyline([a,b],{color:'#ff9800',weight:2,dashArray:'2 8',opacity:.95})
  ]);
}
function makeNumberBadge(latlng,num,theme){
  const color = theme==='track' ? {bg:'#000',fg:'#fff',border:'#fff'} : {bg:'#fff',fg:'#000',border:'#000'};
  const text=String(num); const w=Math.max(14,text.length*7+8); const h=16;
  const html='<div style="display:inline-block;background:'+color.bg+';color:'+color.fg+
    ';border:1px solid '+color.border+';border-radius:2px;font-family:monospace;font-weight:bold;'+
    'font-size:11px;line-height:14px;padding:0 4px;white-space:nowrap;text-align:center;">'+text+'</div>';
  return L.marker(latlng,{interactive:false,icon:L.divIcon({className:'seg-badge',html,iconSize:[w,h],iconAnchor:[w/2,h/2]})});
}
function clearRouteLayers(){
  routeLayersGroup.clearLayers(); extraLinesGroup.clearLayers();
  if(routeStartMarker){map.removeLayer(routeStartMarker);routeStartMarker=null;}
  if(routeEndMarker){map.removeLayer(routeEndMarker);routeEndMarker=null;}
  if(routeNavLayer&&routeNavLayer.clearLayers)routeNavLayer.clearLayers();
}
function clearTrackOverlay(){ trackOverlayGroup.clearLayers(); }

/* ============================================================
   МЕНЮ ТРЕКОВ
   ============================================================ */
const trackMenu=document.createElement('div');
trackMenu.className='side-menu left'; trackMenu.id='menu-track';
trackMenu.innerHTML=`
  <div class="menu-header">
    <span class="hdr-title">ЗАПИСЬ ТРЕКА</span>
    <label class="switch" title="Скрыть линию трека"><input type="checkbox" id="sw-track-visible" checked><span class="slider"></span></label>
  </div>
  <div class="menu-row"><span class="name">Период, сек</span><input id="trk-period" type="number" min="1" value="1" style="width:70px;height:26px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;text-align:center;font-family:monospace;font-weight:bold"></div>
  <div class="menu-row"><span class="name">Период, км</span><input id="trk-period-km" type="text" value="0,000" style="width:70px;height:26px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;text-align:center;font-family:monospace;font-weight:bold"></div>
  <div class="menu-row" style="padding-top:2px;padding-bottom:2px"><span class="name">Время:</span><span id="trk-time">00:00:00</span></div>
  <div class="menu-row" style="padding-top:2px;padding-bottom:2px"><span class="name">Путь:</span><span id="trk-dist">0,000 км</span></div>
  <div class="menu-row" style="padding-top:2px;padding-bottom:2px"><span class="name">Точек:</span><span id="trk-pts">0</span></div>
  <button class="menu-btn" id="trk-record" style="font-size:12px; text-align: left"> 🔼 Запись</button>
  <button class="menu-btn" id="trk-pause" disabled style="font-size:12px; text-align: left"> ⏸️ Пауза</button>
  <button class="menu-btn" id="trk-resume" disabled style="font-size:12px; text-align: left"> ⏺️ Продолжить</button>
  <button class="menu-btn" id="trk-stop" disabled style="font-size:12px; text-align: left"> ⏹️ Стоп</button>
  <button class="menu-btn" id="trk-save" disabled style="font-size:12px; font-size:12px; text-align: left"> ☰ Сохранить</button>
  <div style="margin-top:auto"><button class="menu-btn" id="trk-close" style="width:100%">ЗАКРЫТЬ</button></div>
`;
document.getElementById('map-container').appendChild(trackMenu);

const trackState={phase:'idle',segments:[],current:null,startedAt:null,totalDist:0,timer:null,waypoints:[]};
const trackWaypointLayer=L.layerGroup().addTo(map);

document.getElementById('btn-track').addEventListener('click',()=>{
  document.getElementById('menu-track').classList.add('open');
  ['menu-left','menu-right','menu-files','menu-route'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('open');});
});
document.getElementById('trk-close').addEventListener('click',()=>{document.getElementById('menu-track').classList.remove('open');});
document.getElementById('sw-track-visible').addEventListener('change',e=>{
  if(e.target.checked){ if(!map.hasLayer(trackOverlayGroup)) map.addLayer(trackOverlayGroup); }
  else { if(map.hasLayer(trackOverlayGroup)) map.removeLayer(trackOverlayGroup); }
});
function updateTrackButtons(){
  const $=id=>document.getElementById(id);
  $('trk-record').disabled=!(trackState.phase==='idle'||trackState.phase==='saved'||trackState.phase==='stopped');
  $('trk-pause').disabled=trackState.phase!=='recording';
  $('trk-resume').disabled=trackState.phase!=='paused';
  $('trk-stop').disabled=!(trackState.phase==='recording'||trackState.phase==='paused');
  $('trk-save').disabled=trackState.phase!=='stopped';
  ['trk-record','trk-pause','trk-resume','trk-stop','trk-save'].forEach(id=>{$(id).classList.remove('active');});
  if(trackState.phase==='recording')$('trk-record').classList.add('active');
  if(trackState.phase==='paused')$('trk-pause').classList.add('active');
  if(trackState.phase==='stopped')$('trk-stop').classList.add('active');
  if(trackState.phase==='saved')$('trk-save').classList.add('active');
  const SYM={idle:'☰',recording:'🔼',paused:'⏸️',stopped:'⏹️',saved:'☰'};
  const sym=SYM[trackState.phase]||'☰';
  if(window.setTrackButtonSymbol) window.setTrackButtonSymbol(sym);
  else { const btn=document.getElementById('btn-track'); if(btn) btn.textContent=sym; }
}
function startTimer(){
  clearInterval(trackState.timer);
  trackState.timer=setInterval(()=>{
    if(trackState.phase!=='recording'&&trackState.phase!=='paused') return;
    if(!trackState.startedAt) return;
    const sec=Math.floor((Date.now()-trackState.startedAt)/1000);
    const h=String(Math.floor(sec/3600)).padStart(2,'0');
    const m=String(Math.floor(sec%3600/60)).padStart(2,'0');
    const s=String(sec%60).padStart(2,'0');
    document.getElementById('trk-time').textContent=`${h}:${m}:${s}`;
    document.getElementById('trk-dist').textContent=`${(trackState.totalDist/1000).toFixed(3).replace('.',',')} км`;
    let n=0; for(const seg of trackState.segments) n+=seg.length;
    document.getElementById('trk-pts').textContent=n;
  },1000);
}
function parseKmField(){
  const raw=(document.getElementById('trk-period-km').value||'0').replace(',','.');
  const v=parseFloat(raw);
  return (isFinite(v)&&v>0)?v*1000:0;
}
let lastFixTime=0;
function trackFix(pos){
  if(!pos||!pos.coords) return;
  const raw=parseInt(document.getElementById('trk-period').value,10);
  const periodMs=(isFinite(raw)&&raw>=1?raw:1)*1000;
  const now=Date.now();
  if(now-lastFixTime<periodMs) return;
  lastFixTime=now;
  if(trackState.phase!=='recording') return;
  const p={lat:normLat(pos.coords.latitude), lon:normLon(pos.coords.longitude), t:now};
  const minKm=parseKmField();
  if(trackState.current&&trackState.current.length&&minKm>0){
    const prev=trackState.current[trackState.current.length-1];
    const d=distanceBetween(prev.lat,prev.lon,p.lat,p.lon);
    if(d<minKm) return;
  }
  if(!trackState.current){ trackState.current=[p]; trackState.segments.push(trackState.current); }
  else{
    const prev=trackState.current[trackState.current.length-1];
    const d=distanceBetween(prev.lat,prev.lon,p.lat,p.lon);
    if(d<200) trackState.totalDist+=d;
    trackState.current.push(p);
  }
  let n=0; for(const seg of trackState.segments) n+=seg.length;
  document.getElementById('trk-pts').textContent=n;
  document.getElementById('trk-dist').textContent=`${(trackState.totalDist/1000).toFixed(3).replace('.',',')} км`;
  redrawTrackOverlay();
}
function redrawTrackOverlay(){
  clearTrackOverlay();
  if(!trackState.segments.length) return;
  trackState.segments.forEach(seg=>{
    if(seg.length<2) return;
    trackOverlayGroup.addLayer(L.polyline(seg.map(p=>[p.lat,p.lon]),{color:'#ff9800', weight:9, opacity:1}));
  });
  trackState.segments.forEach(seg=>{
    if(seg.length<2) return;
    const coords=seg.map(p=>[p.lat,p.lon]);
    trackOverlayGroup.addLayer(L.polyline(coords,{color:'#ffffff', weight:6, opacity:1}));
    trackOverlayGroup.addLayer(L.polyline(coords,{color:'#000000', weight:4, opacity:1}));
  });
  let counter=1;
  trackState.segments.forEach(seg=>{
    if(!seg.length) return;
    const start=seg[0], end=seg[seg.length-1];
    trackOverlayGroup.addLayer(makeNumberBadge([start.lat,start.lon], counter, 'track'));
    if(seg.length>=2) trackOverlayGroup.addLayer(makeNumberBadge([end.lat,end.lon], counter+1, 'track'));
    counter+=2;
  });
}
document.getElementById('trk-record').addEventListener('click',()=>{
  trackState.phase='recording'; trackState.segments=[]; trackState.current=null;
  trackState.startedAt=Date.now(); trackState.totalDist=0; trackState.waypoints=[];
  trackWaypointLayer.clearLayers(); lastFixTime=0; clearTrackOverlay();
  document.getElementById('trk-time').textContent='00:00:00';
  document.getElementById('trk-dist').textContent='0,000 км';
  document.getElementById('trk-pts').textContent='0';
  startTimer(); updateTrackButtons();
});
document.getElementById('trk-pause').addEventListener('click',()=>{
  trackState.phase='paused'; trackState.current=null;
  redrawTrackOverlay(); updateTrackButtons();
});
document.getElementById('trk-resume').addEventListener('click',()=>{
  trackState.phase='recording'; trackState.current=null; updateTrackButtons();
});
document.getElementById('trk-stop').addEventListener('click',()=>{
  trackState.phase='stopped'; trackState.current=null;
  clearInterval(trackState.timer); redrawTrackOverlay(); updateTrackButtons();
});
document.getElementById('trk-save').addEventListener('click',()=>{
  let total=0; for(const seg of trackState.segments) total+=seg.length;
  if(!total){ if(window.showToast) showToast('нечего сохранять'); return; }
  const stamp=fileStamp(); const baseName=`Трек_${stamp}`;
  downloadBlob(buildTrackGpx(trackState.segments, trackState.waypoints), `${baseName}.gpx`, 'application/gpx+xml');
  downloadBlob(buildTrackKml(trackState.segments, trackState.waypoints), `${baseName}.kml`, 'application/vnd.google-earth.kml+xml');
  if(typeof setInfo==='function') setInfo(`сохранено: ${baseName}.*`);
  trackState.phase='saved'; clearTrackOverlay(); trackWaypointLayer.clearLayers();
  updateTrackButtons(); document.getElementById('menu-track').classList.remove('open');
});
function addTrackWaypointFromDevice(){
  if(trackState.phase!=='recording'&&trackState.phase!=='paused'){
    showToast('WPT добавляется только во время записи'); return;
  }
  const p=(window.NavAPI&&NavAPI.getDevicePos&&NavAPI.getDevicePos())||null;
  if(!p){ showToast('нет данных GPS'); return; }
  const stamp=fileStamp()+'-'+String(new Date().getSeconds()).padStart(2,'0');
  const name=`WPT_${stamp}`;
  trackState.waypoints.push({lat:p.lat, lon:p.lon, name, t:Date.now()});
  trackWaypointLayer.addLayer(
    L.circleMarker([p.lat,p.lon],{radius:6,color:'#000',weight:2,fillColor:'#00c8ff',fillOpacity:1})
      .bindTooltip(name,{permanent:false,direction:'top'})
  );
  showToast(`WPT добавлен: ${name}`);
  setInfo(`WPT: ${name} @ ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`);
}
(function bindTrackLongPress(){
  const btn=document.getElementById('btn-track');
  let timer=null, openedByLong=false;
  function start(){ openedByLong=false; timer=setTimeout(()=>{ openedByLong=true; addTrackWaypointFromDevice(); },700); }
  function cancel(){ clearTimeout(timer); }
  btn.addEventListener('touchstart',start,{passive:true});
  btn.addEventListener('touchend',cancel);
  btn.addEventListener('touchmove',cancel);
  btn.addEventListener('mousedown',start);
  btn.addEventListener('mouseup',cancel);
  btn.addEventListener('mouseleave',cancel);
  btn.addEventListener('click',e=>{ if(openedByLong){ e.stopImmediatePropagation(); e.preventDefault(); openedByLong=false; } },true);
})();
function buildTrackGpx(segments,waypoints){
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<gpx version="1.1" creator="OfflineNavigator" xmlns="http://www.topografix.com/GPX/1/1">'];
  let idx=1;
  for(const seg of segments){
    if(!seg.length) continue;
    const a=seg[0], b=seg[seg.length-1];
    lines.push(`<wpt lat="${f6s(a.lat)}" lon="${f6s(a.lon)}"><name>${idx}</name></wpt>`);
    lines.push(`<trk><name>Segment ${idx}</name><trkseg>`);
    for(const p of seg) lines.push(`<trkpt lat="${f6s(p.lat)}" lon="${f6s(p.lon)}"></trkpt>`);
    lines.push('</trkseg></trk>');
    lines.push(`<wpt lat="${f6s(b.lat)}" lon="${f6s(b.lon)}"><name>${idx+1}</name></wpt>`);
    idx+=2;
  }
  for(const w of waypoints) lines.push(`<wpt lat="${f6s(w.lat)}" lon="${f6s(w.lon)}"><name>${w.name}</name></wpt>`);
  lines.push('</gpx>');
  return lines.join('\n');
}
function buildTrackKml(segments,waypoints){
  const lines=['<?xml version="1.0" encoding="UTF-8"?>','<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'];
  let idx=1;
  for(const seg of segments){
    if(!seg.length) continue;
    lines.push('<Placemark>');
    lines.push(`<name>Segment ${idx}</name>`);
    lines.push('<LineString><coordinates>'+seg.map(p=>`${f6s(p.lon)},${f6s(p.lat)},0`).join(' ')+'</coordinates></LineString>');
    lines.push('</Placemark>');
    const a=seg[0], b=seg[seg.length-1];
    lines.push(`<Placemark><name>${idx}</name><Point><coordinates>${f6s(a.lon)},${f6s(a.lat)},0</coordinates></Point></Placemark>`);
    lines.push(`<Placemark><name>${idx+1}</name><Point><coordinates>${f6s(b.lon)},${f6s(b.lat)},0</coordinates></Point></Placemark>`);
    idx+=2;
  }
  for(const w of waypoints) lines.push(`<Placemark><name>${w.name}</name><Point><coordinates>${f6s(w.lon)},${f6s(w.lat)},0</coordinates></Point></Placemark>`);
  lines.push('</Document></kml>');
  return lines.join('\n');
}

/* ============================================================
   МЕНЮ МАРШРУТА (4.2)
   ============================================================ */
const routeMenu=document.getElementById('menu-route');
routeMenu.innerHTML=`
  <div class="menu-header">
    <span class="hdr-title">МАРШРУТ</span>
    <label class="switch" title="Дополнительные линии и блокировка точек"><input type="checkbox" id="sw-route-extra" checked><span class="slider"></span></label>
  </div>
  <button class="menu-btn dir-btn" data-dir="forward" style="height:42px;font-size:12px">ПРЯМОЙ</button>
  <button class="menu-btn dir-btn" data-dir="reverse" style="height:42px;font-size:12px">ОБРАТНЫЙ</button>
  <button class="menu-btn dir-btn" data-dir="through" style="height:42px;font-size:12px">ПРОМЕЖУТОЧНЫЙ</button>
  <div class="menu-row" id="row-through" style="display:none;flex-direction:column;gap:4px">
    <div style="display:flex;gap:4px;width:100%">
      <input id="r-start" placeholder="start lat, lon" style="flex:1;height:32px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;font-family:monospace;font-size:11px;padding:0 6px">
      <button class="menu-btn" id="r-start-pick" style="flex:0 0 34px;height:32px">нач</button>
    </div>
    <div style="display:flex;gap:4px;width:100%">
      <input id="r-end" placeholder="end lat, lon" style="flex:1;height:32px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;font-family:monospace;font-size:11px;padding:0 6px">
      <button class="menu-btn" id="r-end-pick" style="flex:0 0 34px;height:32px">кон</button>
    </div>
  </div>
  <button class="menu-btn dir-btn" data-dir="extended" style="height:42px;font-size:12px">ДОПОЛНЕННЫЙ</button>
  <button class="menu-btn dir-btn" data-dir="linear" style="height:42px;font-size:12px">КОРРЕКТИРУЕМЫЙ</button>

  <button class="menu-btn" id="btn-route-segment" style="height:38px;font-size:12px">СЕГМЕНТ</button>
  <button class="menu-btn" id="btn-route-undo" style="height:38px;font-size:12px">ОТМЕНИТЬ</button>
  <button class="menu-btn" id="btn-route-save" style="height:38px;font-size:12px">СОХРАНИТЬ</button>

  <div style="display:flex;gap:4px;width:100%">
    <button class="menu-btn" id="btn-route-start" style="flex:1 1 0;height:38px;font-size:12px">ЗАПУСТИТЬ</button>
    <button class="menu-btn" id="btn-route-mode" style="flex:0 0 38px;height:38px;font-size:16px;padding:0;font-weight:bold">🔇</button>
  </div>
  <button class="menu-btn" id="btn-route-stop" style="height:38px;font-size:12px">ЗАВЕРШИТЬ</button>
  <div style="margin-top:auto"><button class="menu-btn" id="btn-close-route2" style="width:100%">ЗАКРЫТЬ</button></div>
`;
document.getElementById('btn-close-route2').addEventListener('click',()=>{ routeMenu.classList.remove('open'); });
document.getElementById('btn-route').addEventListener('click',()=>{
  routeMenu.classList.add('open');
  ['menu-left','menu-right','menu-files','menu-track'].forEach(id=>{const el=document.getElementById(id);if(el)el.classList.remove('open');});
  if(window.setRouteButtonState) window.setRouteButtonState(!!(window.guidanceActive));
});

let routeExtraEnabled=true;
document.getElementById('sw-route-extra').addEventListener('change',e=>{
  routeExtraEnabled=e.target.checked;
  if(routeExtraEnabled){ if(!map.hasLayer(extraLinesGroup)) map.addLayer(extraLinesGroup); }
  else { if(map.hasLayer(extraLinesGroup)) map.removeLayer(extraLinesGroup); }
});

/* ============================================================
   4.2: режим + параметры
   ============================================================ */
let guidanceMode='silent';
let guidanceMinT=0;
let guidanceMinD=0;
let guidanceMinA=0;

let lastSpokenAt=0;
let lastSpokenPos=null;
let lastSpokenCourseDev=0;
let lastDistToRoute=null;
let prevGpsPos=null;
let lastGpsBearing=null;
let lastDeviceHeading=null;
let currentNavIdx=0;

const MODE_SYMBOL={escort:'-С-', navigate:'•Н•', silent:'🔇'};

function resetGuidanceState(){
  lastSpokenAt=0; lastSpokenPos=null; lastSpokenCourseDev=0;
  lastDistToRoute=null; prevGpsPos=null; lastGpsBearing=null;
  lastDeviceHeading=null; currentNavIdx=0;
  _prevGpsPosForBearing=null;
}
function guidanceSetMode(mode){
  if(mode==='escort'||mode==='navigate'||mode==='silent') guidanceMode=mode;
}
function guidanceSetParams(t,d,a){
  guidanceMinT=Math.max(0, Number(t)||0);
  guidanceMinD=Math.max(0, Number(d)||0);
  guidanceMinA=Math.max(0, Number(a)||0);
}
function syncModeButton(){
  const btn=document.getElementById('btn-route-mode');
  if(btn) btn.textContent=MODE_SYMBOL[guidanceMode]||'🔇';
}
window.__guidanceApi={
  setMode: guidanceSetMode,
  setParams: guidanceSetParams,
  getState: ()=>({mode:guidanceMode, minT:guidanceMinT, minD:guidanceMinD, minA:guidanceMinA})
};

const guidancePanel=document.createElement('div');
guidancePanel.id='guidance-panel';
guidancePanel.style.cssText=`
  position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  width:min(90vw,340px); background:rgba(20,20,20,.98);
  border:2px solid #ff9800; border-radius:6px; z-index:1700;
  display:none; flex-direction:column; padding:10px; gap:8px;
  font-family:monospace;
`;
guidancePanel.innerHTML=`
  <div class="menu-title">СПОСОБ ВЕДЕНИЯ</div>
  <div style="display:flex;gap:4px">
    <button class="menu-btn gp-mode" data-mode="escort" style="flex:1;height:36px;font-size:10px">Сопровождение</button>
    <button class="menu-btn gp-mode" data-mode="navigate" style="flex:1;height:36px;font-size:11px">Навигация</button>
    <button class="menu-btn gp-mode" data-mode="silent" style="flex:1;height:36px;font-size:16px">🔇</button>
  </div>
  <div class="menu-row">
    <span class="name">min t (h:m:s)</span>
    <input id="gp-min-t" type="text" value="00:00:00"
      style="width:90px;height:26px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;text-align:center;font-family:monospace;font-weight:bold;font-size:11px">
  </div>
  <div class="menu-row">
    <span class="name">min d (km)</span>
    <input id="gp-min-d" type="text" value="0.000"
      style="width:90px;height:26px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;text-align:center;font-family:monospace;font-weight:bold;font-size:11px">
  </div>
  <div class="menu-row">
    <span class="name">min ° (°,"')</span>
    <input id="gp-min-a" type="text" value="0"
      style="width:90px;height:26px;background:#2b2b2b;color:#ff9800;border:1px solid #ff9800;border-radius:3px;text-align:center;font-family:monospace;font-weight:bold;font-size:11px">
  </div>
  <div style="display:flex;gap:4px">
    <button class="menu-btn" id="gp-apply" style="flex:1;height:34px;font-size:12px">ПРИМЕНИТЬ</button>
    <button class="menu-btn" id="gp-close" style="flex:0 0 90px;height:34px;font-size:11px">ЗАКРЫТЬ</button>
  </div>
`;
document.getElementById('map-container').appendChild(guidancePanel);

function gpSetActiveMode(mode){
  guidancePanel.querySelectorAll('.gp-mode').forEach(b=>{
    b.classList.toggle('active', b.dataset.mode===mode);
  });
}
function formatTimeT(sec){
  const h=String(Math.floor(sec/3600)).padStart(2,'0');
  const m=String(Math.floor(sec%3600/60)).padStart(2,'0');
  const s=String(sec%60).padStart(2,'0');
  return `${h}:${m}:${s}`;
}
function parseTimeT(str){
  const parts=String(str||'').trim().split(':').map(Number);
  if(parts.some(v=>!isFinite(v))) return 0;
  if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2];
  if(parts.length===2) return parts[0]*60+parts[1];
  if(parts.length===1) return parts[0];
  return 0;
}

document.getElementById('btn-route-mode').addEventListener('click',()=>{
  document.getElementById('gp-min-t').value=formatTimeT(guidanceMinT);
  document.getElementById('gp-min-d').value=(guidanceMinD/1000).toFixed(3);
  document.getElementById('gp-min-a').value=String(Math.round(guidanceMinA));
  gpSetActiveMode(guidanceMode);
  guidancePanel.style.display='flex';
});
document.getElementById('gp-close').addEventListener('click',()=>{ guidancePanel.style.display='none'; });

guidancePanel.querySelectorAll('.gp-mode').forEach(b=>{
  b.addEventListener('click',()=>{ gpSetActiveMode(b.dataset.mode); });
});

document.getElementById('gp-apply').addEventListener('click',()=>{
  const activeBtn=guidancePanel.querySelector('.gp-mode.active');
  const mode=activeBtn?activeBtn.dataset.mode:'silent';
  const tStr=document.getElementById('gp-min-t').value;
  const tSec=parseTimeT(tStr);
  const dKm=parseFloat((document.getElementById('gp-min-d').value||'0').replace(',','.'))||0;
  const aDeg=parseFloat((document.getElementById('gp-min-a').value||'0').replace(',','.'))||0;

  guidanceSetMode(mode);
  guidanceSetParams(tSec, dKm*1000, aDeg);
  syncModeButton();

  const modeNames={escort:'сопровождение', navigate:'навигация', silent:'без звука'};
  setInfo(`ведение: ${modeNames[mode]}, min[t]=${formatTimeT(tSec)}, min[d]=${dKm.toFixed(3)}км, min[°]=${aDeg}°`);
  guidancePanel.style.display='none';
});

/* ============================================================
   Направления, точки
   ============================================================ */
function addRoutePointAtCrosshair(){
  if(!routeExtraEnabled){ showToast('добавление точек заблокировано'); return; }
  if(currentDir!=='linear'&&currentDir!=='extended'){ showToast('доступно в КОРРЕКТИРУЕМОМ/ДОПОЛНЕННОМ'); return; }
  if(segmentPaused){ showToast('сегмент закрыт'); return; }
  const c=map.getCenter(); const lat=normLat(c.lat), lon=normLon(c.lng);
  if(currentDir==='linear') linearPoints.push({lat,lon}); else extendedPoints.push({lat,lon});
  buildRoute();
  showToast(`точка добавлена @ ${lat.toFixed(6)}, ${lon.toFixed(6)}`);
}
(function bindRouteLongPress(){
  const btn=document.getElementById('btn-route');
  let timer=null, openedByLong=false;
  function start(){ openedByLong=false; timer=setTimeout(()=>{ openedByLong=true; addRoutePointAtCrosshair(); },700); }
  function cancel(){ clearTimeout(timer); }
  btn.addEventListener('touchstart',start,{passive:true});
  btn.addEventListener('touchend',cancel);
  btn.addEventListener('touchmove',cancel);
  btn.addEventListener('mousedown',start);
  btn.addEventListener('mouseup',cancel);
  btn.addEventListener('mouseleave',cancel);
  btn.addEventListener('click',e=>{ if(openedByLong){ e.stopImmediatePropagation(); e.preventDefault(); openedByLong=false; } },true);
})();
function segmentButtonClick(){
  if(!routeExtraEnabled){ showToast('добавление точек заблокировано'); return; }
  const pointsArr=currentDir==='extended'?extendedPoints:currentDir==='linear'?linearPoints:null;
  if(!pointsArr){ showToast('сегментирование для ЛИНЕЙНОГО/ДОПОЛНЕННОГО'); return; }
  if(!segmentPaused){
    if(pointsArr.length>0){ segmentBreaks.push(pointsArr.length); segmentId++; }
    segmentPaused=true; setInfo(`сегмент ${segmentId+1} закрыт`);
  } else { segmentPaused=false; setInfo(`сегмент ${segmentId+1} — можно ставить точки`); }
  buildRoute();
}
document.getElementById('btn-route-segment').addEventListener('click',segmentButtonClick);
document.getElementById('btn-route-undo').addEventListener('click',()=>{
  if(segmentPaused){ segmentPaused=false; if(segmentBreaks.length){ segmentBreaks.pop(); segmentId=Math.max(0,segmentId-1); } buildRoute(); setInfo('сегментирование отменено'); return; }
  if(currentDir==='linear'&&linearPoints.length){
    linearPoints.pop();
    if(segmentBreaks.length&&segmentBreaks[segmentBreaks.length-1]>=linearPoints.length){ segmentBreaks.pop(); segmentId=Math.max(0,segmentId-1); }
    buildRoute(); setInfo(`корректируемый: ${linearPoints.length} точек`); return;
  }
  if(currentDir==='extended'&&extendedPoints.length){
    extendedPoints.pop();
    if(segmentBreaks.length&&segmentBreaks[segmentBreaks.length-1]>=extendedPoints.length){ segmentBreaks.pop(); segmentId=Math.max(0,segmentId-1); }
    buildRoute(); setInfo(`дополненный: ${extendedPoints.length} точек`); return;
  }
  showToast('нечего отменять');
});
function setActiveDirButton(dir){ document.querySelectorAll('#menu-route .dir-btn').forEach(b=>{ b.classList.toggle('active', b.dataset.dir===dir); }); }
setActiveDirButton('forward');
document.querySelectorAll('#menu-route .dir-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    currentDir=btn.dataset.dir; setActiveDirButton(currentDir);
    document.getElementById('row-through').style.display=currentDir==='through'?'flex':'none';
    clearRouteLayers(); activeRoute=null; linearPoints=[]; extendedPoints=[];
    segmentBreaks.length=0; segmentId=0; segmentPaused=false;
    if(currentDir==='extended') setInfo('дополненный: тапай по карте');
    if(currentDir==='linear') setInfo('линейный: тапай по карте');
    buildRoute();
  });
});
function parseLatLon(s){
  if(!s) return null;
  const m=s.split(/[,;\s]+/).map(Number);
  if(m.length<2||isNaN(m[0])||isNaN(m[1])) return null;
  return {lat:normLat(m[0]), lon:normLon(m[1])};
}
document.getElementById('r-start-pick').addEventListener('click',()=>{
  if(window.showToast) showToast('тапните по карте');
  map.once('click',e=>{ document.getElementById('r-start').value=`${normLat(e.latlng.lat).toFixed(6)}, ${normLon(e.latlng.lng).toFixed(6)}`; buildRoute(); });
});
document.getElementById('r-end-pick').addEventListener('click',()=>{
  if(window.showToast) showToast('тапните по карте');
  map.once('click',e=>{ document.getElementById('r-end').value=`${normLat(e.latlng.lat).toFixed(6)}, ${normLon(e.latlng.lng).toFixed(6)}`; buildRoute(); });
});
['r-start','r-end'].forEach(id=>{ document.getElementById(id).addEventListener('change', buildRoute); });
map.on('click',e=>{
  if(!routeExtraEnabled) return;
  if(segmentPaused) return;
  if(currentDir==='linear'){ linearPoints.push({lat:e.latlng.lat,lon:e.latlng.lng}); buildRoute(); }
  else if(currentDir==='extended'){ extendedPoints.push({lat:e.latlng.lat,lon:e.latlng.lng}); buildRoute(); }
});

function pickPrimaryRoute(){
  const activeId=(typeof window.activeRouteFileId!=='undefined')?window.activeRouteFileId:null;
  if(activeId!=null){
    const o=routeFileLayers.get(activeId);
    if(o&&o.visible){
      const ex=extractPathFromGeoJSON(o.geoJSON);
      if(ex.line.length) return ex;
    }
  }
  for(const [id,obj] of routeFileLayers){
    if(!obj.visible) continue;
    const ex=extractPathFromGeoJSON(obj.geoJSON);
    if(ex.line.length) return ex;
  }
  return null;
}
function getDevicePos(){
  if(typeof currentPos!=='undefined'&&currentPos) return currentPos;
  if(window.currentPos) return window.currentPos;
  return null;
}

function buildRoute(){
  extraLinesGroup.clearLayers();
  if(routeStartMarker){ map.removeLayer(routeStartMarker); routeStartMarker=null; }
  if(routeEndMarker){ map.removeLayer(routeEndMarker); routeEndMarker=null; }

  if(currentDir==='linear'){ drawLinear(); return; }
  if(currentDir==='extended'){ drawExtended(); return; }

  const primary=pickPrimaryRoute();
  if(!primary){ setInfo('маршрут: открой геофайл', true); return; }
  const line=primary.line;

  const dev=getDevicePos();
  if(!dev){ setInfo('маршрут: нет GPS', true); return; }

  const vertex=findClosestVertex(dev, line);
  const entryIdx=vertex.idx;
  const entryLatLng={lat:line[entryIdx].lat, lon:line[entryIdx].lon};

  if(currentDir==='forward'||currentDir==='reverse'){
    const toIdx=currentDir==='forward'?line.length-1:0;
    const step=toIdx>=entryIdx?1:-1;

    extraLinesGroup.addLayer(makeDashedDoubleLine([[dev.lat,dev.lon],[entryLatLng.lat,entryLatLng.lon]]));
    const walk=[[entryLatLng.lat,entryLatLng.lon]];
    for(let i=entryIdx+step; step>0?i<=toIdx:i>=toIdx; i+=step) walk.push([line[i].lat, line[i].lon]);
    extraLinesGroup.addLayer(makeDoubleLine(walk,{dash:'8 6', innerW:3, haloW:6}));

    activeRoute={ line, entryIndex:entryIdx, exitIndex:toIdx, dir:currentDir,
                  entryLatLng, exitLatLng: currentDir==='forward'?line[line.length-1]:line[0] };
  } else if(currentDir==='through'){
    const start=parseLatLon(document.getElementById('r-start').value);
    const end=parseLatLon(document.getElementById('r-end').value);
    if(!start||!end){ setInfo('маршрут: укажи start и end', true); return; }

    const startV=findClosestVertex(start, line);
    const endV=findClosestVertex(end, line);
    const fromIdx=startV.idx, toIdx=endV.idx;
    const step=toIdx>=fromIdx?1:-1;
    const walkPts=[[line[fromIdx].lat, line[fromIdx].lon]];
    for(let i=fromIdx+step; step>0?i<=toIdx:i>=toIdx; i+=step) walkPts.push([line[i].lat, line[i].lon]);

    extraLinesGroup.addLayer(makeDashedDoubleLine([[start.lat,start.lon],[line[fromIdx].lat,line[fromIdx].lon]]));
    extraLinesGroup.addLayer(makeDoubleLine(walkPts,{dash:'8 6', innerW:3, haloW:6}));
    extraLinesGroup.addLayer(makeDashedDoubleLine([[line[toIdx].lat,line[toIdx].lon],[end.lat,end.lon]]));

    activeRoute={ line, entryIndex:fromIdx, exitIndex:toIdx, dir:'through',
                  entryLatLng:{lat:line[fromIdx].lat, lon:line[fromIdx].lon},
                  exitLatLng: {lat:line[toIdx].lat,   lon:line[toIdx].lon} };

    routeStartMarker=L.marker([start.lat,start.lon],{
      icon:L.divIcon({className:'', iconSize:[18,18],
        html:'<div style="width:16px;height:16px;border:3px solid #fff;'+
             'outline:2px solid #ff9800;border-radius:50%;background:#ff9800"></div>'})
    }).addTo(map);
    routeEndMarker=L.marker([end.lat,end.lon],{
      icon:L.divIcon({className:'', iconSize:[18,18],
        html:'<div style="width:16px;height:16px;border:3px solid #fff;'+
             'outline:2px solid #ff9800;border-radius:50%;background:#121212"></div>'})
    }).addTo(map);
  }
  applyExtraVisibility();
}

function drawLinear(){
  if(linearPoints.length===0) return;
  const segs=[]; let start=0;
  for(const br of segmentBreaks){ if(br>start) segs.push(linearPoints.slice(start,br)); start=br; }
  if(start<linearPoints.length) segs.push(linearPoints.slice(start));
  if(segs.length===0) segs.push(linearPoints.slice());

  segs.forEach(seg=>{
    if(seg.length>=2)
      extraLinesGroup.addLayer(makeDoubleLine(seg.map(p=>[p.lat,p.lon]),{dash:'8 6',innerW:3,haloW:6}));
  });
  for(const p of linearPoints) extraLinesGroup.addLayer(makeDoubleRing([p.lat,p.lon],'#ff9800'));

  const dev=getDevicePos();
  if(dev){
    const withD=linearPoints.map((p,i)=>({i,p,d:distanceBetween(dev.lat,dev.lon,p.lat,p.lon)}))
      .sort((a,b)=>a.d-b.d).slice(0,2);
    for(const w of withD)
      extraLinesGroup.addLayer(makeDottedBeam([dev.lat,dev.lon],[w.p.lat,w.p.lon]));
  }
  activeRoute={ line:linearPoints.slice(), entryIndex:0, exitIndex:linearPoints.length-1,
                dir:'linear', entryLatLng:linearPoints[0],
                exitLatLng: linearPoints[linearPoints.length-1] };
  applyExtraVisibility();
}

function drawExtended(){
  const primary=pickPrimaryRoute();
  if(!primary||!primary.line.length){ setInfo('дополненный: нужен геофайл маршрута', true); return; }
  const line=primary.line;
  const dev=getDevicePos();
  if(!dev){ setInfo('дополненный: нет GPS', true); return; }

  if(extendedPoints.length===0){
    extraLinesGroup.addLayer(makeDoubleLine(line.map(p=>[p.lat,p.lon]),{innerW:3,haloW:7}));
    activeRoute={ line:line.slice(), entryIndex:0, exitIndex:line.length-1, dir:'extended',
                  entryLatLng:line[0], exitLatLng:line[line.length-1] };
    applyExtraVisibility();
    return;
  }

  const fullPath=[{lat:line[0].lat, lon:line[0].lon}];
  const firstV=findClosestVertex(extendedPoints[0], line);
  for(let i=1;i<=firstV.idx;i++) fullPath.push({lat:line[i].lat, lon:line[i].lon});

  const userPath=[]; let userStart=0; const userSegs=[];
  for(const br of segmentBreaks){ if(br>userStart) userSegs.push(extendedPoints.slice(userStart,br)); userStart=br; }
  if(userStart<extendedPoints.length) userSegs.push(extendedPoints.slice(userStart));
  for(let s=0;s<userSegs.length;s++){
    const seg=userSegs[s];
    for(let k=0;k<seg.length;k++) userPath.push({lat:seg[k].lat, lon:seg[k].lon, newSeg:(k===0&&s>0)});
  }

  const lastV=findClosestVertex(extendedPoints[extendedPoints.length-1], line);
  const tailPath=[{lat:line[lastV.idx].lat, lon:line[lastV.idx].lon}];
  for(let i=lastV.idx+1;i<line.length;i++) tailPath.push({lat:line[i].lat, lon:line[i].lon});

  function renderSeg(coords){ if(coords.length>=2) extraLinesGroup.addLayer(makeDoubleLine(coords,{dash:'8 6',innerW:3,haloW:6})); }
  renderSeg(fullPath.map(p=>[p.lat,p.lon]));
  let curSeg=[];
  for(const p of userPath){ if(p.newSeg&&curSeg.length){ renderSeg(curSeg); curSeg=[]; } curSeg.push([p.lat,p.lon]); }
  if(curSeg.length) renderSeg(curSeg);
  renderSeg(tailPath.map(p=>[p.lat,p.lon]));
  for(const p of extendedPoints) extraLinesGroup.addLayer(makeDoubleRing([p.lat,p.lon],'#88dd88'));

  activeRoute={ line: fullPath.concat(userPath,tailPath).map(c=>({lat:c.lat, lon:c.lon})),
                entryIndex:0, exitIndex: fullPath.length+userPath.length+tailPath.length-1,
                dir:'extended',
                entryLatLng:{lat:line[0].lat, lon:line[0].lon},
                exitLatLng: {lat:line[line.length-1].lat, lon:line[line.length-1].lon} };
  applyExtraVisibility();
}

function applyExtraVisibility(){
  if(routeExtraEnabled){ if(!map.hasLayer(extraLinesGroup)) extraLinesGroup.addTo(map); }
  else { if(map.hasLayer(extraLinesGroup)) map.removeLayer(extraLinesGroup); }
}

document.getElementById('btn-route-save').addEventListener('click',()=>{
  const gj={type:'FeatureCollection', features:[]};
  if(currentDir==='linear'&&linearPoints.length){
    const segs=[]; let start=0;
    for(const br of segmentBreaks){ if(br>start) segs.push(linearPoints.slice(start,br)); start=br; }
    if(start<linearPoints.length) segs.push(linearPoints.slice(start));
    if(segs.length===0) segs.push(linearPoints.slice());

    segs.forEach((seg,sIdx)=>{
      if(seg.length>=2)
        gj.features.push({type:'Feature', properties:{name:`segment ${sIdx+1}`},
          geometry:{type:'LineString', coordinates: seg.map(p=>[f6(p.lon), f6(p.lat)])}});
    });
    linearPoints.forEach((p,idx)=>{
      gj.features.push({type:'Feature', properties:{name:`point ${idx+1}`},
        geometry:{type:'Point', coordinates:[f6(p.lon), f6(p.lat)]}});
    });
  } else if(activeRoute){
    const seg=activeRoute.line.slice(
      Math.min(activeRoute.entryIndex, activeRoute.exitIndex),
      Math.max(activeRoute.entryIndex, activeRoute.exitIndex)+1);
    gj.features.push({type:'Feature', properties:{name:'route'},
      geometry:{type:'LineString', coordinates: seg.map(p=>[f6(p.lon), f6(p.lat)])}});
  } else {
    if(window.showToast) showToast('маршрут не построен');
    return;
  }
  const stamp=fileStamp(); const baseName=`Маршрут_${stamp}`;
  downloadBlob(gjToKml(gj), `${baseName}.kml`, 'application/vnd.google-earth.kml+xml');
  downloadBlob(gjToGpx(gj), `${baseName}.gpx`, 'application/gpx+xml');
  setInfo(`сохранено: ${baseName}.* (${gj.features.length} элементов)`);
});

/* ============================================================
   Старт ведения
   ============================================================ */
document.getElementById('btn-route-start').addEventListener('click',()=>{
  if(!activeRoute){ if(window.showToast) showToast('маршрут не построен'); return; }
  const line=activeRoute.line.slice(
    Math.min(activeRoute.entryIndex, activeRoute.exitIndex),
    Math.max(activeRoute.entryIndex, activeRoute.exitIndex)+1);
  if(line.length<2){ if(window.showToast) showToast('недостаточно точек'); return; }

  guidanceMode='silent';
  guidanceMinT=0; guidanceMinD=0; guidanceMinA=0;
  syncModeButton();
  resetGuidanceState();

  guidance={ line, idx:0 };
  setInfo('ведение: запущено (без звука)');
  if(window.setRouteButtonState) window.setRouteButtonState(true);
  routeMenu.classList.remove('open');
});

syncModeButton();

document.getElementById('btn-route-stop').addEventListener('click',()=>{
  guidance=null;
  clearRouteLayers();
  activeRoute=null; linearPoints=[]; extendedPoints=[];
  segmentBreaks.length=0; segmentId=0; segmentPaused=false;
  resetGuidanceState();
  if(window.setRouteButtonState) window.setRouteButtonState(false);
  speakText('ведение завершено');
  setInfo('ведение: завершено');
});

function speakText(s){
  if(!('speechSynthesis' in window)) return;
  try{
    speechSynthesis.cancel();
    const u=new SpeechSynthesisUtterance(s);
    u.lang='ru-RU';
    u.rate=1.05;
    speechSynthesis.speak(u);
  }catch(e){}
}

/* ============================================================
   Озвучка расстояний — склонение по-русски
   ============================================================ */
function signDelta(a){
  let d=((a%360)+360)%360;
  if(d>180) d-=360;
  return d;
}
function fmtKm3(m){
  return (m/1000).toFixed(3).replace('.',',');
}
function pluralRu(n, one, few, many){
  const abs=Math.abs(Math.round(n))%100;
  const last=abs%10;
  if(abs>=11 && abs<=19) return many;
  if(last===1) return one;
  if(last>=2 && last<=4) return few;
  return many;
}
function distanceToSpeech(meters){
  if(!isFinite(meters) || meters<0) return '';
  const m=Math.round(meters);
  if(m<1000){
    return `${m} ${pluralRu(m,'метр','метра','метров')}`;
  }
  const km=Math.floor(m/1000);
  const rest=m-km*1000;
  let s=`${km} ${pluralRu(km,'километр','километра','километров')}`;
  if(rest>0){
    s+=` ${rest} ${pluralRu(rest,'метр','метра','метров')}`;
  }
  return s;
}

/* ============================================================
   Проверка порогов и отметка озвучки
   ============================================================ */
function canSpeak(dev, now, deltaForAngle){
  if(guidanceMinT > 0){
    if(now - lastSpokenAt < guidanceMinT*1000) return false;
  } else {
    const posChanged = !lastSpokenPos ||
      distanceBetween(lastSpokenPos.lat, lastSpokenPos.lon, dev.lat, dev.lon) > 1;
    const courseChanged = (lastGpsBearing==null || lastDeviceHeading==null) ? false :
      Math.abs(signDelta((lastGpsBearing||0) - (currentCourseForDiff||0))) > 2;
    const headingChanged = (lastDeviceHeading==null || deviceHeading==null) ? false :
      Math.abs(signDelta(lastDeviceHeading - deviceHeading)) > 2;
    if(!(posChanged && courseChanged && headingChanged)) return false;
  }

  if(guidanceMinD > 0){
    const d = lastSpokenPos
      ? distanceBetween(lastSpokenPos.lat, lastSpokenPos.lon, dev.lat, dev.lon)
      : Infinity;
    if(d < guidanceMinD) return false;
  }

  if(guidanceMinA > 0 && isFinite(deltaForAngle)){
    if(Math.abs(deltaForAngle) < guidanceMinA) return false;
  }

  return true;
}

let currentCourseForDiff=null;

function markSpoken(dev, courseAtMoment, deltaAtMoment){
  lastSpokenAt=Date.now();
  lastSpokenPos={lat:dev.lat, lon:dev.lon};
  lastSpokenCourseDev=deltaAtMoment;
  currentCourseForDiff=courseAtMoment;
  lastDeviceHeading=deviceHeading;
}

/* ============================================================
   Режим С — Сопровождение
   ============================================================ */

function guidanceEscort(dev, line, now){
  if(line.length<2) return;

  const proj=projectPointOnPolyline(dev, line);
  const a=line[proj.segIndex];
  const b=line[Math.min(proj.segIndex+1, line.length-1)];

  const cross=(b.lon-a.lon)*(dev.lat-a.lat) - (b.lat-a.lat)*(dev.lon-a.lon);
  const sideStr = cross>0 ? 'правее' : 'левее';

  const distToRoute=proj.d;

  const trackBearing=bearingBetween(a.lat, a.lon, b.lat, b.lon);
  const gpsBearing=lastGpsBearing;
  let courseDelta=null;
  if(gpsBearing!=null) courseDelta=signDelta(gpsBearing - trackBearing);

  /* --- Тренд движения относительно линии маршрута --- */
  let trend=null;

  // 1) По GPS-курсу (основной сигнал вне маршрута):
  //    сравниваем курс с направлением на ближайшую точку маршрута.
  //    Если угол < 90° — движемся к линии (approaching),
  //    если > 90° — от линии (receding).
  if(gpsBearing!=null && distToRoute>1){
    const segLat=b.lat-a.lat, segLon=b.lon-a.lon;
    const segLen2=segLat*segLat+segLon*segLon;
    let projLat=a.lat, projLon=a.lon;
    if(segLen2>1e-18){
      let t=((dev.lat-a.lat)*segLat+(dev.lon-a.lon)*segLon)/segLen2;
      t=Math.max(0, Math.min(1, t));
      projLat=a.lat+t*segLat;
      projLon=a.lon+t*segLon;
    }
    const bearingToRoute=bearingBetween(dev.lat, dev.lon, projLat, projLon);
    const angleToRoute=Math.abs(signDelta(gpsBearing - bearingToRoute));
    trend = angleToRoute<90 ? 'approaching' : 'receding';
  }

  // 2) Резерв по изменению расстояния (работает и когда мы уже на маршруте).
  //    Порог 0.3 м — компромисс: гасит шум, но ловит реальное смещение.
  if(trend==null && lastDistToRoute!=null){
    const dDist=distToRoute-lastDistToRoute;
    if(dDist < -0.3) trend='approaching';
    else if(dDist > 0.3) trend='receding';
  }

  lastDistToRoute=distToRoute;

  const lastWp=line[line.length-1];
  const distToEnd=distanceBetween(dev.lat, dev.lon, lastWp.lat, lastWp.lon);
  if(distToEnd < 10){
    if(canSpeak(dev, now, courseDelta==null?0:Math.abs(courseDelta))){
      speakText('Сопровождение завершено');
      markSpoken(dev, gpsBearing||0, courseDelta||0);
    }
    return;
  }

  if(!canSpeak(dev, now, courseDelta==null?0:Math.abs(courseDelta))) return;

  const parts=[];

  if(distToRoute < 1){
    parts.push('На маршруте');
  } else {
    parts.push(`Маршрут ${sideStr} ${distanceToSpeech(distToRoute)}`);
  }

  if(courseDelta==null){
    /* нет GPS-курса — направление не озвучиваем */
  } else if(Math.abs(courseDelta) > 90){
    parts.push('Несоответствующее направление');
  } else if(Math.abs(courseDelta) < 1){
    parts.push('По курсу');
  } else {
    const dirStr = courseDelta>0 ? 'вправо' : 'влево';
    const angle  = Math.abs(Math.round(courseDelta));

    let trendStr;
    if(trend==='approaching')   trendStr='Приближение';
    else if(trend==='receding') trendStr='Отдаление';
    else                         trendStr='Отклонение';   // «Коррекция» больше не используется

    parts.push(`${trendStr} ${dirStr} ${angle} ${degreesWord(angle)}`);
  }

  if(parts.length===0) return;
  speakText(parts.join('. '));
  markSpoken(dev, gpsBearing||0, courseDelta||0);
}

/* ============================================================
   Склонение слова «градус» по числу
   1 → градус, 2–4 → градуса, 0 и 5–20 → градусов, 21 → градус, ...
   ============================================================ */
function degreesWord(n){
  const abs = Math.abs(Math.round(n)) % 100;
  const last = abs % 10;
  if(abs > 10 && abs < 20) return 'градусов';
  if(last === 1) return 'градус';
  if(last >= 2 && last <= 4) return 'градуса';
  return 'градусов';
}

/* ============================================================
   Режим Н — Навигация
   ============================================================ */
function guidanceNavigate(dev, line, now){
  if(line.length<2) return;

  const proj=projectPointOnPolyline(dev, line);
  if(proj.segIndex > currentNavIdx) currentNavIdx=proj.segIndex;

  const nextWpIdx=Math.min(currentNavIdx+1, line.length-1);
  const nextWp=line[nextWpIdx];

  const distToWp=distanceBetween(dev.lat, dev.lon, nextWp.lat, nextWp.lon);

  const lastWp=line[line.length-1];
  const distToEnd=distanceBetween(dev.lat, dev.lon, lastWp.lat, lastWp.lon);
  if(distToEnd < 5){
    if(canSpeak(dev, now, 0)){
      speakText('Навигация завершена');
      markSpoken(dev, lastGpsBearing||0, 0);
    }
    return;
  }

  const bearingToWp=bearingBetween(dev.lat, dev.lon, nextWp.lat, nextWp.lon);
  let navDelta=null;
  if(lastGpsBearing!=null) navDelta=signDelta(bearingToWp - lastGpsBearing);

  if(!canSpeak(dev, now, navDelta==null?0:Math.abs(navDelta))) return;

  const parts=[];

  if(navDelta==null){
    /* нет GPS-курса */
  } else if(Math.abs(navDelta) < 1){
    parts.push('Прямо');
  } else {
    const dirStr=navDelta>0?'Вправо':'Влево';
    const angle=Math.abs(Math.round(navDelta));
    parts.push(`${dirStr} ${angle} ${degreesWord(angle)}`);   // ← изменено
  }

  if(distToWp < 1){
    parts.push('На точке');
  } else {
    parts.push(`Далее ${distanceToSpeech(distToWp)}`);
  }

  if(parts.length===0) return;
  speakText(parts.join('. '));
  markSpoken(dev, lastGpsBearing||0, navDelta||0);
}

/* ============================================================
   Курс GPS по двум последним позициям
   ============================================================ */
let _prevGpsPosForBearing=null;

function guidanceTick(){
  if(!guidance) return;
  const dev=getDevicePos();
  if(!dev) return;

  if(_prevGpsPosForBearing){
    const moved=distanceBetween(_prevGpsPosForBearing.lat,_prevGpsPosForBearing.lon, dev.lat, dev.lon);
    if(moved > 0.5){
      lastGpsBearing=bearingBetween(_prevGpsPosForBearing.lat,_prevGpsPosForBearing.lon, dev.lat, dev.lon);
    }
  }
  _prevGpsPosForBearing={lat:dev.lat, lon:dev.lon};

  const now=Date.now();
  if(guidanceMode==='silent') return;
  if(guidanceMode==='escort'){ guidanceEscort(dev, guidance.line, now); return; }
  if(guidanceMode==='navigate'){ guidanceNavigate(dev, guidance.line, now); return; }
}
setInterval(guidanceTick, 2000);

/* ============================================================
   Наблюдатель за DOM координат устройства
   ============================================================ */
function consumeCoordsFromDOM(){
  const latEl=document.getElementById('coord-dev-lat');
  const lonEl=document.getElementById('coord-dev-lon');
  if(!latEl||!lonEl) return;
  const lat=parseFloat(latEl.textContent);
  const lon=parseFloat(lonEl.textContent);
  if(!isFinite(lat)||!isFinite(lon)) return;
  const pos={coords:{latitude:lat, longitude:lon}};
  try{ trackFix(pos); }catch(e){}
  try{ if(guidance) guidanceTick(); }catch(e){}
}
let coordObs=null;
function attachCoordObserver(){
  const latEl=document.getElementById('coord-dev-lat');
  const lonEl=document.getElementById('coord-dev-lon');
  if(!latEl||!lonEl) return false;
  if(coordObs) return true;
  coordObs=new MutationObserver(()=>consumeCoordsFromDOM());
  const cfg={characterData:true, childList:true, subtree:true};
  coordObs.observe(latEl, cfg);
  coordObs.observe(lonEl, cfg);
  consumeCoordsFromDOM();
  return true;
}
if(!attachCoordObserver()){
  document.addEventListener('DOMContentLoaded', attachCoordObserver);
  window.addEventListener('load', attachCoordObserver);
}

/* ============================================================
   Таблицы и векторы
   ============================================================ */
function collectPointsFrom(layersMap){
  const out=[];
  for(const o of layersMap.values()){
    if(!o.visible) continue;
    if(!o.layer) continue;
    try{
      o.layer.eachLayer(l=>{
        const gj=l.toGeoJSON?l.toGeoJSON():null;
        if(!gj) return;
        const walk=c=>{
          if(!c) return;
          if(typeof c[0]==='number'&&typeof c[1]==='number') out.push({lat:c[1],lon:c[0]});
          else for(const x of c) walk(x);
        };
        if(gj.geometry) walk(gj.geometry.coordinates);
      });
    }catch(e){}
  }
  return out;
}
function setCell(id,text){ const el=document.getElementById(id); if(el) el.textContent=text; }

function updateTables(){
  const dev=getDevicePos();
  const center=map.getCenter();
  const cross={lat:normLat(center.lat), lon:normLon(center.lng)};

  if(UI.table5){
    if(dev){
      const b1=bearingBetween(cross.lat, cross.lon, dev.lat, dev.lon);
      const d1=distanceBetween(cross.lat, cross.lon, dev.lat, dev.lon);
      setCell('t5-cross-1', fmtPair(b1,d1));
      const b2=bearingBetween(dev.lat, dev.lon, cross.lat, cross.lon);
      const d2=distanceBetween(dev.lat, dev.lon, cross.lat, cross.lon);
      setCell('t5-cross-2', fmtPair(b2,d2));
    } else {
      setCell('t5-cross-1', fmtPair(null,null));
      setCell('t5-cross-2', fmtPair(null,null));
    }
    const pts=collectPointsFrom(geoLayers).concat(collectPointsFrom(routeFileLayers));
    if(pts.length){
      let minD1=Infinity,maxD1=-Infinity,minP1=null,maxP1=null;
      let minD2=Infinity,maxD2=-Infinity,minP2=null,maxP2=null;
      for(const p of pts){
        const d1=distanceBetween(cross.lat,cross.lon,p.lat,p.lon);
        if(d1<minD1){ minD1=d1; minP1=p; }
        if(d1>maxD1){ maxD1=d1; maxP1=p; }
        if(dev){
          const d2=distanceBetween(dev.lat,dev.lon,p.lat,p.lon);
          if(d2<minD2){ minD2=d2; minP2=p; }
          if(d2>maxD2){ maxD2=d2; maxP2=p; }
        }
      }
      setCell('t5-min-1', fmtPair(bearingBetween(cross.lat,cross.lon,minP1.lat,minP1.lon), minD1));
      setCell('t5-max-1', fmtPair(bearingBetween(cross.lat,cross.lon,maxP1.lat,maxP1.lon), maxD1));
      if(dev&&minP2&&maxP2){
        setCell('t5-min-2', fmtPair(bearingBetween(dev.lat,dev.lon,minP2.lat,minP2.lon), minD2));
        setCell('t5-max-2', fmtPair(bearingBetween(dev.lat,dev.lon,maxP2.lat,maxP2.lon), maxD2));
      } else {
        setCell('t5-min-2', fmtPair(null,null));
        setCell('t5-max-2', fmtPair(null,null));
      }
    } else {
      ['t5-min-1','t5-max-1','t5-min-2','t5-max-2'].forEach(id=>setCell(id, fmtPair(null,null)));
    }
  }

  if(UI.table6){
    const route=activeRoute;
    if(route&&route.line&&route.line.length>=2){
      const start=route.line[0];
      const end=route.line[route.line.length-1];
      setCell('t6-start-1', fmtPair(
        bearingBetween(cross.lat, cross.lon, start.lat, start.lon),
        distanceBetween(cross.lat, cross.lon, start.lat, start.lon)));
      setCell('t6-end-1', fmtPair(
        bearingBetween(cross.lat, cross.lon, end.lat, end.lon),
        distanceBetween(cross.lat, cross.lon, end.lat, end.lon)));
      const proj1=projectPointOnSegment(cross, start, end);
      setCell('t6-line-1', fmtPair(
        bearingBetween(cross.lat, cross.lon, proj1.lat, proj1.lon), proj1.d));

      if(dev){
        setCell('t6-start-2', fmtPair(
          bearingBetween(dev.lat, dev.lon, start.lat, start.lon),
          distanceBetween(dev.lat, dev.lon, start.lat, start.lon)));
        setCell('t6-end-2', fmtPair(
          bearingBetween(dev.lat, dev.lon, end.lat, end.lon),
          distanceBetween(dev.lat, dev.lon, end.lat, end.lon)));
        const proj2=projectPointOnPolyline(dev, route.line);
        setCell('t6-line-2', fmtPair(
          bearingBetween(dev.lat, dev.lon, proj2.lat, proj2.lon), proj2.d));
      } else {
        setCell('t6-start-2', fmtPair(null,null));
        setCell('t6-end-2', fmtPair(null,null));
        setCell('t6-line-2', fmtPair(null,null));
      }
    } else {
      ['t6-start-1','t6-line-1','t6-end-1','t6-start-2','t6-line-2','t6-end-2']
        .forEach(id=>setCell(id, fmtPair(null,null)));
    }
  }

  try{ refreshVectorsForTable5(); }catch(e){}
  try{ refreshVectorsForTable6(); }catch(e){}
}

function refreshVectorsForTable5(){
  const api=window.__vectorGroups;
  if(!api) return;
  const grp=api.get5(); if(!grp) return;
  grp.clearLayers();
  if(!api.show5()) return;

  const showPlace=UI.vectPlace!==false;
  const showCross=UI.vectCross!==false;
  const dev=getDevicePos();
  const center=map.getCenter();
  const cross={lat:normLat(center.lat), lon:normLon(center.lng)};
  const pts=collectPointsFrom(geoLayers).concat(collectPointsFrom(routeFileLayers));

  if(showCross){
    if(dev) api.drawVector(grp, cross, dev, '#ff4040', 'solid');
    if(pts.length){
      let minD=Infinity,maxD=-Infinity,minP=null,maxP=null;
      for(const p of pts){
        const d=distanceBetween(cross.lat,cross.lon,p.lat,p.lon);
        if(d<minD){ minD=d; minP=p; }
        if(d>maxD){ maxD=d; maxP=p; }
      }
      if(minP) api.drawVector(grp, cross, minP, '#ffcc66', 'dashdot');
      if(maxP) api.drawVector(grp, cross, maxP, '#ffcc66', 'dashdot');
    }
  }
  if(showPlace&&dev){
    api.drawVector(grp, dev, cross, '#ff4040', 'solid');
    if(pts.length){
      let minD=Infinity,maxD=-Infinity,minP=null,maxP=null;
      for(const p of pts){
        const d=distanceBetween(dev.lat,dev.lon,p.lat,p.lon);
        if(d<minD){ minD=d; minP=p; }
        if(d>maxD){ maxD=d; maxP=p; }
      }
      if(minP) api.drawVector(grp, dev, minP, '#88dd88', 'dashdot');
      if(maxP) api.drawVector(grp, dev, maxP, '#88dd88', 'dashdot');
    }
  }
}
function refreshVectorsForTable6(){
  const api=window.__vectorGroups;
  if(!api) return;
  const grp=api.get6(); if(!grp) return;
  grp.clearLayers();
  if(!api.show6()) return;

  const showPlace=UI.vectPlace!==false;
  const showCross=UI.vectCross!==false;
  const dev=getDevicePos();
  const center=map.getCenter();
  const cross={lat:normLat(center.lat), lon:normLon(center.lng)};
  const route=activeRoute;
  if(!route||!route.line||route.line.length<2) return;
  const start=route.line[0];
  const end=route.line[route.line.length-1];
  const projC=projectPointOnSegment(cross, start, end);
  const projD=dev?projectPointOnPolyline(dev, route.line):null;

  if(showCross){
    api.drawVector(grp, cross, start, '#ffcc66', 'solid');
    api.drawVector(grp, cross, {lat:projC.lat, lon:projC.lon}, '#ffcc66', 'dot');
    api.drawVector(grp, cross, end,   '#ffcc66', 'dot');
  }
  if(showPlace&&dev){
    api.drawVector(grp, dev, start, '#88dd88', 'solid');
    if(projD) api.drawVector(grp, dev, {lat:projD.lat, lon:projD.lon}, '#88dd88', 'dot');
    api.drawVector(grp, dev, end,   '#88dd88', 'dot');
  }
}

window.__navRefresh=updateTables;
setInterval(updateTables, 800);

window.NavCtl={ onPosition:function(pos){} };
})();
