'use strict';

/* ─────────────────────────────────────────────────────────────
   OXYFIELD PRO — Motor fisiológico integrado
   Cambios respecto al HTML original:
   • Cronómetro con requestAnimationFrame en vez de setInterval 10ms
   • Sin alert/confirm/prompt — usa showConfirm/showPrompt/toast del app principal
   • Carga atletas desde /api/athletes con botón "⬇ BD"
   • Event delegation en vez de onclick inline
─────────────────────────────────────────────────────────────── */

(function () {
  let initialized = false;

  window.oxyfieldInit = function () {
    if (initialized) return;
    initialized = true;
    renderizarSelectorProtocolos();
    actualizarInterfazAtletas();
    preconstruirEstructuraTabla();
    inicializarGraficoBasico();
    arrancarMonitorFisiologicoGlobal();
    bindOxyEvents();
  };

  // ── Estado ──────────────────────────────────────────────────
  let listaAtletas = [
    { id: '01', nombre: 'ATLETA 1', edad: 30, color: '#1a73e8', fcActual: 0, estadoEnlace: 'desconectado', notasPersonalizadas: null }
  ];

  let listaProtocolos = [
    { id: 'navette',      nombre: 'Course Navette (20m - 21 Niveles)', estadios: 21 },
    { id: 'conconi',      nombre: 'Test de Conconi (Umbral de Deflexión)', estadios: 6 },
    { id: 'cooper',       nombre: 'Test de Cooper (Resistencia - 12 min)', estadios: 12 },
    { id: 'george_fisher',nombre: 'George-Fisher (Caminata 1 Milla / 1.6 km)', estadios: 15 }
  ];

  let dispositivosBluetoothActivos = {};
  let appActiva = false;
  let protocoloActualId = 'navette';

  // Cronómetro RAF
  let rafId = null;
  let rafStartTime = null;
  let tiempoOffset = 0;
  let tiempoMs = 0;

  let monitorFisiologico = null;
  let timeoutEstadio = null;
  let chartInstancia = null;
  let motor = { estadioActual: 1, subPeriodo: 1, velocidad: 8.5, totalEstadios: 21 };

  const tramosNavette = [
    { n:1,v:7,vel:8.5},{n:2,v:8,vel:9.0},{n:3,v:8,vel:9.5},
    {n:4,v:9,vel:10.0},{n:5,v:9,vel:10.5},{n:6,v:10,vel:11.0},
    {n:7,v:10,vel:11.5},{n:8,v:11,vel:12.0},{n:9,v:11,vel:12.5},
    {n:10,v:12,vel:13.0},{n:11,v:12,vel:13.5},{n:12,v:13,vel:14.0},
    {n:13,v:13,vel:14.5},{n:14,v:14,vel:15.0},{n:15,v:14,vel:15.5},
    {n:16,v:15,vel:16.0},{n:17,v:15,vel:16.5},{n:18,v:16,vel:17.0},
    {n:19,v:16,vel:17.5},{n:20,v:17,vel:18.0},{n:21,v:17,vel:18.5}
  ];

  // ── Cronómetro RAF (sin setInterval 10ms) ──────────────────
  function iniciarDisplayCronometro() {
    if (rafId) return;
    rafStartTime = performance.now();
    function tick(now) {
      if (!appActiva) { rafId = null; return; }
      tiempoMs = tiempoOffset + (now - rafStartTime);
      const totalS = Math.floor(tiempoMs / 1000);
      const min = String(Math.floor(totalS / 60)).padStart(2, '0');
      const sec = String(totalS % 60).padStart(2, '0');
      const cs  = String(Math.floor((tiempoMs % 1000) / 10)).padStart(2, '0');
      const el = document.getElementById('main-cronometro');
      if (el) el.textContent = `${min}:${sec}.${cs}`;
      rafId = requestAnimationFrame(tick);
    }
    rafId = requestAnimationFrame(tick);
  }

  function pararDisplayCronometro() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    if (rafStartTime !== null) tiempoOffset = tiempoMs;
  }

  function resetDisplayCronometro() {
    pararDisplayCronometro();
    tiempoMs = 0; tiempoOffset = 0; rafStartTime = null;
    const el = document.getElementById('main-cronometro');
    if (el) el.textContent = '00:00.00';
  }

  // ── Utilidades ───────────────────────────────────────────────
  function formatearTiempoTeorico(s) {
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
  }

  function generarSenalAudio(freq, dur) {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + dur);
    } catch {}
  }

  // ── Protocolos ───────────────────────────────────────────────
  function renderizarSelectorProtocolos() {
    const sel = document.getElementById('protocolo-selector');
    if (!sel) return;
    sel.innerHTML = listaProtocolos.map(p =>
      `<option value="${p.id}"${p.id === protocoloActualId ? ' selected' : ''}>${p.nombre}</option>`
    ).join('');
  }

  async function agregarNuevoProtocolo() {
    const nombre = await showPrompt('Nombre del nuevo protocolo:', '', 'Nuevo protocolo');
    if (!nombre || !nombre.trim()) return;
    const estadiosStr = await showPrompt('Número de etapas:', '10', 'Etapas del protocolo');
    const estadios = parseInt(estadiosStr) || 10;
    const nuevoId = 'custom_' + Date.now();
    listaProtocolos.push({ id: nuevoId, nombre: nombre.trim(), estadios });
    protocoloActualId = nuevoId;
    renderizarSelectorProtocolos();
    reiniciarTest();
    toast(`Protocolo "${nombre}" creado.`);
  }

  async function editarProtocoloActual() {
    const prot = listaProtocolos.find(p => p.id === protocoloActualId);
    if (!prot) return;
    const nuevoNombre = await showPrompt('Editar nombre:', prot.nombre, 'Editar protocolo');
    if (nuevoNombre && nuevoNombre.trim()) {
      prot.nombre = nuevoNombre.trim();
      renderizarSelectorProtocolos();
      preconstruirEstructuraTabla();
    }
  }

  async function eliminarProtocoloActual() {
    if (listaProtocolos.length <= 1) { toast('Debe existir al menos un protocolo.', true); return; }
    const prot = listaProtocolos.find(p => p.id === protocoloActualId);
    const ok = await showConfirm(`¿Eliminar el protocolo "${prot.nombre}"?`, 'Eliminar protocolo');
    if (ok) {
      listaProtocolos = listaProtocolos.filter(p => p.id !== protocoloActualId);
      protocoloActualId = listaProtocolos[0].id;
      renderizarSelectorProtocolos();
      reiniciarTest();
    }
  }

  function cambiarProtocolo() {
    const sel = document.getElementById('protocolo-selector');
    if (sel) protocoloActualId = sel.value;
    reiniciarTest();
  }

  // ── Bluetooth ─────────────────────────────────────────────────
  async function gestionarEnlacePolar(id) {
    const atleta = listaAtletas.find(a => a.id === id);
    if (!atleta) return;

    if (atleta.estadoEnlace === 'desconectado') {
      try {
        atleta.estadoEnlace = 'buscando';
        actualizarInterfazAtletas();
        const dispositivo = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
        dispositivo.addEventListener('gattserverdisconnected', () => {
          atleta.estadoEnlace = 'desconectado'; atleta.fcActual = 0;
          delete dispositivosBluetoothActivos[id];
          actualizarInterfazAtletas();
          toast(`Sensor de ${atleta.nombre} desconectado.`, true);
        });
        const servidor = await dispositivo.gatt.connect();
        const servicio = await servidor.getPrimaryService('heart_rate');
        const caracteristica = await servicio.getCharacteristic('heart_rate_measurement');
        await caracteristica.startNotifications();
        caracteristica.addEventListener('characteristicvaluechanged', (e) => {
          const dv = e.target.value, flags = dv.getUint8(0);
          atleta.fcActual = (flags & 0x01) === 0 ? dv.getUint8(1) : dv.getUint16(1, true);
          const nodo = document.getElementById(`live-fc-${atleta.id}`);
          if (nodo) nodo.textContent = atleta.fcActual;
        });
        atleta.estadoEnlace = 'conectado';
        dispositivosBluetoothActivos[id] = dispositivo;
        actualizarInterfazAtletas();
      } catch (error) {
        atleta.estadoEnlace = 'desconectado';
        actualizarInterfazAtletas();
        toast('Conexión cancelada o dispositivo no encontrado.', true);
      }
    } else if (atleta.estadoEnlace === 'conectado') {
      const ok = await showConfirm(`¿Desconectar sensor de ${atleta.nombre}?`, 'Desconectar sensor');
      if (ok && dispositivosBluetoothActivos[id]) dispositivosBluetoothActivos[id].gatt.disconnect();
    }
  }

  // ── Interfaz atletas ──────────────────────────────────────────
  function actualizarInterfazAtletas() {
    const contenedor = document.getElementById('lista-atletas-registro');
    if (!contenedor) return;
    contenedor.innerHTML = listaAtletas.map(atleta => {
      let badge = '';
      if (atleta.estadoEnlace === 'desconectado')
        badge = `<button class="oxy-badge-link" data-link="${atleta.id}">🔗 Enlazar H10</button>`;
      else if (atleta.estadoEnlace === 'buscando')
        badge = `<span class="oxy-badge-buscando">⏳ Buscando...</span>`;
      else
        badge = `<button class="oxy-badge-conectado" data-link="${atleta.id}">❤️ <span id="live-fc-${atleta.id}">${atleta.fcActual}</span> lpm</button>`;

      return `<div class="oxy-atleta-row">
        <div class="oxy-atleta-info">
          <div><strong>ID ${atleta.id}</strong> — ${atleta.nombre} (${atleta.edad} años)</div>
          <div>${badge}</div>
        </div>
        <div class="oxy-atleta-btns">
          <button class="oxy-icon-btn oxy-orange" data-edit-atleta="${atleta.id}">✏️</button>
          <button class="oxy-icon-btn oxy-red" data-del-atleta="${atleta.id}">🗑️</button>
        </div>
      </div>`;
    }).join('');
  }

  function arrancarMonitorFisiologicoGlobal() {
    if (monitorFisiologico) clearInterval(monitorFisiologico);
    monitorFisiologico = setInterval(() => {
      listaAtletas.forEach(a => {
        if (a.estadoEnlace === 'conectado') {
          const n = document.getElementById(`live-fc-${a.id}`);
          if (n) n.textContent = a.fcActual;
        }
      });
      if (appActiva) {
        const el = document.getElementById('head-smo2');
        if (el) el.textContent = `SmO₂: ${Math.max(35, 75 - motor.estadioActual * 2)}%`;
      }
    }, 1000);
  }

  // ── Tabla de telemetría ────────────────────────────────────────
  function preconstruirEstructuraTabla() {
    const thHead = document.getElementById('encabezado-tabla');
    const tbody  = document.getElementById('cuerpo-tabla');
    const titulo = document.getElementById('titulo-tabla');
    if (!thHead || !tbody) return;
    tbody.innerHTML = '';
    let t = 0;
    const protConfig = listaProtocolos.find(p => p.id === protocoloActualId);

    if (protocoloActualId === 'conconi') {
      if (titulo) titulo.textContent = '📋 TELEMETRÍA — TEST DE CONCONI';
      thHead.innerHTML = '<tr><th>Estadio</th><th>ID</th><th>Distancia</th><th>Velocidad</th><th>FC (lpm)</th><th>Tiempo</th></tr>';
      motor.totalEstadios = 6;
      listaAtletas.forEach(a => {
        const tr = document.createElement('tr');
        tr.id = `celda-conconi-0-${a.id}`; tr.className = 'oxy-fila-reposo';
        tr.innerHTML = `<td>0 (Basal)</td><td><strong>${a.id}</strong></td><td>0m</td><td>0.0</td><td class="col-fc">---</td><td class="col-t">00:00</td>`;
        tbody.appendChild(tr);
      });
      for (let e = 1; e <= 6; e++) {
        const v = 8.0 + (e - 1) * 0.5;
        t += 720 / v;
        listaAtletas.forEach(a => {
          const tr = document.createElement('tr');
          tr.id = `celda-conconi-${e}-${a.id}`;
          tr.innerHTML = `<td>${e}</td><td><strong>${a.id}</strong></td><td>${(e-1)*200}–${e*200}m</td><td>${v.toFixed(1)}</td><td class="col-fc">---</td><td class="col-t">${formatearTiempoTeorico(t)}</td>`;
          tbody.appendChild(tr);
        });
      }
    } else if (protocoloActualId === 'navette') {
      if (titulo) titulo.textContent = '🧬 TELEMETRÍA — COURSE NAVETTE (21 NIVELES)';
      thHead.innerHTML = '<tr><th>Nivel</th><th>Vuelta</th><th>ID</th><th>Velocidad</th><th>Distancia</th><th>FC (lpm)</th><th>Tiempo</th></tr>';
      motor.totalEstadios = tramosNavette.length;
      listaAtletas.forEach(a => {
        const tr = document.createElement('tr');
        tr.id = `celda-navette-0-0-${a.id}`; tr.className = 'oxy-fila-reposo';
        tr.innerHTML = `<td>0</td><td>0</td><td><strong>${a.id}</strong></td><td>0.0</td><td>0m</td><td class="col-fc">---</td><td class="col-t">00:00</td>`;
        tbody.appendChild(tr);
      });
      tramosNavette.forEach(tramo => {
        for (let vu = 1; vu <= tramo.v; vu++) {
          t += 72 / tramo.vel;
          listaAtletas.forEach(a => {
            const tr = document.createElement('tr');
            tr.id = `celda-navette-${tramo.n}-${vu}-${a.id}`;
            tr.innerHTML = `<td>${tramo.n}</td><td>${vu}</td><td><strong>${a.id}</strong></td><td>${tramo.vel.toFixed(1)}</td><td>${vu*20}m</td><td class="col-fc">---</td><td class="col-t">${formatearTiempoTeorico(t)}</td>`;
            tbody.appendChild(tr);
          });
        }
      });
    } else if (protocoloActualId === 'cooper') {
      if (titulo) titulo.textContent = '🏃 TELEMETRÍA — TEST DE COOPER (12 MIN)';
      thHead.innerHTML = '<tr><th>Minuto</th><th>ID</th><th>Distancia Est.</th><th>Velocidad</th><th>FC (lpm)</th><th>Tiempo</th></tr>';
      motor.totalEstadios = 12;
      listaAtletas.forEach(a => {
        const tr = document.createElement('tr');
        tr.id = `celda-cooper-0-${a.id}`; tr.className = 'oxy-fila-reposo';
        tr.innerHTML = `<td>0</td><td><strong>${a.id}</strong></td><td>0 m</td><td>0.0</td><td class="col-fc">---</td><td class="col-t">00:00</td>`;
        tbody.appendChild(tr);
      });
      for (let m = 1; m <= 12; m++) {
        listaAtletas.forEach(a => {
          const tr = document.createElement('tr');
          tr.id = `celda-cooper-${m}-${a.id}`;
          tr.innerHTML = `<td>${m} Min</td><td><strong>${a.id}</strong></td><td class="col-dist">Calculando...</td><td>12.0 km/h</td><td class="col-fc">---</td><td class="col-t">${String(m).padStart(2,'0')}:00</td>`;
          tbody.appendChild(tr);
        });
      }
    } else if (protocoloActualId === 'george_fisher') {
      if (titulo) titulo.textContent = 'WALK TEST — GEORGE-FISHER (1.6 KM)';
      thHead.innerHTML = '<tr><th>Minuto</th><th>ID</th><th>Distancia</th><th>Marcha</th><th>FC (lpm)</th><th>Tiempo</th></tr>';
      motor.totalEstadios = 15;
      listaAtletas.forEach(a => {
        const tr = document.createElement('tr');
        tr.id = `celda-george_fisher-0-${a.id}`; tr.className = 'oxy-fila-reposo';
        tr.innerHTML = `<td>0 (Basal)</td><td><strong>${a.id}</strong></td><td>0 m</td><td>0.0</td><td class="col-fc">---</td><td class="col-t">00:00</td>`;
        tbody.appendChild(tr);
      });
      for (let m = 1; m <= 15; m++) {
        const dist = Math.min(1609, Math.round((1609/12)*m));
        listaAtletas.forEach(a => {
          const tr = document.createElement('tr');
          tr.id = `celda-george_fisher-${m}-${a.id}`;
          tr.innerHTML = `<td>Minuto ${m}</td><td><strong>${a.id}</strong></td><td>${dist} m/1609m</td><td>6.5 km/h</td><td class="col-fc">---</td><td class="col-t">${String(m).padStart(2,'0')}:00</td>`;
          tbody.appendChild(tr);
        });
      }
    } else {
      const cant = protConfig ? protConfig.estadios : 10;
      if (titulo) titulo.textContent = `⚙️ TELEMETRÍA — ${protConfig ? protConfig.nombre.toUpperCase() : 'PERSONALIZADO'}`;
      thHead.innerHTML = '<tr><th>Etapa</th><th>ID</th><th>Modo</th><th>FC (lpm)</th><th>Tiempo</th></tr>';
      motor.totalEstadios = cant;
      listaAtletas.forEach(a => {
        const tr = document.createElement('tr');
        tr.id = `celda-custom-0-${a.id}`; tr.className = 'oxy-fila-reposo';
        tr.innerHTML = `<td>0 (Basal)</td><td><strong>${a.id}</strong></td><td>Reposo</td><td class="col-fc">---</td><td class="col-t">00:00</td>`;
        tbody.appendChild(tr);
      });
      for (let e = 1; e <= cant; e++) {
        listaAtletas.forEach(a => {
          const tr = document.createElement('tr');
          tr.id = `celda-custom-${e}-${a.id}`;
          tr.innerHTML = `<td>Etapa ${e}</td><td><strong>${a.id}</strong></td><td>Carga Dinámica</td><td class="col-fc">---</td><td class="col-t">${String(e).padStart(2,'0')}:00</td>`;
          tbody.appendChild(tr);
        });
      }
    }
  }

  // ── Test ─────────────────────────────────────────────────────
  function registrarFilaBaseReposo() {
    if (!chartInstancia) return;
    if (!chartInstancia.data.labels.includes('Reposo')) chartInstancia.data.labels.push('Reposo');
    listaAtletas.forEach((atleta, index) => {
      let rowId = rowIdFor(0, 0, atleta.id);
      const fila = document.getElementById(rowId);
      const fc = atleta.estadoEnlace === 'conectado' ? atleta.fcActual : null;
      if (fila) { fila.classList.add('oxy-fila-ok'); fila.querySelector('.col-fc').textContent = fc ? fc : '0 (Desc.)'; }
      if (chartInstancia.data.datasets[index]) chartInstancia.data.datasets[index].data.push(fc);
    });
    if (chartInstancia.data.datasets[listaAtletas.length]) chartInstancia.data.datasets[listaAtletas.length].data.push(0);
    chartInstancia.update();
    actualizarReporteClinico();
  }

  function rowIdFor(estadio, vuelta, atletaId) {
    if (protocoloActualId === 'conconi')       return `celda-conconi-${estadio}-${atletaId}`;
    if (protocoloActualId === 'navette')        return `celda-navette-${estadio}-${vuelta}-${atletaId}`;
    if (protocoloActualId === 'cooper')         return `celda-cooper-${estadio}-${atletaId}`;
    if (protocoloActualId === 'george_fisher')  return `celda-george_fisher-${estadio}-${atletaId}`;
    return `celda-custom-${estadio}-${atletaId}`;
  }

  function iniciarTest() {
    if (appActiva) return;
    if (listaAtletas.length === 0) { toast('Añade al menos un atleta antes de iniciar.', true); return; }
    registrarFilaBaseReposo();
    appActiva = true;
    iniciarDisplayCronometro();
    procesarCicloFisiologico();
  }

  function pausarTest() {
    appActiva = false;
    pararDisplayCronometro();
    if (timeoutEstadio) { clearTimeout(timeoutEstadio); timeoutEstadio = null; }
  }

  function reiniciarTest() {
    pausarTest();
    resetDisplayCronometro();
    motor.estadioActual = 1; motor.subPeriodo = 1;
    listaAtletas.forEach(a => { a.notasPersonalizadas = null; });
    const el = document.getElementById('head-smo2');
    if (el) el.textContent = 'SmO₂: --%';
    const rep = document.getElementById('cuerpo-interpretacion');
    if (rep) rep.innerHTML = '<p style="text-align:center;color:#64748b;font-style:italic;margin:0">El análisis se autogenerará conforme se registren lecturas.</p>';
    preconstruirEstructuraTabla();
    inicializarGraficoBasico();
    actualizarInterfazAtletas();
  }

  function procesarCicloFisiologico() {
    if (!appActiva) return;
    let dur = 0;
    if (protocoloActualId === 'conconi')
      dur = (720 / (8.0 + (motor.estadioActual - 1) * 0.5)) * 1000;
    else if (protocoloActualId === 'navette')
      dur = (72 / (tramosNavette[motor.estadioActual - 1] || tramosNavette[0]).vel) * 1000;
    else if (protocoloActualId === 'cooper' || protocoloActualId === 'george_fisher')
      dur = 60000;
    else
      dur = 30000;
    timeoutEstadio = setTimeout(completarBloqueActual, dur);
  }

  function completarBloqueActual() {
    let tagX = '', velActual = 0;
    const confNivNavette = tramosNavette[motor.estadioActual - 1] || tramosNavette[0];
    if (protocoloActualId === 'conconi')      { tagX = `E${motor.estadioActual}`; velActual = 8.0 + (motor.estadioActual-1)*0.5; }
    else if (protocoloActualId === 'navette') { tagX = `N${motor.estadioActual}-V${motor.subPeriodo}`; velActual = confNivNavette.vel; }
    else if (protocoloActualId === 'cooper')  { tagX = `M${motor.estadioActual}`; velActual = 12.0; }
    else if (protocoloActualId === 'george_fisher') { tagX = `M${motor.estadioActual}`; velActual = 6.5; }
    else { tagX = `P${motor.estadioActual}`; velActual = 10.0; }

    if (chartInstancia) chartInstancia.data.labels.push(tagX);

    listaAtletas.forEach((atleta, index) => {
      const rowId = rowIdFor(motor.estadioActual, motor.subPeriodo, atleta.id);
      const fila = document.getElementById(rowId);
      const fc = atleta.estadoEnlace === 'conectado' ? atleta.fcActual : 0;
      if (fila) {
        fila.classList.add('oxy-fila-ok');
        fila.querySelector('.col-fc').textContent = fc > 0 ? fc : '0 (Desc.)';
        if (protocoloActualId === 'cooper') {
          const dEl = fila.querySelector('.col-dist');
          if (dEl) dEl.textContent = `${Math.round(((12*1000)/60)*motor.estadioActual)} m`;
        }
      }
      if (chartInstancia && chartInstancia.data.datasets[index])
        chartInstancia.data.datasets[index].data.push(fc > 0 ? fc : null);
    });

    if (chartInstancia && chartInstancia.data.datasets[listaAtletas.length])
      chartInstancia.data.datasets[listaAtletas.length].data.push(velActual);
    if (chartInstancia) chartInstancia.update();
    actualizarReporteClinico();

    if (protocoloActualId === 'conconi') {
      if (motor.estadioActual >= motor.totalEstadios) return terminarTestGrupal('Test de Conconi finalizado.');
      motor.estadioActual++;
    } else if (protocoloActualId === 'navette') {
      const maxVueltas = confNivNavette.v;
      if (motor.subPeriodo < maxVueltas) {
        motor.subPeriodo++;
        generarSenalAudio(850, 0.15);
      } else {
        if (motor.estadioActual >= tramosNavette.length) {
          generarSenalAudio(440, 0.6);
          return terminarTestGrupal('¡Course Navette completado!');
        }
        motor.estadioActual++; motor.subPeriodo = 1;
        generarSenalAudio(1300, 0.40);
      }
    } else if (protocoloActualId === 'cooper') {
      if (motor.estadioActual >= motor.totalEstadios) return terminarTestGrupal('Test de Cooper finalizado.');
      motor.estadioActual++;
    } else if (protocoloActualId === 'george_fisher') {
      if (motor.estadioActual >= motor.totalEstadios) return terminarTestGrupal('Test George-Fisher finalizado (1 Milla).');
      motor.estadioActual++;
    } else {
      if (motor.estadioActual >= motor.totalEstadios) return terminarTestGrupal('Protocolo personalizado finalizado.');
      motor.estadioActual++;
    }
    procesarCicloFisiologico();
  }

  function terminarTestGrupal(msg) {
    appActiva = false;
    pararDisplayCronometro();
    toast(msg);
  }

  // ── Gráfico ──────────────────────────────────────────────────
  function inicializarGraficoBasico() {
    const canvas = document.getElementById('canvasGrafico');
    if (!canvas || !window.Chart) return;
    const ctx = canvas.getContext('2d');
    if (chartInstancia) chartInstancia.destroy();

    const COLORES = ['#1a73e8','#e63994','#f5a623','#0fc187'];
    const datasets = listaAtletas.map((a, i) => ({
      label: `FC Atleta ID ${a.id} (lpm)`, data: [],
      borderColor: a.color || COLORES[i % 4],
      backgroundColor: a.color || COLORES[i % 4],
      borderWidth: 2, tension: 0.15, yAxisID: 'y'
    }));
    datasets.push({
      label: 'Velocidad (km/h)', data: [],
      borderColor: '#64748b', backgroundColor: 'rgba(100,116,139,.05)',
      borderWidth: 2, borderDash: [5,5], tension: 0, yAxisID: 'y1'
    });

    chartInstancia = new window.Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 300 },
        scales: {
          x: { title: { display: true, text: 'Etapas de Carga' } },
          y: { min: 50, max: 220, position: 'left', title: { display: true, text: 'FC (lpm)' } },
          y1: { min: 0, max: 22, position: 'right', title: { display: true, text: 'Velocidad (km/h)' }, grid: { drawOnChartArea: false } }
        }
      }
    });
  }

  // ── Reporte clínico ───────────────────────────────────────────
  function guardarNotaAtleta(id, texto) {
    const a = listaAtletas.find(x => x.id === id);
    if (a) a.notasPersonalizadas = texto;
  }
  window._oxyGuardarNota = guardarNotaAtleta;

  function actualizarReporteClinico() {
    const contenedor = document.getElementById('cuerpo-interpretacion');
    if (!contenedor || !chartInstancia || listaAtletas.length === 0) return;
    let html = '<h4 style="margin-top:0;color:#0b2748;border-bottom:1px solid #ddd;padding-bottom:4px">Análisis Cardiovascular</h4>';
    listaAtletas.forEach((atleta, index) => {
      const fcs = (chartInstancia.data.datasets[index]?.data || []).filter(v => v !== null && v > 0);
      const color = atleta.color || '#1a73e8';
      if (fcs.length === 0) {
        html += `<div style="padding:8px;border-left:4px solid ${color};margin-bottom:8px;border-radius:4px;border:1px solid #ddd">
          <strong>${atleta.nombre}</strong><br><em style="color:#64748b">Esperando lectura de sensor...</em></div>`;
        return;
      }
      const fcMax = Math.max(...fcs), fcBasal = fcs[0], fcActual = fcs[fcs.length-1];
      const fcMaxTeor = 220 - atleta.edad;
      let auto = '';
      if (protocoloActualId === 'navette') auto = `Course Navette. FC basal ${fcBasal} lpm. Peak ${fcMax} lpm (${((fcMax/fcMaxTeor)*100).toFixed(1)}% FCMáx Teórica).`;
      else if (protocoloActualId === 'conconi') auto = `Conconi. Deflexión aprox. en ${fcMax-10} lpm.`;
      else if (protocoloActualId === 'cooper') auto = `Cooper. Incremento aeróbico +${fcMax-fcBasal} lpm sobre basal.`;
      else if (protocoloActualId === 'george_fisher') auto = `George-Fisher. FC retorno submáximo: ${fcActual} lpm.`;
      else auto = `Protocolo personalizado. Variabilidad ${fcBasal}–${fcMax} lpm.`;

      const nota = (atleta.notasPersonalizadas !== null && atleta.notasPersonalizadas !== undefined)
        ? atleta.notasPersonalizadas : auto;

      html += `<div style="padding:10px;border-left:4px solid ${color};margin-bottom:8px;border-radius:4px;border:1px solid #ddd">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <strong>${atleta.nombre} (${atleta.edad} años)</strong>
          <span style="color:${color};font-weight:bold">ID: ${atleta.id}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:11px;background:#f8fafc;padding:5px;border-radius:4px;margin-bottom:6px">
          <div>Basal: <strong>${fcBasal} lpm</strong></div>
          <div>Máx: <strong>${fcMax} lpm</strong></div>
          <div>Actual: <strong>${fcActual} lpm</strong></div>
          <div>Delta: <strong>+${fcMax-fcBasal} lpm</strong></div>
        </div>
        <label style="font-size:10px;font-weight:bold;color:#475569;display:block;margin-bottom:3px">✍️ Interpretación del Evaluador:</label>
        <textarea class="oxy-nota-eval" rows="2"
          oninput="window._oxyGuardarNota('${atleta.id}',this.value)"
          placeholder="Escribe tu análisis...">${nota}</textarea>
      </div>`;
    });
    contenedor.innerHTML = html;
  }

  // ── Gestión atletas ───────────────────────────────────────────
  function agregarAtleta() {
    const idEl    = document.getElementById('atleta-id');
    const nombreEl = document.getElementById('atleta-nombre');
    const edadEl  = document.getElementById('atleta-edad');
    if (!idEl || !nombreEl) return;
    const id     = idEl.value.trim();
    const nombre = nombreEl.value.trim().toUpperCase();
    const edad   = parseInt(edadEl?.value) || 25;
    if (!id || !nombre) { toast('Introduce el nombre del atleta.', true); return; }
    if (listaAtletas.some(a => a.id === id)) { toast('El ID ya está asignado.', true); return; }
    const COLORES = ['#1a73e8','#e63994','#f5a623','#0fc187'];
    listaAtletas.push({ id, nombre, edad, color: COLORES[listaAtletas.length % 4], fcActual: 0, estadoEnlace: 'desconectado', notasPersonalizadas: null });
    const prox = parseInt(id) + 1;
    idEl.value = String(prox).padStart(2,'0');
    nombreEl.value = '';
    actualizarInterfazAtletas();
    preconstruirEstructuraTabla();
    inicializarGraficoBasico();
  }

  async function editarAtleta(id) {
    const atleta = listaAtletas.find(a => a.id === id);
    if (!atleta) return;
    const nuevoNombre = await showPrompt('Editar nombre:', atleta.nombre, 'Editar atleta');
    if (nuevoNombre && nuevoNombre.trim()) {
      atleta.nombre = nuevoNombre.trim().toUpperCase();
      actualizarInterfazAtletas();
      actualizarReporteClinico();
    }
  }

  async function eliminarAtleta(id) {
    const ok = await showConfirm('¿Eliminar este atleta de la sesión activa?', 'Eliminar atleta');
    if (ok) {
      listaAtletas = listaAtletas.filter(a => a.id !== id);
      actualizarInterfazAtletas();
      preconstruirEstructuraTabla();
      inicializarGraficoBasico();
    }
  }

  async function importarAtletasBD() {
    try {
      const response = await fetch('/api/athletes');
      if (!response.ok) throw new Error('Error al cargar atletas');
      const atletas = await response.json();
      let imported = 0;
      const COLORES = ['#1a73e8','#e63994','#f5a623','#0fc187','#9b59b6','#e67e22'];
      atletas.forEach(a => {
        if (!a.active) return;
        const idStr = String(listaAtletas.length + 1).padStart(2,'0');
        if (!listaAtletas.some(x => x.nombre === a.name.toUpperCase())) {
          const edad = a.birth_date ? Math.floor((new Date() - new Date(a.birth_date)) / 3.15576e10) : 30;
          listaAtletas.push({ id: idStr, nombre: a.name.toUpperCase(), edad, color: COLORES[listaAtletas.length % 6], fcActual: 0, estadoEnlace: 'desconectado', notasPersonalizadas: null });
          imported++;
        }
      });
      actualizarInterfazAtletas();
      preconstruirEstructuraTabla();
      inicializarGraficoBasico();
      toast(`${imported} atleta(s) importado(s) desde la base de datos.`);
    } catch (e) {
      toast('No se pudo importar desde la base de datos.', true);
    }
  }

  // ── Event delegation ─────────────────────────────────────────
  function bindOxyEvents() {
    document.getElementById('oxyBtnStart')?.addEventListener('click', iniciarTest);
    document.getElementById('oxyBtnPause')?.addEventListener('click', pausarTest);
    document.getElementById('oxyBtnReset')?.addEventListener('click', reiniciarTest);
    document.getElementById('oxyAddProtocol')?.addEventListener('click', agregarNuevoProtocolo);
    document.getElementById('oxyEditProtocol')?.addEventListener('click', editarProtocoloActual);
    document.getElementById('oxyDelProtocol')?.addEventListener('click', eliminarProtocoloActual);
    document.getElementById('protocolo-selector')?.addEventListener('change', cambiarProtocolo);
    document.getElementById('oxyAddAthlete')?.addEventListener('click', agregarAtleta);
    document.getElementById('oxyImportAthletes')?.addEventListener('click', importarAtletasBD);
    document.getElementById('oxyPrintReport')?.addEventListener('click', () => window.print());

    document.getElementById('lista-atletas-registro')?.addEventListener('click', e => {
      const link = e.target.closest('[data-link]');
      const edit = e.target.closest('[data-edit-atleta]');
      const del  = e.target.closest('[data-del-atleta]');
      if (link) gestionarEnlacePolar(link.dataset.link);
      if (edit) editarAtleta(edit.dataset.editAtleta);
      if (del)  eliminarAtleta(del.dataset.delAtleta);
    });
  }
})();
