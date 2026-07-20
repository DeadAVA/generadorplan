'use strict';

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);

function formatDate(value) {
  return new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`));
}

function exerciseLine(exercise) {
  const metadata = [];
  if (exercise.intensity) metadata.push(`Int.: ${exercise.intensity}`);
  if (exercise.pause) metadata.push(`P.: ${exercise.pause}`);
  if (exercise.pace) metadata.push(`Ritmo: ${exercise.pace}`);
  return `<p class="exercise"><span class="exercise-title">${escapeHtml(exercise.title)}</span>${exercise.prescription?`<span class="exercise-detail">${escapeHtml(exercise.prescription)}</span>`:''}${metadata.length?`<span class="exercise-meta">${escapeHtml(metadata.join(' · '))}</span>`:''}${exercise.notes?`<span class="exercise-detail">${escapeHtml(exercise.notes)}</span>`:''}</p>`;
}

async function loadPlan() {
  const id = new URLSearchParams(location.search).get('id');
  if (!id) return showError('Falta seleccionar un plan.');
  try {
    const response = await fetch(`/api/plans/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('No se pudo cargar el plan.');
    const plan = await response.json();
    document.title = `${plan.athlete_name} · Semana ${plan.week_number}`;
    $('documentTitle').textContent = plan.title;
    $('athleteName').textContent = plan.athlete_name;
    $('monthLabel').textContent = plan.month_label;
    $('weekNumber').textContent = plan.week_number;
    $('startDate').textContent = formatDate(plan.start_date);
    $('endDate').textContent = formatDate(plan.end_date);
    $('category').textContent = plan.category;
    $('hours').textContent = plan.hours_per_week || '—';
    $('goal').textContent = plan.goal || '—';
    $('weeklyKm').textContent = plan.weekly_km ? `${plan.weekly_km} km/sem.` : '';
    $('planNotes').textContent = plan.notes || '';
    $('trainingDays').innerHTML = plan.days.map(day => {
      const active = day.exercises.length || day.warmup;
      return `<article class="training-day${active?'':' rest'}"><div class="day-code">${escapeHtml(day.code)}</div><div class="day-content">${day.warmup?`<p class="warmup">${escapeHtml(day.warmup)}</p>`:''}${day.exercises.map(exerciseLine).join('')}${day.cooldown?`<p class="cooldown">${escapeHtml(day.cooldown)}</p>`:''}${day.notes?`<p class="day-note">${escapeHtml(day.notes)}</p>`:''}</div></article>`;
    }).join('');
  } catch (error) { showError(error.message); }
}

function showError(message) { $('sheet').innerHTML = `<p class="error">${escapeHtml(message)}</p>`; }
loadPlan();
