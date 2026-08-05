'use strict';

/* ─────────────────────────────────────────────────────────────────
   OxyField Pro — Motor de Test de Campo Fisiológico
   • Cronómetro RAF (sin setInterval)
   • Bluetooth real Polar H10 via Web Bluetooth API
   • Botón REGISTRAR: captura tiempo + FC + distancia por protocolo
   • 4 protocolos: Navette, Conconi, Cooper, George-Fisher
   • VO₂máx estimado por fórmulas validadas
───────────────────────────────────────────────────────────────── */

(function () {
  let initialized = false;

  window.oxyfieldInit = function () {
    if (initialized) return;
    initialized = true;
    renderProtocolSelector();
    renderAthleteList();
    buildTable();
    rebuildChart();
    updateStageInfo();
    bindEvents();
  };

  // ── Constantes ─────────────────────────────────────────────────
  const NAVETTE = [
    { n:1, v:7,  vel:8.5  }, { n:2, v:8,  vel:9.0  }, { n:3, v:8,  vel:9.5  },
    { n:4, v:9,  vel:10.0 }, { n:5, v:9,  vel:10.5 }, { n:6, v:10, vel:11.0 },
    { n:7, v:10, vel:11.5 }, { n:8, v:11, vel:12.0 }, { n:9, v:11, vel:12.5 },
    { n:10,v:12, vel:13.0 }, { n:11,v:12, vel:13.5 }, { n:12,v:13, vel:14.0 },
    { n:13,v:13, vel:14.5 }, { n:14,v:14, vel:15.0 }, { n:15,v:14, vel:15.5 },
    { n:16,v:15, vel:16.0 }, { n:17,v:15, vel:16.5 }, { n:18,v:16, vel:17.0 },
    { n:19,v:16, vel:17.5 }, { n:20,v:17, vel:18.0 }, { n:21,v:17, vel:18.5 }
  ];

  const COLORS = ['#3b82f6','#f43f5e','#f59e0b','#10b981','#8b5cf6','#06b6d4','#ec4899'];

  const PROTO_INFO = {
    navette:       '🔄 20 m ida-vuelta · Velocidad incremental con beep · Registra al completar cada vuelta o nivel',
    conconi:       '🏃 Pista de atletismo · Etapas de 200 m · Velocidad +0.5 km/h por etapa · Registra al cruzar cada 200 m',
    cooper:        '⏱ 12 minutos continuos · Máxima distancia posible · Registra periódicamente y al finalizar ingresa la distancia',
    george_fisher: '🚶 Caminata 1.6 km (1 milla) · Peso del atleta requerido · Registra al cruzar la meta'
  };

  // ── Estado global ──────────────────────────────────────────────
  const st = {
    athletes:  [],   // [{id,nombre,edad,color,bpm,device,nota}]
    protocols: [
      { id:'navette',       nombre:'Course Navette (Palier – 21 niveles)'     },
      { id:'conconi',       nombre:'Test de Conconi (Umbral – 6 etapas)'       },
      { id:'cooper',        nombre:'Test de Cooper (12 minutos)'                },
      { id:'george_fisher', nombre:'George-Fisher (Caminata 1 milla / 1.6 km)' }
    ],
    protocol:   'navette',
    running:    false,
    stage:      0,     // nivel navette / etapa conconi / minuto cooper
    shuttle:    0,     // vuelta dentro de nivel (solo navette)
    recordings: [],    // [{etiqueta,tiempo,dist,vel,hrData:[{id,bpm,color}]}]
    chart:      null
  };

  // ── RAF Cronómetro ─────────────────────────────────────────────
  let rafId = null, rafStart = null, msOff = 0, ms = 0;

  function startCrono() {
    if (rafId) return;
    rafStart = performance.now();
    (function tick(now) {
      ms = msOff + (now - rafStart);
      const el = document.getElementById('main-cronometro');
      if (el) el.textContent = fmtMs(ms);
      rafId = requestAnimationFrame(tick);
    })(performance.now());
  }

  function stopCrono() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    msOff = ms;
  }

  function resetCrono() {
    stopCrono(); ms = 0; msOff = 0; rafStart = null;
    const el = document.getElementById('main-cronometro');
    if (el) el.textContent = '00:00.00';
  }

  function pad(n) { return String(n).padStart(2,'0'); }
  function fmtMs(t) {
    const s = Math.floor(t / 1000);
    return `${pad(Math.floor(s/60))}:${pad(s%60)}.${pad(Math.floor((t%1000)/10))}`;
  }

  // ── Bluetooth Polar H10 ────────────────────────────────────────
  async function conectarH10(id) {
    const a = st.athletes.find(x => x.id === id);
    if (!a) return;

    if (a.device) {
      try { a.device.gatt.disconnect(); } catch {}
      a.device = null; a.bpm = 0;
      renderAthleteList(); updateHRStrip(); return;
    }

    if (!navigator.bluetooth) {
      typeof toast === 'function' && toast(
        'Web Bluetooth no está disponible. Usa Google Chrome o Microsoft Edge en computadora o Android. Safari y Firefox no son compatibles.',
        true
      );
      return;
    }

    a.bpm = -1; renderAthleteList();

    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [
          { services: ['heart_rate'] },
          { namePrefix: 'Polar' }
        ],
        optionalServices: ['heart_rate']
      });
      device.addEventListener('gattserverdisconnected', () => {
        a.device = null; a.bpm = 0;
        renderAthleteList(); updateHRStrip();
        typeof toast === 'function' && toast(`${a.nombre} — H10 desconectado.`, true);
      });
      const gatt = await device.gatt.connect();
      const svc  = await gatt.getPrimaryService('heart_rate');
      const char = await svc.getCharacteristic('heart_rate_measurement');
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', ev => {
        const dv = ev.target.value, f = dv.getUint8(0);
        a.bpm = (f & 1) === 0 ? dv.getUint8(1) : dv.getUint16(1, true);
        const bpmEl = document.getElementById(`oxyf-bpm-${a.id}`);
        if (bpmEl) bpmEl.textContent = a.bpm;
        const stripEl = document.getElementById(`oxyf-strip-bpm-${a.id}`);
        if (stripEl) stripEl.textContent = a.bpm;
      });
      a.device = device;
      renderAthleteList(); updateHRStrip();
      typeof toast === 'function' && toast(`✅ Polar H10 conectado → ${a.nombre}`);
    } catch (e) {
      a.bpm = 0; renderAthleteList();
      if (e.name === 'NotFoundError') {
        typeof toast === 'function' && toast(
          'No se encontró ningún dispositivo. Verifica: 1) La banda H10 debe estar puesta con contacto en la piel (no funciona sobre la mesa). 2) Bluetooth activado. 3) Si no aparece en la lista, mójala levemente.',
          true
        );
      } else if (e.name === 'SecurityError') {
        typeof toast === 'function' && toast('Permiso Bluetooth denegado. Revisa los permisos del sitio en el navegador.', true);
      } else {
        typeof toast === 'function' && toast('Error Bluetooth: ' + e.message, true);
      }
    }
  }

  // ── HR Strip (barra superior) ──────────────────────────────────
  function updateHRStrip() {
    const el = document.getElementById('oxyf-hr-strip');
    if (!el) return;
    if (st.athletes.length === 0) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.innerHTML = st.athletes.map(a => {
      const live = a.bpm > 0;
      const searching = a.bpm === -1;
      return `<div class="oxyf-hr-chip${live ? ' oxyf-hr-live' : ''}" style="--chip-color:${a.color}">
        <span class="oxyf-hr-dot" style="background:${live ? a.color : (searching ? '#f59e0b' : '#94a3b8')}"></span>
        <span class="oxyf-hr-name">${a.nombre}</span>
        <span class="oxyf-hr-val"><span id="oxyf-strip-bpm-${a.id}">${live ? a.bpm : (searching ? '···' : '—')}</span>${live ? ' bpm' : ''}</span>
      </div>`;
    }).join('');
  }

  // ── Atletas ────────────────────────────────────────────────────
  function renderAthleteList() {
    const el = document.getElementById('lista-atletas-registro');
    if (!el) return;
    if (st.athletes.length === 0) {
      el.innerHTML = '<div class="oxyf-empty-list">Agrega atletas para comenzar el test</div>';
      updateHRStrip(); return;
    }
    el.innerHTML = st.athletes.map(a => {
      const live = a.bpm > 0, searching = a.bpm === -1;
      return `<div class="oxyf-athlete-item">
        <div class="oxyf-athlete-color" style="background:${a.color}"></div>
        <div class="oxyf-athlete-info">
          <span class="oxyf-athlete-name">${a.nombre}</span>
          <span class="oxyf-athlete-meta">ID ${a.id} · ${a.edad} años</span>
        </div>
        <div class="oxyf-athlete-bpm" style="color:${live ? a.color : '#94a3b8'}">
          <span id="oxyf-bpm-${a.id}" class="oxyf-bpm-num">${live ? a.bpm : (searching ? '···' : '—')}</span>
          <span class="oxyf-bpm-unit">${live ? 'bpm' : ''}</span>
        </div>
        <div class="oxyf-athlete-actions">
          <button class="oxyf-bt-btn ${a.device ? 'oxyf-bt-on' : (searching ? 'oxyf-bt-search' : 'oxyf-bt-off')}" data-bt="${a.id}">
            ${a.device ? '🔴 Desconectar' : (searching ? '⏳ Buscando…' : '🔵 H10')}
          </button>
          <button class="oxyf-del-btn" data-del-atleta="${a.id}" title="Quitar del test">✕</button>
        </div>
      </div>`;
    }).join('');
    updateHRStrip();
  }

  function agregarAtleta() {
    const idEl  = document.getElementById('atleta-id');
    const nomEl = document.getElementById('atleta-nombre');
    const edEl  = document.getElementById('atleta-edad');
    const id     = idEl?.value.trim();
    const nombre = nomEl?.value.trim().toUpperCase();
    const edad   = parseInt(edEl?.value) || 25;
    if (!id || !nombre) { typeof toast === 'function' && toast('Introduce ID y nombre.', true); return; }
    if (st.athletes.some(a => a.id === id)) { typeof toast === 'function' && toast('Ese ID ya está en uso.', true); return; }
    st.athletes.push({ id, nombre, edad, color: COLORS[st.athletes.length % COLORS.length], bpm: 0, device: null, nota: '' });
    idEl.value = String(parseInt(id) + 1).padStart(2,'0');
    nomEl.value = '';
    renderAthleteList(); buildTable(); rebuildChart();
  }

  async function importarAtletasBD() {
    try {
      const resp = await fetch('/api/athletes');
      if (!resp.ok) throw new Error();
      const list = await resp.json();
      let n = 0;
      list.filter(a => a.active).forEach(a => {
        if (st.athletes.some(x => x.nombre === a.name.toUpperCase())) return;
        const id   = String(st.athletes.length + 1).padStart(2,'0');
        const edad = a.birth_date ? Math.floor((Date.now() - new Date(a.birth_date)) / 3.15576e10) : 25;
        st.athletes.push({ id, nombre: a.name.toUpperCase(), edad, color: COLORS[st.athletes.length % COLORS.length], bpm: 0, device: null, nota: '' });
        n++;
      });
      renderAthleteList(); buildTable(); rebuildChart();
      typeof toast === 'function' && toast(`${n} atleta(s) importado(s) desde la base de datos.`);
    } catch { typeof toast === 'function' && toast('No se pudo conectar con la base de datos.', true); }
  }

  // ── Protocolo ──────────────────────────────────────────────────
  function renderProtocolSelector() {
    const sel = document.getElementById('protocolo-selector');
    if (!sel) return;
    sel.innerHTML = st.protocols.map(p =>
      `<option value="${p.id}"${p.id === st.protocol ? ' selected' : ''}>${p.nombre}</option>`
    ).join('');
    updateProtoBadge();
  }

  function updateProtoBadge() {
    const el = document.getElementById('oxyf-proto-badge');
    if (el) el.innerHTML = `<span>${PROTO_INFO[st.protocol] || ''}</span>`;
    // Mostrar/ocultar campos extra según protocolo
    const showCooper = st.protocol === 'cooper';
    const showGF     = st.protocol === 'george_fisher';
    const ec = document.getElementById('oxyf-extra-cooper');
    const eg = document.getElementById('oxyf-extra-gf');
    if (ec) ec.style.display = showCooper ? 'block' : 'none';
    if (eg) eg.style.display = showGF     ? 'block' : 'none';
  }

  async function agregarProtocolo() {
    const nombre = await showPrompt('Nombre del nuevo protocolo:', '', 'Nuevo protocolo');
    if (!nombre?.trim()) return;
    const id = 'custom_' + Date.now();
    st.protocols.push({ id, nombre: nombre.trim() });
    st.protocol = id;
    renderProtocolSelector(); reiniciar();
  }

  async function editarProtocolo() {
    const p = st.protocols.find(x => x.id === st.protocol);
    if (!p) return;
    const nuevo = await showPrompt('Editar nombre:', p.nombre, 'Editar protocolo');
    if (nuevo?.trim()) { p.nombre = nuevo.trim(); renderProtocolSelector(); }
  }

  async function eliminarProtocolo() {
    if (st.protocols.length <= 1) { typeof toast === 'function' && toast('Debe quedar al menos un protocolo.', true); return; }
    const p = st.protocols.find(x => x.id === st.protocol);
    const ok = await showConfirm(`¿Eliminar "${p.nombre}"?`, 'Eliminar protocolo');
    if (!ok) return;
    st.protocols = st.protocols.filter(x => x.id !== st.protocol);
    st.protocol = st.protocols[0].id;
    renderProtocolSelector(); reiniciar();
  }

  // ── Cálculo distancia por protocolo ───────────────────────────
  function calcDistancia() {
    if (st.protocol === 'navette') {
      // Distancia acumulada hasta la vuelta actual
      let total = 0;
      for (let i = 0; i < st.stage; i++) total += NAVETTE[i].v * 20;
      total += (st.shuttle + 1) * 20;
      return total;
    }
    if (st.protocol === 'conconi')       return (st.stage + 1) * 200;
    if (st.protocol === 'george_fisher') return 1609;
    return null; // cooper: distancia manual al final
  }

  // ── Info de etapa actual ───────────────────────────────────────
  function stageInfo() {
    if (st.protocol === 'navette') {
      const lev = NAVETTE[Math.min(st.stage, NAVETTE.length - 1)];
      return {
        etapa: `Nivel ${lev.n}  ·  Vuelta ${st.shuttle + 1} / ${lev.v}`,
        dist:  `${calcDistancia()} m`,
        vel:   `${lev.vel} km/h`
      };
    }
    if (st.protocol === 'conconi') {
      const vel = (8 + st.stage * 0.5).toFixed(1);
      return { etapa: `Etapa ${st.stage + 1} / 6`, dist: `${(st.stage + 1) * 200} m`, vel: `${vel} km/h` };
    }
    if (st.protocol === 'cooper') {
      return { etapa: `Minuto ${st.stage + 1} / 12`, dist: 'libre', vel: 'libre' };
    }
    if (st.protocol === 'george_fisher') {
      return { etapa: 'Caminata 1.6 km', dist: '1609 m', vel: 'libre' };
    }
    return { etapa: `Etapa ${st.stage + 1}`, dist: '—', vel: '—' };
  }

  function updateStageInfo() {
    const { etapa, dist, vel } = stageInfo();
    const sEl = document.getElementById('oxyf-stage'); if (sEl) sEl.textContent = etapa;
    const dEl = document.getElementById('oxyf-dist');  if (dEl) dEl.textContent = dist;
    const vEl = document.getElementById('oxyf-vel');   if (vEl) vEl.textContent = vel;
  }

  // ── Control de test ────────────────────────────────────────────
  function iniciar() {
    if (st.athletes.length === 0) {
      typeof toast === 'function' && toast('Agrega al menos un atleta antes de iniciar.', true); return;
    }
    st.running = true;
    startCrono();
    setButtonState('running');
    updateStageInfo();
  }

  function pausar() {
    st.running = false; stopCrono(); setButtonState('paused');
  }

  function reiniciar() {
    st.running = false; st.stage = 0; st.shuttle = 0; st.recordings = [];
    resetCrono(); setButtonState('idle');
    buildTable(); rebuildChart();
    updateStageInfo();
    const rep = document.getElementById('cuerpo-interpretacion');
    if (rep) rep.innerHTML = '<p class="oxyf-report-empty">El reporte se genera al registrar lecturas de esfuerzo.</p>';
    // Ocultar resultado Cooper
    const ec = document.getElementById('oxyf-extra-cooper');
    if (ec && st.protocol === 'cooper') ec.style.display = 'none';
  }

  function setButtonState(s) {
    const start = document.getElementById('oxyBtnStart');
    const pause = document.getElementById('oxyBtnPause');
    const reset = document.getElementById('oxyBtnReset');
    const reg   = document.getElementById('oxyBtnRegistrar');
    if (s === 'running') {
      if (start) { start.disabled = true;  start.textContent = '▶ En curso…'; }
      if (pause) pause.disabled = false;
      if (reset) reset.disabled = false;
      if (reg)   { reg.disabled = false; reg.classList.add('oxyf-register-btn--active'); }
    } else if (s === 'paused') {
      if (start) { start.disabled = false; start.textContent = '▶ Reanudar'; }
      if (pause) pause.disabled = true;
      if (reset) reset.disabled = false;
      if (reg)   { reg.disabled = true;  reg.classList.remove('oxyf-register-btn--active'); }
    } else {
      if (start) { start.disabled = false; start.textContent = '▶ Iniciar'; }
      if (pause) pause.disabled = true;
      if (reset) reset.disabled = true;
      if (reg)   { reg.disabled = true;  reg.classList.remove('oxyf-register-btn--active'); }
    }
  }

  // ── REGISTRAR LECTURA ──────────────────────────────────────────
  function registrarLectura() {
    if (!st.running) return;

    const tiempo = fmtMs(ms);
    const dist   = calcDistancia();
    const info   = stageInfo();
    const hrData = st.athletes.map(a => ({ id: a.id, nombre: a.nombre, bpm: a.bpm > 0 ? a.bpm : null, color: a.color }));
    let vel = 0;
    if (st.protocol === 'navette')  vel = NAVETTE[Math.min(st.stage, NAVETTE.length - 1)].vel;
    if (st.protocol === 'conconi')  vel = 8 + st.stage * 0.5;

    const rec = { tiempo, etiqueta: extraerEtiqueta(info.etapa), dist, vel, hrData };
    st.recordings.push(rec);
    appendTableRow(rec);
    updateChart(rec);
    actualizarReporte();
    beep(880, 0.12);
    avanzarEtapa();
    updateStageInfo();
  }

  function extraerEtiqueta(etapa) {
    // Versión corta para el eje X del gráfico
    if (st.protocol === 'navette') {
      const lev = NAVETTE[Math.min(st.stage, NAVETTE.length - 1)];
      return `N${lev.n}-V${st.shuttle + 1}`;
    }
    if (st.protocol === 'conconi')       return `E${st.stage + 1}`;
    if (st.protocol === 'cooper')        return `M${st.stage + 1}`;
    if (st.protocol === 'george_fisher') return 'Meta';
    return `P${st.stage + 1}`;
  }

  function avanzarEtapa() {
    if (st.protocol === 'navette') {
      const lev = NAVETTE[st.stage];
      if (!lev) return;
      if (st.shuttle + 1 < lev.v) {
        st.shuttle++;
      } else {
        st.stage++;
        st.shuttle = 0;
        if (st.stage >= NAVETTE.length) {
          finalizarTest('🎉 Course Navette completado.'); return;
        }
        beep(1200, 0.3); // beep de cambio de nivel
      }
    } else if (st.protocol === 'conconi') {
      st.stage++;
      if (st.stage >= 6) finalizarTest('Test de Conconi finalizado. Analiza la deflexión de FC en la gráfica.');
    } else if (st.protocol === 'cooper') {
      st.stage++;
      if (st.stage >= 12) {
        // Mostrar campo de distancia
        const ec = document.getElementById('oxyf-extra-cooper');
        if (ec) ec.style.display = 'block';
        finalizarTest('12 minutos finalizados. Ingresa la distancia total recorrida.');
      }
    } else if (st.protocol === 'george_fisher') {
      finalizarTest('Test George-Fisher finalizado.');
    } else {
      st.stage++;
    }
  }

  function finalizarTest(msg) {
    st.running = false; stopCrono(); setButtonState('paused');
    typeof toast === 'function' && toast(msg);
  }

  // ── VO₂máx por protocolo ───────────────────────────────────────
  function calcVO2Navette(vel, edad) {
    // Léger et al. 1988
    return (31.025 + 3.238 * vel - 3.248 * edad + 0.1536 * vel * edad).toFixed(1);
  }
  function calcVO2Cooper(distM) {
    return ((distM - 504.9) / 44.73).toFixed(1);
  }
  function calcVO2GF(timeMs, hrFinal, pesoKg, edad, sexo = 1) {
    // Kline et al. 1987
    const timeMin = timeMs / 60000;
    const pesoLbs = pesoKg * 2.205;
    return (132.853 - 0.0769 * pesoLbs - 0.3877 * edad + 6.315 * sexo - 3.2649 * timeMin - 0.1565 * hrFinal).toFixed(1);
  }

  function calcularCooperFinal() {
    const distM = parseFloat(document.getElementById('oxyf-cooper-m')?.value);
    if (!distM || distM < 100) {
      typeof toast === 'function' && toast('Ingresa una distancia válida en metros.', true); return;
    }
    const vo2 = calcVO2Cooper(distM);
    actualizarReporteConVO2(vo2, `Distancia: ${distM} m | VO₂máx (Cooper, 1968): <strong>${vo2} ml·kg⁻¹·min⁻¹</strong>`);
    typeof toast === 'function' && toast(`VO₂máx estimado: ${vo2} ml/kg/min`);
  }

  function actualizarReporteConVO2(vo2, html) {
    document.querySelectorAll('.oxyf-report-conclusion').forEach(el => {
      el.innerHTML = html;
    });
  }

  // ── Tabla ──────────────────────────────────────────────────────
  function buildTable() {
    const thead = document.getElementById('encabezado-tabla');
    const tbody = document.getElementById('cuerpo-tabla');
    const title = document.getElementById('titulo-tabla');
    if (!thead || !tbody) return;
    tbody.innerHTML = '';

    const NAMES = {
      navette: 'Course Navette (21 niveles)',
      conconi: 'Test de Conconi (6 etapas)',
      cooper:  'Test de Cooper (12 min)',
      george_fisher: 'George-Fisher (1.6 km)'
    };
    if (title) title.textContent = `📊 ${NAMES[st.protocol] || 'Telemetría'}`;

    if (st.athletes.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="oxyf-tbl-empty">Agrega atletas para comenzar</td></tr>';
      thead.innerHTML = '';
      return;
    }

    const hrCols = st.athletes.map(a =>
      `<th style="color:${a.color}">${a.nombre}<br><small>BPM</small></th>`
    ).join('');
    thead.innerHTML = `<tr>
      <th>Etapa</th><th>Tiempo</th><th>Distancia</th><th>Vel.</th>
      ${hrCols}
      <th>VO₂ est.</th>
    </tr>`;

    if (st.recordings.length === 0) {
      tbody.innerHTML = '<tr><td colspan="' + (4 + st.athletes.length + 1) + '" class="oxyf-tbl-empty">Inicia el test y presiona REGISTRAR para capturar lecturas</td></tr>';
    } else {
      st.recordings.forEach(appendTableRow);
    }
  }

  function appendTableRow(rec) {
    const tbody = document.getElementById('cuerpo-tabla');
    if (!tbody) return;
    // Limpiar fila vacía si existe
    const empty = tbody.querySelector('.oxyf-tbl-empty');
    if (empty) empty.parentElement.remove();

    const hrCols = rec.hrData.map(h =>
      `<td class="oxyf-td-bpm" style="color:${h.color}">${h.bpm != null ? h.bpm : '—'}</td>`
    ).join('');

    // VO₂ simple (Fox et al.)
    const bpms  = rec.hrData.map(h => h.bpm).filter(Boolean);
    const avgBpm = bpms.length ? bpms.reduce((s,v) => s+v,0) / bpms.length : 0;
    const edad   = st.athletes[0]?.edad || 30;
    const vo2    = avgBpm > 0 ? (15 * (220 - edad) / avgBpm).toFixed(1) : '—';

    const distTxt = rec.dist != null ? `${rec.dist} m` : '—';
    const velTxt  = rec.vel  > 0     ? `${rec.vel} km/h` : '—';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="oxyf-td-stage">${rec.etiqueta}</td>
      <td class="oxyf-td-time">${rec.tiempo}</td>
      <td>${distTxt}</td>
      <td>${velTxt}</td>
      ${hrCols}
      <td>${vo2}</td>`;
    tbody.appendChild(tr);
    const scroll = tbody.closest('.oxyf-tbl-scroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  // ── Gráfico ────────────────────────────────────────────────────
  function rebuildChart() {
    const canvas = document.getElementById('canvasGrafico');
    if (!canvas || !window.Chart) return;
    if (st.chart) { st.chart.destroy(); st.chart = null; }

    const ctx = canvas.getContext('2d');

    // Plugin: bandas de zonas FC detrás del gráfico
    const zonePlugin = {
      id: 'hrZones',
      beforeDatasetsDraw(chart) {
        const { ctx: c, chartArea, scales } = chart;
        if (!chartArea || !scales.y) return;
        const zones = [
          { lo: 170, hi: 215, color: 'rgba(239,68,68,.07)'  },
          { lo: 150, hi: 170, color: 'rgba(249,115,22,.06)' },
          { lo: 130, hi: 150, color: 'rgba(234,179,8,.05)'  },
          { lo: 110, hi: 130, color: 'rgba(34,197,94,.05)'  },
        ];
        c.save();
        zones.forEach(z => {
          const y1 = scales.y.getPixelForValue(Math.min(z.hi, 215));
          const y2 = scales.y.getPixelForValue(Math.max(z.lo, 50));
          c.fillStyle = z.color;
          c.fillRect(chartArea.left, y1, chartArea.width, y2 - y1);
        });
        c.restore();
      }
    };

    // Dataset FC por atleta con relleno degradado
    const ds = st.athletes.map(a => {
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.offsetHeight || 280);
      grad.addColorStop(0, a.color + 'cc');
      grad.addColorStop(0.7, a.color + '18');
      grad.addColorStop(1, a.color + '00');
      return {
        label: a.nombre, type: 'line', data: [],
        borderColor: a.color, backgroundColor: grad,
        borderWidth: 3, tension: 0.4, yAxisID: 'y',
        pointRadius: 7, pointHoverRadius: 11,
        pointBackgroundColor: '#fff', pointBorderColor: a.color, pointBorderWidth: 2.5,
        fill: true
      };
    });

    // Dataset velocidad
    ds.push({
      label: 'Velocidad', type: 'line', data: [],
      borderColor: '#94a3b8', borderDash: [7, 4], borderWidth: 2,
      backgroundColor: 'transparent',
      tension: 0.1, yAxisID: 'y1',
      pointRadius: 4, pointHoverRadius: 7,
      pointBackgroundColor: '#94a3b8', pointBorderColor: '#fff', pointBorderWidth: 1.5,
      fill: false
    });

    st.chart = new window.Chart(canvas, {
      plugins: [zonePlugin],
      data: { labels: [], datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 400, easing: 'easeInOutQuart' },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              font: { size: 12, weight: '700', family: 'Inter, sans-serif' },
              usePointStyle: true, pointStyleWidth: 12,
              color: '#1e293b', padding: 22, boxHeight: 8
            }
          },
          tooltip: {
            backgroundColor: '#0b2748',
            titleColor: '#74e4d7',
            bodyColor: '#c8ddf0',
            titleFont: { size: 12, weight: '900' },
            bodyFont: { size: 11.5 },
            padding: 14, cornerRadius: 12,
            borderColor: '#1e4080', borderWidth: 1,
            displayColors: true,
            callbacks: {
              title: (items) => `📍 ${items[0].label}`,
              label: (item) => {
                if (item.dataset.yAxisID === 'y1') return `  🏃 Vel: ${item.parsed.y ?? '—'} km/h`;
                return `  ❤️ ${item.dataset.label}: ${item.parsed.y ?? '—'} bpm`;
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(203,213,225,.5)', drawBorder: false },
            ticks: { font: { size: 11, weight: '700' }, color: '#64748b', maxRotation: 0 },
            border: { display: false }
          },
          y: {
            min: 50, max: 215, position: 'left',
            title: { display: true, text: 'FC (bpm)', font: { weight: '900', size: 11 }, color: '#64748b' },
            grid: { color: 'rgba(203,213,225,.4)', drawBorder: false },
            ticks: { font: { size: 10 }, color: '#64748b', stepSize: 30 },
            border: { display: false }
          },
          y1: {
            min: 0, max: 22, position: 'right',
            title: { display: true, text: 'km/h', font: { weight: '900', size: 11 }, color: '#94a3b8' },
            grid: { drawOnChartArea: false, drawBorder: false },
            ticks: { font: { size: 10 }, color: '#94a3b8' },
            border: { display: false }
          }
        }
      }
    });
  }

  function updateChart(rec) {
    if (!st.chart) return;
    st.chart.data.labels.push(rec.etiqueta);
    st.athletes.forEach((a, i) => {
      const h = rec.hrData.find(x => x.id === a.id);
      st.chart.data.datasets[i].data.push(h?.bpm ?? null);
    });
    st.chart.data.datasets[st.athletes.length].data.push(rec.vel || null);
    st.chart.update('active');
  }

  // ── Reporte ────────────────────────────────────────────────────
  function actualizarReporte() {
    const el = document.getElementById('cuerpo-interpretacion');
    if (!el || st.recordings.length === 0) return;

    const lev      = NAVETTE[Math.min(st.stage, NAVETTE.length - 1)];
    const lastRec  = st.recordings[st.recordings.length - 1];

    let html = '';
    st.athletes.forEach(a => {
      const myHR = st.recordings.map(r => r.hrData.find(h => h.id === a.id)?.bpm).filter(Boolean);
      if (!myHR.length) return;
      const fcMax  = Math.max(...myHR);
      const fcMin  = myHR[0];
      const fcAct  = myHR[myHR.length - 1];
      const fcTeo  = 220 - a.edad;
      const pct    = ((fcMax / fcTeo) * 100).toFixed(1);

      let conclusion = '';
      if (st.protocol === 'navette') {
        const vo2 = calcVO2Navette(lev.vel, a.edad);
        conclusion = `VO₂máx est. (Léger 1988): <strong>${vo2} ml·kg⁻¹·min⁻¹</strong> | Nivel alcanzado: ${lev.n} | Distancia: ${lastRec.dist ?? '—'} m`;
      } else if (st.protocol === 'cooper') {
        conclusion = 'Ingresa la distancia final para calcular el VO₂máx (Cooper).';
      } else if (st.protocol === 'conconi') {
        conclusion = 'Observa la deflexión en la curva FC/Velocidad — indica el umbral anaeróbico (VAD).';
      } else if (st.protocol === 'george_fisher') {
        const pesoKg = parseFloat(document.getElementById('oxyf-gf-weight')?.value) || 70;
        const vo2    = calcVO2GF(ms, fcAct, pesoKg, a.edad);
        conclusion = `VO₂máx est. (Kline 1987): <strong>${vo2} ml·kg⁻¹·min⁻¹</strong> | Tiempo: ${lastRec.tiempo} | FC llegada: ${fcAct} bpm`;
      }

      html += `<div class="oxyf-report-card" style="border-left-color:${a.color}">
        <div class="oxyf-report-header">
          <span class="oxyf-report-name" style="color:${a.color}">${a.nombre}</span>
          <span class="oxyf-report-meta">${a.edad} años · ID ${a.id}</span>
        </div>
        <div class="oxyf-report-kpis">
          <div><span>FC Basal</span><strong>${fcMin}</strong></div>
          <div><span>FC Máx.</span><strong>${fcMax}</strong></div>
          <div><span>FC Actual</span><strong>${fcAct}</strong></div>
          <div><span>% FC Teórica</span><strong>${pct}%</strong></div>
        </div>
        <div class="oxyf-report-conclusion">${conclusion}</div>
        <label class="oxyf-nota-label">Nota del evaluador:</label>
        <textarea class="oxyf-nota" rows="2" data-atleta-id="${a.id}" placeholder="Observaciones clínicas…">${a.nota || ''}</textarea>
      </div>`;
    });

    el.innerHTML = html || '<p class="oxyf-report-empty">Sin lecturas de FC registradas aún.</p>';
    el.querySelectorAll('.oxyf-nota').forEach(ta => {
      ta.addEventListener('input', () => {
        const a = st.athletes.find(x => x.id === ta.dataset.atletaId);
        if (a) a.nota = ta.value;
      });
    });
  }

  // ── Audio ──────────────────────────────────────────────────────
  function beep(freq, dur) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.frequency.value = freq; g.gain.value = 0.1;
      osc.connect(g); g.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch {}
  }

  // ── Eventos ────────────────────────────────────────────────────
  function bindEvents() {
    document.getElementById('oxyBtnStart')?.addEventListener('click', iniciar);
    document.getElementById('oxyBtnPause')?.addEventListener('click', pausar);
    document.getElementById('oxyBtnReset')?.addEventListener('click', reiniciar);
    document.getElementById('oxyBtnRegistrar')?.addEventListener('click', registrarLectura);
    document.getElementById('oxyAddAthlete')?.addEventListener('click', agregarAtleta);
    document.getElementById('oxyImportAthletes')?.addEventListener('click', importarAtletasBD);
    document.getElementById('oxyAddProtocol')?.addEventListener('click', agregarProtocolo);
    document.getElementById('oxyEditProtocol')?.addEventListener('click', editarProtocolo);
    document.getElementById('oxyDelProtocol')?.addEventListener('click', eliminarProtocolo);
    document.getElementById('oxyBtnCooperCalc')?.addEventListener('click', calcularCooperFinal);
    document.getElementById('oxyPrintReport')?.addEventListener('click', () => window.print());

    document.getElementById('atleta-nombre')?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); agregarAtleta(); }
    });

    document.getElementById('protocolo-selector')?.addEventListener('change', e => {
      st.protocol = e.target.value;
      updateProtoBadge();
      reiniciar();
    });

    // Delegation — lista de atletas
    document.getElementById('lista-atletas-registro')?.addEventListener('click', e => {
      const bt  = e.target.closest('[data-bt]');
      const del = e.target.closest('[data-del-atleta]');
      if (bt)  conectarH10(bt.dataset.bt);
      if (del) {
        st.athletes = st.athletes.filter(a => a.id !== del.dataset.delAtleta);
        renderAthleteList(); buildTable(); rebuildChart();
      }
    });
  }

})();
