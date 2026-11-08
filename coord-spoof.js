/* ============================================================
   modules/coord-spoof.js
   Утилита «Подмена координат»
   ============================================================ */
(function(){
'use strict';

/* Небольшая защита от двойного подключения */
if (window.__coordSpoofLoaded) {
  if (window.__coordSpoofOpen) window.__coordSpoofOpen();
  return;
}
window.__coordSpoofLoaded = true;

/* === Панель === */
const panel = document.createElement('div');
panel.id = 'coord-spoof-panel';
panel.style.cssText = `
  position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
  background:rgba(20,20,20,.97); border:2px solid #ff9800;
  border-radius:6px; padding:12px; z-index:2500;
  display:none; flex-direction:column; gap:8px;
  width:min(90vw,340px); font-family:monospace;
`;
panel.innerHTML = `
  <div style="font-size:13px;font-weight:bold;text-align:left;
              border-bottom:1px solid #ff9800;padding-bottom:6px">
    ПОДМЕНА КООРДИНАТ
  </div>
  <input id="spoof-input" type="text" placeholder="00.000000, 00.000000"
         style="height:34px;background:#000;color:#ff9800;border:1px solid #ff9800;
                border-radius:3px;font-family:monospace;font-size:12px;padding:0 8px;width:100%">
  <div style="display:flex;gap:6px;width:100%">
    <button id="spoof-apply" class="menu-btn"
            style="flex:1;height:34px;font-size:12px">ПРИМЕНИТЬ</button>
    <button id="spoof-reset" class="menu-btn"
            style="flex:1;height:34px;font-size:12px">СБРОСИТЬ</button>
  </div>
  <button id="spoof-close" class="menu-btn"
          style="height:30px;font-size:11px;width:100%">ЗАКРЫТЬ</button>
  <div id="spoof-status" style="font-size:11px;color:#88dd88;
       text-align:center;min-height:14px"></div>
`;
document.getElementById('map-container').appendChild(panel);

const inputEl   = panel.querySelector('#spoof-input');
const applyBtn  = panel.querySelector('#spoof-apply');
const resetBtn  = panel.querySelector('#spoof-reset');
const closeBtn  = panel.querySelector('#spoof-close');
const statusEl  = panel.querySelector('#spoof-status');

function openPanel(){
  /* Подставить текущую позицию в поле, если пусто */
  if (!inputEl.value.trim()){
    const p = (window.NavAPI && NavAPI.getDevicePos && NavAPI.getDevicePos()) || null;
    if (p) inputEl.value = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  }
  /* Обновить статус */
  if (window.NavAPI && NavAPI.isSpoofed && NavAPI.isSpoofed()){
    statusEl.textContent = 'Активна подмена координат';
    statusEl.style.color = '#ffcc66';
  } else {
    statusEl.textContent = 'Используются реальные GPS-координаты';
    statusEl.style.color = '#88dd88';
  }
  panel.style.display = 'flex';
}
function closePanel(){
  panel.style.display = 'none';
}

window.__coordSpoofOpen = openPanel;

/* === Парсинг "lat, lon" === */
function parseInput(str){
  if (!str) return null;
  const m = str.split(/[,;\s]+/).map(Number);
  if (m.length < 2) return null;
  const lat = m[0], lon = m[1];
  if (!isFinite(lat) || !isFinite(lon)) return null;
  if (lat < -90 || lat > 90) return null;
  if (lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/* === Применить === */
applyBtn.addEventListener('click', ()=>{
  const p = parseInput(inputEl.value);
  if (!p){
    statusEl.textContent = 'Неверный формат. Нужно: широта, долгота';
    statusEl.style.color = '#ff5555';
    return;
  }
  if (!window.NavAPI || typeof NavAPI.setDevicePos !== 'function'){
    statusEl.textContent = 'NavAPI не найден (index.html не обновлён?)';
    statusEl.style.color = '#ff5555';
    return;
  }
  NavAPI.setDevicePos(p.lat, p.lon);
  statusEl.textContent = `Подмена активна: ${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  statusEl.style.color = '#ffcc66';
  if (NavAPI.showToast) NavAPI.showToast('подмена координат включена');
});

/* === Сбросить === */
resetBtn.addEventListener('click', ()=>{
  if (!window.NavAPI || typeof NavAPI.resetDevicePos !== 'function'){
    statusEl.textContent = 'NavAPI не найден';
    statusEl.style.color = '#ff5555';
    return;
  }
  NavAPI.resetDevicePos();
  inputEl.value = '';
  statusEl.textContent = 'Возврат к реальным GPS-координатам';
  statusEl.style.color = '#88dd88';
  if (NavAPI.showToast) NavAPI.showToast('подмена координат отменена');
});

/* === Закрыть === */
closeBtn.addEventListener('click', closePanel);

})();