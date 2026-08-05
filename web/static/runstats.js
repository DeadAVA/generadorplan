'use strict';

/* ─────────────────────────────────────────────────────────────
   RUN-STATS Tracker — HRV + Control de Carga Interna
   Basado en VERSION 14.5 POLAR APP.HTML
   Adaptado: sin Tailwind, integrado al app principal
─────────────────────────────────────────────────────────────── */

(function () {
  let datosCompletos = [];
  let atletasDetectados = new Set();
  let atletaSeleccionado = '';
  let rsChartInforme = null;

  function limpiarCelda(t) { return t ? t.replace(/^["']|["']$/g, '').trim() : ''; }

  // ── Bluetooth Polar H10 ───────────────────────────────────────
  async function conectarPolarH10() {
    const btn     = document.getElementById('rs-btnBluetooth');
    const bpmEl   = document.getElementById('rs-liveBPM');
    const panelEl = document.getElementById('rs-panelLive');
    if (!btn) return;
    try {
      btn.textContent = '⏳ Buscando banda...';
      const disp = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
      btn.textContent = '🔄 Estableciendo enlace...';
      const gatt  = await disp.gatt.connect();
      const srv   = await gatt.getPrimaryService('heart_rate');
      const char  = await srv.getCharacteristic('heart_rate_measurement');
      await char.startNotifications();
      char.addEventListener('characteristicvaluechanged', (e) => {
        const v = e.target.value, flags = v.getUint8(0);
        const bpm = ((flags & 1) === 0) ? v.getUint8(1) : v.getUint16(1, true);
        if (bpmEl) bpmEl.textContent = bpm;
      });
      btn.textContent = '🔴 Polar H10 Conectado';
      btn.style.background = '#059669';
      if (panelEl) panelEl.classList.remove('rs-hidden');
    } catch (e) {
      btn.textContent = '🔵 Conectar Banda Polar H10';
      toast('Error de conexión Bluetooth con la banda Polar.', true);
    }
  }

  // ── CSV ───────────────────────────────────────────────────────
  function procesarCSV() {
    const fileEl = document.getElementById('rs-csvInput');
    if (!fileEl || fileEl.files.length === 0) { toast('Seleccione un archivo .csv válido.', true); return; }
    const lector = new FileReader();
    lector.onload = (e) => {
      const lineas = e.target.result.split(/\r?\n/);
      datosCompletos = []; atletasDetectados.clear();
      let ultimoAtleta = '', ultimoSexo = 'MASCULINO';
      for (let i = 1; i < lineas.length; i++) {
        if (!lineas[i].trim()) continue;
        const cols = lineas[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        let atleta = cols[0] ? limpiarCelda(cols[0]).toUpperCase() : ultimoAtleta;
        if (atleta) ultimoAtleta = atleta;
        let sexo = cols[3] ? limpiarCelda(cols[3]).toUpperCase() : ultimoSexo;
        if (sexo) ultimoSexo = sexo;
        const duracion    = parseFloat(cols[5]) || 0;
        const borg        = parseFloat(cols[6]) || 0;
        const carga       = duracion * borg;
        const rmssd       = parseFloat(cols[10]);
        const sdnn        = parseFloat(cols[12]);
        if (atleta && !isNaN(rmssd) && !isNaN(sdnn)) {
          atletasDetectados.add(atleta);
          const sd1 = Math.sqrt(rmssd ** 2 / 2);
          const sd2 = Math.sqrt(2 * sdnn ** 2 - sd1 ** 2);
          datosCompletos.push({
            atleta, meso: limpiarCelda(cols[1]) || '-', micro: limpiarCelda(cols[2]) || '-',
            fecha: limpiarCelda(cols[4]) || '-', sexo,
            duracion, borg, cargaInterna: carga,
            rmssd, sdnn,
            stressScore: parseFloat((1000 / sd2).toFixed(2)),
            ratioS_PS: parseFloat((sd2 / sd1).toFixed(3)),
            slope: null
          });
        }
      }
      // Calcular slopes
      for (let i = 0; i < datosCompletos.length; i++) {
        const actual = datosCompletos[i];
        const ant = datosCompletos.slice(0, i).reverse().find(d => d.atleta === actual.atleta);
        if (ant) actual.slope = parseFloat((actual.rmssd - ant.rmssd).toFixed(2));
      }
      actualizarSelectorAtletas();
      toast('CSV cargado correctamente.');
    };
    lector.readAsText(fileEl.files[0]);
  }

  function actualizarSelectorAtletas() {
    const sel = document.getElementById('rs-atletaSelector');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Seleccione un deportista —</option>';
    atletasDetectados.forEach(a => { sel.innerHTML += `<option value="${a}">${a}</option>`; });
    if (atletasDetectados.size > 0) { sel.selectedIndex = 1; cambiarAtleta(); }
  }

  function cambiarAtleta() {
    const sel = document.getElementById('rs-atletaSelector');
    if (!sel) return;
    atletaSeleccionado = sel.value;
    if (!atletaSeleccionado) return;
    const registros = datosCompletos.filter(d => d.atleta === atletaSeleccionado);
    const tbody = document.getElementById('rs-tablaCuerpo');
    const contador = document.getElementById('rs-contador');
    if (contador) contador.textContent = `${registros.length} Registros`;
    if (!tbody) return;
    tbody.innerHTML = '';
    let sumaStress = 0, cargaAcum = 0;
    registros.forEach(r => {
      sumaStress += r.stressScore;
      cargaAcum  += r.cargaInterna;
      const sc = r.slope === null ? '-' : (r.slope >= 0 ? `+${r.slope}` : `${r.slope}`);
      const scColor = r.slope !== null && r.slope < 0 ? 'color:#ef4444;font-weight:bold' : (r.slope > 0 ? 'color:#22c55e' : 'color:#94a3b8');
      tbody.innerHTML += `<tr>
        <td>${r.fecha}</td><td>${r.duracion} min</td><td>${r.borg}/10</td>
        <td style="color:#c026d3;font-weight:bold">${r.cargaInterna} UA</td>
        <td style="font-weight:bold">${r.rmssd}</td>
        <td style="color:#f59e0b">${r.stressScore}</td>
        <td style="color:#06b6d4">${r.ratioS_PS}</td>
        <td style="${scColor}">${sc} ms</td>
      </tr>`;
    });
    const ultimo = registros[registros.length - 1];
    if (!ultimo) return;
    const kpiR = document.getElementById('rs-kpiRmssd');
    const kpiC = document.getElementById('rs-kpiCarga');
    const kpiS = document.getElementById('rs-kpiStress');
    const kpiX = document.getElementById('rs-kpiSexo');
    if (kpiR) kpiR.textContent = `${ultimo.rmssd} ms`;
    if (kpiC) kpiC.textContent = `${cargaAcum} UA`;
    if (kpiS) kpiS.textContent = (sumaStress / registros.length).toFixed(1);
    if (kpiX) kpiX.textContent = ultimo.sexo;
    const diag = document.getElementById('rs-diagnostico');
    if (diag) {
      if (ultimo.slope !== null && ultimo.slope < -15) {
        diag.innerHTML = `<p style="color:#ef4444;font-weight:bold;font-size:11px;text-transform:uppercase">⚠️ Sobrecarga / Respuesta Simpática Elevada</p>
          <p>La acumulación de carga interna deprimió la actividad parasimpática (RMSSD-Slope: ${ultimo.slope} ms). Regula las cargas inmediatamente.</p>`;
      } else {
        diag.innerHTML = `<p style="color:#22c55e;font-weight:bold;font-size:11px;text-transform:uppercase">✅ Adaptación Funcional Óptima</p>
          <p>El deportista asimila correctamente el volumen actual, manteniendo los valores de RMSSD estables.</p>`;
      }
    }
  }

  // ── PDF / Gráfico ────────────────────────────────────────────
  function generarInformePDF() {
    if (!window.jspdf) { toast('jsPDF no disponible. Verifica la conexión a internet.', true); return; }
    const { jsPDF } = window.jspdf;
    if (!atletaSeleccionado) { toast('Seleccione un atleta activo.', true); return; }

    const varConf = [
      { id: 'rs-chkCargaInterna', prop: 'cargaInterna', nombre: 'Carga Interna (UA)',      color: '#d946ef', fondo: 'rgba(217,70,239,.85)', type: 'bar',  axis: 'y',  dash: [],    order: 3 },
      { id: 'rs-chkRMSSD',        prop: 'rmssd',        nombre: 'RMSSD (ms)',               color: '#4f46e5', fondo: 'transparent',           type: 'line', axis: 'y1', dash: [],    order: 1 },
      { id: 'rs-chkSDNN',         prop: 'sdnn',         nombre: 'SDNN (ms)',                color: '#10b981', fondo: 'transparent',           type: 'line', axis: 'y1', dash: [6,4], order: 2 },
      { id: 'rs-chkStress',       prop: 'stressScore',  nombre: 'Stress Score',             color: '#f59e0b', fondo: 'transparent',           type: 'line', axis: 'y1', dash: [5,4], order: 2 },
      { id: 'rs-chkRatio',        prop: 'ratioS_PS',    nombre: 'Ratio S:PS',               color: '#06b6d4', fondo: 'transparent',           type: 'line', axis: 'y1', dash: [2,3], order: 2 }
    ];
    const seleccionadas = varConf.filter(v => document.getElementById(v.id)?.checked);
    if (seleccionadas.length === 0) { toast('Seleccione al menos una variable.', true); return; }

    const registros = datosCompletos.filter(d => d.atleta === atletaSeleccionado);
    const ultimo = registros[registros.length - 1];
    const datasets = seleccionadas.map(v => ({
      type: v.type, label: v.nombre, data: registros.map(r => r[v.prop]),
      borderColor: v.color, backgroundColor: v.fondo,
      borderWidth: v.type === 'line' ? 3.5 : 1,
      borderDash: v.dash, yAxisID: v.axis, tension: 0.12,
      pointRadius: v.type === 'line' ? 5 : 0, pointBackgroundColor: v.color, order: v.order
    }));

    const canvas = document.getElementById('rs-hiddenCanvas');
    if (rsChartInforme) rsChartInforme.destroy();
    rsChartInforme = new window.Chart(canvas.getContext('2d'), {
      data: { labels: registros.map(r => r.fecha), datasets },
      options: {
        responsive: false, animation: false,
        scales: {
          x: { display: true, grid: { display: false }, ticks: { font: { size:10, weight:'bold' }, color:'#1e293b' } },
          y: { type:'linear', display: document.getElementById('rs-chkCargaInterna')?.checked, position:'left',
               title: { display:true, text:'Carga Interna (UA)', color:'#d946ef', font: { weight:'bold', size:10 } }, ticks: { color:'#1e293b' } },
          y1: { type:'linear', display:true, position:'right', grid: { drawOnChartArea:false },
                title: { display:true, text:'Variables HRV', color:'#4f46e5', font: { weight:'bold', size:10 } }, ticks: { color:'#1e293b' } }
        },
        plugins: { legend: { labels: { font: { size:8, weight:'bold' }, boxWidth:12 } } }
      }
    });

    setTimeout(() => {
      const doc = new jsPDF('p','mm','a4');
      const img = rsChartInforme.toBase64Image();
      const totalCarga = registros.reduce((s,r) => s + r.cargaInterna, 0);

      doc.setFont('helvetica','bold'); doc.setFontSize(13);
      doc.text('INFORME INTEGRADO — CONTROL AUTONÓMICO Y CARGA INTERNA', 15, 18);
      doc.setFont('helvetica','normal'); doc.setFontSize(8);
      doc.text('RUN-STATS Tracker — Sistema de Triple Contraste Estructurado', 15, 23);
      doc.setDrawColor(15,23,42); doc.line(15,26,195,26);

      doc.setFont('helvetica','bold'); doc.setFontSize(9);
      doc.text('1. IDENTIFICACIÓN DEL DEPORTISTA', 15, 34);
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
      doc.text(`• Atleta: ${ultimo.atleta}   • Sexo: ${ultimo.sexo}   • Estructura: Meso ${ultimo.meso} / Micro ${ultimo.micro}`, 18, 41);

      doc.setFont('helvetica','bold'); doc.setFontSize(9);
      doc.text('2. INTEGRACIÓN DE CARGA Y RESPUESTA AUTONÓMICA', 15, 54);
      doc.setFillColor(248,250,252); doc.rect(15,57,180,16,'F');
      doc.setFont('helvetica','normal'); doc.setFontSize(8.5);
      doc.text(`• Carga Semanal: ${totalCarga} UA   • Último RMSSD: ${ultimo.rmssd} ms   • Stress Score: ${ultimo.stressScore}`, 18, 63);
      doc.text(`• Última sesión: ${ultimo.duracion} min con Borg RPE ${ultimo.borg}/10.`, 18, 69);

      doc.setFont('helvetica','bold'); doc.setFontSize(9);
      doc.text('3. PANEL GRÁFICO CORRELATIVO', 15, 82);
      doc.addImage(img, 'PNG', 15, 85, 180, 70);

      doc.text('4. DIAGNÓSTICO (Modelo Naranjo Orellana 2015)', 15, 165);
      doc.setFillColor(241,245,249); doc.rect(15,168,180,22,'F');
      doc.setFont('helvetica','italic'); doc.setFontSize(8.5);
      const dx = ultimo.slope !== null && ultimo.slope < -15
        ? `ALERTA DE FATIGA: Carga acumulada (${totalCarga} UA) superó umbral adaptativo. RMSSD-Slope: ${ultimo.slope} ms. Sistema simpático dominante.`
        : `ADAPTACIÓN SATISFACTORIA: ${totalCarga} UA de carga interna con asimilación biológica correcta. Tono vagal estable.`;
      doc.text(doc.splitTextToSize(dx, 172), 18, 174);

      doc.setFont('helvetica','bold');
      doc.text('5. DIRECTRICES DE RECUPERACIÓN Y AJUSTE DE CARGA', 15, 200);
      doc.setFont('helvetica','normal');
      const acc = ultimo.slope !== null && ultimo.slope < -15
        ? '• Reducir carga planificada 35% las próximas 48 h.\n• Priorizar descanso o trabajo regenerativo (RPE < 3/10).\n• Monitorear FC de reposo al despertar.'
        : '• Mantener progresión planificada del microciclo.\n• Continuar registro basal con Polar H10.';
      doc.text(doc.splitTextToSize(acc, 174), 15, 207);

      doc.line(25,255,85,255); doc.text('Dirección de Ciencias del Deporte', 29,260);
      doc.line(125,255,185,255); doc.text('Control de Carga Fisiológica', 132,260);

      doc.save(`Reporte_HRV_${ultimo.atleta.replace(/\s+/g,'_')}.pdf`);
    }, 250);
  }

  // ── Inicialización ────────────────────────────────────────────
  function bindRsEvents() {
    document.getElementById('rs-btnBluetooth')?.addEventListener('click', conectarPolarH10);
    document.getElementById('rs-btnProcesar')?.addEventListener('click', procesarCSV);
    document.getElementById('rs-atletaSelector')?.addEventListener('change', cambiarAtleta);
    document.getElementById('rs-btnPDF')?.addEventListener('click', generarInformePDF);
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindRsEvents);
  } else {
    bindRsEvents();
  }
})();
