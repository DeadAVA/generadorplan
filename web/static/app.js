'use strict';

const state = { athletes: [], plans: [], editingAthleteId: null, editingPlanId: null };
const ZONES = ['Z5', 'Z4', 'Z3', 'Z2', 'Z1'];
const DEFAULT_PACES = { Z5:['04:30','04:40'], Z4:['04:55','05:00'], Z3:['05:10','05:30'], Z2:['05:40','06:00'], Z1:['06:00','06:30'] };
const DAY_NAMES = ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'];
const $ = (id) => document.getElementById(id);
let toastTimer;

async function api(path, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };
  if (config.body && !(config.body instanceof FormData)) config.headers['Content-Type'] = 'application/json';
  const response = await fetch(path, config);
  if (!response.ok) {
    let message = `Error ${response.status}`;
    try { const body = await response.json(); message = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail); } catch {}
    throw new Error(message);
  }
  return response.status === 204 ? null : response.json();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
}

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').className = `toast show${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => $('toast').className = 'toast', 3200);
}

function showConfirm(message, title = '¿Confirmar?', kicker = 'Confirmar acción') {
  return new Promise(resolve => {
    $('confirmTitle').textContent = title;
    $('confirmKicker').textContent = kicker;
    $('confirmMessage').textContent = message;
    const dlg = $('confirmDialog');
    dlg.showModal();
    function cleanup(result) {
      dlg.close();
      $('confirmOk').removeEventListener('click', onOk);
      $('confirmCancel').removeEventListener('click', onCancel);
      resolve(result);
    }
    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }
    $('confirmOk').addEventListener('click', onOk);
    $('confirmCancel').addEventListener('click', onCancel);
  });
}

function showPrompt(message, defaultValue = '', title = 'Ingresa el valor') {
  return new Promise(resolve => {
    $('promptTitle').textContent = title;
    $('promptLabel').textContent = message;
    $('promptInput').value = defaultValue;
    const dlg = $('promptDialog');
    dlg.showModal();
    setTimeout(() => $('promptInput').select(), 50);
    function cleanup(result) {
      dlg.close();
      $('promptOk').removeEventListener('click', onOk);
      $('promptCancel').removeEventListener('click', onCancel);
      dlg.removeEventListener('keydown', onKey);
      resolve(result);
    }
    function onOk() { cleanup($('promptInput').value.trim() || null); }
    function onCancel() { cleanup(null); }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); cleanup($('promptInput').value.trim() || null); }
      if (e.key === 'Escape') { e.preventDefault(); cleanup(null); }
    }
    $('promptOk').addEventListener('click', onOk);
    $('promptCancel').addEventListener('click', onCancel);
    dlg.addEventListener('keydown', onKey);
  });
}

function localDate(value) {
  if (!value) return '';
  return new Intl.DateTimeFormat('es-MX', { day:'numeric', month:'short', year:'numeric', timeZone:'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function isoDate(date) { return date.toISOString().slice(0, 10); }

function mondayOfCurrentWeek() {
  const value = new Date();
  const day = value.getDay() || 7;
  value.setDate(value.getDate() - day + 1);
  return isoDate(value);
}

function addDays(value, days) {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return isoDate(date);
}

function isoWeek(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function monthLabel(value) {
  return new Intl.DateTimeFormat('es-MX', { month:'long', year:'numeric', timeZone:'UTC' }).format(new Date(`${value}T00:00:00Z`)).toUpperCase();
}

async function loadAll() {
  try {
    const [athletes, plans, health] = await Promise.all([api('/api/athletes?include_inactive=true'), api('/api/plans'), api('/api/health')]);
    state.athletes = athletes;
    state.plans = plans;
    $('systemStatus').textContent = `SQLite · ${health.athletes} atletas`;
    renderEverything();
  } catch (error) {
    $('systemStatus').textContent = 'Sin conexión';
    toast(error.message, true);
  }
}

function renderEverything() {
  renderAthleteOptions();
  renderAthletes();
  renderPlans();
  renderDashboard();
}

function renderDashboard() {
  $('metricAthletes').textContent = state.athletes.filter(a => a.active).length;
  $('metricPlans').textContent = state.plans.length;
  $('metricKm').textContent = Math.round(state.plans.reduce((sum, plan) => sum + plan.weekly_km, 0));
  $('metricPublished').textContent = state.plans.filter(plan => plan.status === 'published').length;
  const recent = state.plans.slice(0, 5);
  $('recentPlans').innerHTML = recent.length ? recent.map(plan => `
    <div class="compact-row"><div><strong>${escapeHtml(plan.title)}</strong><small>${escapeHtml(plan.athlete_name)} · ${localDate(plan.start_date)}</small></div><span class="pill">${statusLabel(plan.status)}</span></div>`).join('') : '<div class="empty">Todavía no hay planes.</div>';
}

function initials(name) { return name.split(/\s+/).slice(0,2).map(part => part[0]).join('').toUpperCase(); }

function renderAthletes() {
  const search = $('athleteSearch').value.trim().toLocaleLowerCase('es');
  const athletes = state.athletes.filter(a => !search || a.name.toLocaleLowerCase('es').includes(search));
  $('athleteGrid').innerHTML = athletes.length ? athletes.map(athlete => {
    const zones = [...athlete.pace_zones].sort((a,b) => b.zone.localeCompare(a.zone)).map(zone => `<span class="zone-chip">${zone.zone} ${zone.pace_min}–${zone.pace_max}</span>`).join('');
    return `<article class="athlete-card">
      <div class="athlete-top"><div class="avatar">${escapeHtml(initials(athlete.name))}</div><span class="pill">${escapeHtml(athlete.category)}</span></div>
      <h3>${escapeHtml(athlete.name)}</h3><p>${escapeHtml(athlete.contact || 'Sin contacto registrado')}</p>
      <div class="zone-chips">${zones || '<span class="zone-chip">Sin zonas</span>'}</div>
      <div class="card-actions"><button class="btn secondary" data-athlete-edit="${athlete.id}">Editar</button><button class="btn secondary" data-athlete-plan="${athlete.id}">Crear plan</button><button class="btn danger" data-athlete-delete="${athlete.id}">Eliminar</button></div>
    </article>`;
  }).join('') : '<div class="empty">No encontramos atletas.</div>';
}

function statusLabel(status) { return ({draft:'Borrador',published:'Publicado',archived:'Archivado'})[status] || status; }

function renderPlans() {
  const athleteFilter = $('planAthleteFilter').value;
  const statusFilter = $('planStatusFilter').value;
  const plans = state.plans.filter(plan => (!athleteFilter || plan.athlete_id === athleteFilter) && (!statusFilter || plan.status === statusFilter));
  $('planList').innerHTML = plans.length ? plans.map(plan => `
    <article class="plan-row">
      <div><h3>${escapeHtml(plan.title)}</h3><p>${escapeHtml(plan.athlete_name)} · Semana ${plan.week_number}</p></div>
      <div><small>Periodo</small><p>${localDate(plan.start_date)} – ${localDate(plan.end_date)}</p></div>
      <div><small>Carga</small><p>${plan.weekly_km || 0} km · ${plan.hours_per_week || 0} hrs.</p></div>
      <div class="plan-actions"><span class="pill">${statusLabel(plan.status)}</span><button class="icon-btn" title="Imprimir" data-plan-print="${plan.id}">▤</button><button class="icon-btn" title="Editar" data-plan-edit="${plan.id}">✎</button><button class="icon-btn" title="Eliminar" data-plan-delete="${plan.id}">×</button></div>
    </article>`).join('') : '<div class="empty">No hay planes con estos filtros.</div>';
}

function renderAthleteOptions() {
  const options = state.athletes.filter(a => a.active).map(a => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  for (const id of ['generatorAthlete','planAthlete']) $(id).innerHTML = options;
  const currentFilter = $('planAthleteFilter').value;
  $('planAthleteFilter').innerHTML = `<option value="">Todos los atletas</option>${options}`;
  $('planAthleteFilter').value = currentFilter;
}

function switchView(view) {
  document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === `${view}View`));
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  const titles = { dashboard:'Resumen', athletes:'Atletas', plans:'Planes semanales', oxyfield:'OxyField Pro', runstats:'RUN-STATS HRV' };
  $('viewTitle').textContent = titles[view] || view;
  if (view === 'oxyfield' && typeof window.oxyfieldInit === 'function') window.oxyfieldInit();
}

function openAthleteDialog(athlete = null) {
  state.editingAthleteId = athlete?.id || null;
  $('athleteModalTitle').textContent = athlete ? 'Editar atleta' : 'Registrar atleta';
  $('athleteName').value = athlete?.name || '';
  $('athleteCategory').value = athlete?.category || 'LIBRE';
  $('athleteBirth').value = athlete?.birth_date || '';
  $('athleteGender').value = athlete?.gender || '';
  $('athleteContact').value = athlete?.contact || '';
  $('athleteNotes').value = athlete?.notes || '';
  const paces = Object.fromEntries((athlete?.pace_zones || []).map(item => [item.zone, [item.pace_min, item.pace_max]]));
  $('paceZoneFields').innerHTML = ZONES.map(zone => `<div class="zone-row"><strong>${zone}</strong><label>Rápido<input id="pace-${zone}-min" pattern="[0-9]{1,2}:[0-5][0-9]" value="${paces[zone]?.[0] || DEFAULT_PACES[zone][0]}" required></label><label>Suave<input id="pace-${zone}-max" pattern="[0-9]{1,2}:[0-5][0-9]" value="${paces[zone]?.[1] || DEFAULT_PACES[zone][1]}" required></label></div>`).join('');
  $('athleteDialog').showModal();
}

async function saveAthlete(event) {
  event.preventDefault();
  const payload = {
    name:$('athleteName').value, category:$('athleteCategory').value, birth_date:$('athleteBirth').value || null,
    gender:$('athleteGender').value, contact:$('athleteContact').value, notes:$('athleteNotes').value, active:true,
    pace_zones:ZONES.map(zone => ({zone,pace_min:$(`pace-${zone}-min`).value,pace_max:$(`pace-${zone}-max`).value}))
  };
  try {
    const path = state.editingAthleteId ? `/api/athletes/${state.editingAthleteId}` : '/api/athletes';
    await api(path, {method:state.editingAthleteId ? 'PUT' : 'POST',body:JSON.stringify(payload)});
    $('athleteDialog').close(); await loadAll(); toast(state.editingAthleteId ? 'Atleta actualizado.' : 'Atleta registrado.');
  } catch (error) { toast(error.message, true); }
}

async function deleteAthlete(id) {
  const athlete = state.athletes.find(item => item.id === id);
  const confirmed = await showConfirm(`¿Eliminar a ${athlete.name}? También se eliminarán todos sus planes.`, '¿Eliminar atleta?', 'Acción irreversible');
  if (!confirmed) return;
  try { await api(`/api/athletes/${id}`, {method:'DELETE'}); await loadAll(); toast('Atleta eliminado.'); } catch (error) { toast(error.message, true); }
}

function codeForDate(value, index) { return `${['L','M','M','J','V','S','D'][index]}${Number(value.slice(-2))}`; }

function createEmptyDays(start) {
  return DAY_NAMES.map((_, index) => ({day_order:index,date:addDays(start,index),code:codeForDate(addDays(start,index),index),warmup:'Calentamiento',cooldown:'Flexo - Elasticidad',notes:'',exercises:[]}));
}

function exerciseToLine(exercise) {
  return [exercise.title,exercise.prescription,exercise.intensity,exercise.pause,exercise.notes].map(v => v || '').join(' | ').replace(/( \|)+$/,'').trim();
}

function renderDaysEditor(days) {
  $('planDaysEditor').innerHTML = days.map((day,index) => `<details class="day-editor" ${index===0?'open':''} data-day="${index}">
    <summary><span>${DAY_NAMES[index]} · <span class="day-code">${escapeHtml(day.code || '')}</span></span><span>${day.exercises?.length || 0} ejercicios</span></summary>
    <div class="day-editor-body">
      <label>Fecha<input class="day-date" type="date" value="${day.date}"></label>
      <label>Ejercicios<textarea class="exercise-text" placeholder="Velocidad | 3 × 120 m | 80-85% | 2 min | Técnica limpia">${escapeHtml((day.exercises || []).map(exerciseToLine).join('\n'))}</textarea></label>
      <label>Calentamiento<textarea class="day-warmup" rows="2">${escapeHtml(day.warmup || '')}</textarea></label>
      <label>Vuelta a la calma<textarea class="day-cooldown" rows="2">${escapeHtml(day.cooldown || '')}</textarea></label>
      <label>Notas<textarea class="day-notes" rows="2">${escapeHtml(day.notes || '')}</textarea></label>
    </div></details>`).join('');
}

function fillPlanForm(plan = null, preferredAthleteId = null) {
  state.editingPlanId = plan?.id || null;
  const start = plan?.start_date || mondayOfCurrentWeek();
  $('planModalTitle').textContent = plan ? 'Editar plan semanal' : 'Nuevo plan semanal';
  $('planAthlete').value = plan?.athlete_id || preferredAthleteId || state.athletes[0]?.id || '';
  $('planTitle').value = plan?.title || 'Plan semanal'; $('planStart').value = start; $('planEnd').value = plan?.end_date || addDays(start,6);
  $('planWeek').value = plan?.week_number || isoWeek(start); $('planMonth').value = plan?.month_label || monthLabel(start);
  $('planCategory').value = plan?.category || state.athletes.find(a => a.id === $('planAthlete').value)?.category || 'LIBRE';
  $('planHours').value = plan?.hours_per_week || 0; $('planKm').value = plan?.weekly_km || 0; $('planStatus').value = plan?.status || 'draft';
  $('planGoal').value = plan?.goal || ''; $('planNotes').value = plan?.notes || '';
  renderDaysEditor(plan?.days || createEmptyDays(start));
  $('planDialog').showModal();
}

async function openPlanDialog(id = null, athleteId = null) {
  try { fillPlanForm(id ? await api(`/api/plans/${id}`) : null, athleteId); } catch (error) { toast(error.message, true); }
}

function syncPlanDates() {
  const start = $('planStart').value;
  if (!start) return;
  $('planEnd').value = addDays(start,6); $('planWeek').value = isoWeek(start); $('planMonth').value = monthLabel(start);
  document.querySelectorAll('.day-editor').forEach((editor,index) => {
    const date = addDays(start,index); editor.querySelector('.day-date').value = date; editor.querySelector('.day-code').textContent = codeForDate(date,index);
  });
}

function parseExercises(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map((line,index) => {
    const [title,prescription='',intensity='',pause='',notes=''] = line.split('|').map(part => part.trim());
    return {sort_order:index,block_type:'principal',title,prescription,intensity,pause,pace:'',notes};
  });
}

function collectPlanPayload() {
  const days = [...document.querySelectorAll('.day-editor')].map((editor,index) => {
    const date = editor.querySelector('.day-date').value;
    return {day_order:index,date,code:codeForDate(date,index),warmup:editor.querySelector('.day-warmup').value,cooldown:editor.querySelector('.day-cooldown').value,notes:editor.querySelector('.day-notes').value,exercises:parseExercises(editor.querySelector('.exercise-text').value)};
  });
  return {athlete_id:$('planAthlete').value,title:$('planTitle').value,month_label:$('planMonth').value,week_number:Number($('planWeek').value),start_date:$('planStart').value,end_date:$('planEnd').value,category:$('planCategory').value,hours_per_week:Number($('planHours').value||0),weekly_km:Number($('planKm').value||0),goal:$('planGoal').value,status:$('planStatus').value,notes:$('planNotes').value,days};
}

async function savePlan(event) {
  event.preventDefault();
  try {
    const path = state.editingPlanId ? `/api/plans/${state.editingPlanId}` : '/api/plans';
    const result = await api(path,{method:state.editingPlanId?'PUT':'POST',body:JSON.stringify(collectPlanPayload())});
    $('planDialog').close(); await loadAll(); toast('Plan semanal guardado.');
    const openPrint = await showConfirm('¿Quieres abrir la hoja lista para imprimir?', 'Vista de impresión', 'Plan guardado');
    if (openPrint) window.open(`/print?id=${result.id}`,'_blank');
  } catch (error) { toast(error.message,true); }
}

function openGenerator(athleteId = null) {
  $('generatorAthlete').value = athleteId || state.athletes[0]?.id || '';
  $('generatorStart').value = mondayOfCurrentWeek();
  $('generatorDialog').showModal();
}

async function generatePlan(event) {
  event.preventDefault();
  const payload = {athlete_id:$('generatorAthlete').value,start_date:$('generatorStart').value,goal:$('generatorGoal').value,level:$('generatorLevel').value,days_per_week:Number($('generatorDays').value),weekly_km:Number($('generatorKm').value),category:$('generatorCategory').value,hours_per_week:Number($('generatorHours').value)};
  try { const plan=await api('/api/plans/generate/automatic',{method:'POST',body:JSON.stringify(payload)});$('generatorDialog').close();await loadAll();fillPlanForm(plan);toast('Plan generado. Revísalo y ajústalo.'); } catch(error){toast(error.message,true);}
}

async function deletePlan(id) {
  const confirmed = await showConfirm('¿Eliminar este plan semanal?', '¿Eliminar plan?', 'Acción irreversible');
  if (!confirmed) return;
  try { await api(`/api/plans/${id}`,{method:'DELETE'});await loadAll();toast('Plan eliminado.'); } catch(error){toast(error.message,true);}
}

async function restoreBackup(event) {
  const file=event.target.files[0];event.target.value='';if(!file)return;
  const confirmed = await showConfirm('La restauración reemplazará todos los atletas y planes actuales. ¿Continuar?', '¿Restaurar base de datos?', 'Acción irreversible');
  if(!confirmed)return;
  const form=new FormData();form.append('file',file);
  try{const result=await api('/api/backups/json',{method:'POST',body:form});await loadAll();toast(`Base restaurada: ${result.athletes} atletas y ${result.plans} planes.`);}catch(error){toast(error.message,true);}
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.go)));
  document.querySelectorAll('[data-close]').forEach(button=>button.addEventListener('click',()=>$(button.dataset.close).close()));
  $('newAthleteBtn').addEventListener('click',()=>openAthleteDialog());$('athleteForm').addEventListener('submit',saveAthlete);$('athleteSearch').addEventListener('input',renderAthletes);
  $('athleteGrid').addEventListener('click',event=>{const edit=event.target.closest('[data-athlete-edit]');const plan=event.target.closest('[data-athlete-plan]');const del=event.target.closest('[data-athlete-delete]');if(edit)openAthleteDialog(state.athletes.find(a=>a.id===edit.dataset.athleteEdit));if(plan)openPlanDialog(null,plan.dataset.athletePlan);if(del)deleteAthlete(del.dataset.athleteDelete);});
  for(const id of ['quickPlanBtn','newPlanBtn'])$(id).addEventListener('click',()=>openPlanDialog());
  for(const id of ['generateBtn','dashboardGenerateBtn'])$(id).addEventListener('click',()=>openGenerator());
  $('generatorForm').addEventListener('submit',generatePlan);$('planForm').addEventListener('submit',savePlan);$('syncDatesBtn').addEventListener('click',syncPlanDates);$('planStart').addEventListener('change',syncPlanDates);
  $('planAthleteFilter').addEventListener('change',renderPlans);$('planStatusFilter').addEventListener('change',renderPlans);
  $('planList').addEventListener('click',event=>{const edit=event.target.closest('[data-plan-edit]');const print=event.target.closest('[data-plan-print]');const del=event.target.closest('[data-plan-delete]');if(edit)openPlanDialog(edit.dataset.planEdit);if(print)window.open(`/print?id=${print.dataset.planPrint}`,'_blank');if(del)deletePlan(del.dataset.planDelete);});
  $('restoreBtn').addEventListener('click',()=>$('restoreFile').click());$('restoreFile').addEventListener('change',restoreBackup);
}

bindEvents();
loadAll();
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('/service-worker.js').catch(error => console.warn('PWA no disponible', error));
}
