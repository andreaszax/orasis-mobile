'use strict';
// Read-only viewer. Decryption happens locally in the browser; nothing is uploaded or stored.
const $app = document.getElementById('app');
const $back = document.getElementById('back');
const $lock = document.getElementById('lock');
const $title = document.getElementById('title');

let data = null;      // { exportDate, patients }
let tab = 'patients'; // patients | surgeries
let query = '';
let currentId = null;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ς/g, 'σ');
const fmtDate = (d) => {
  if (!d) return '';
  const x = new Date(d);
  return isNaN(x) ? String(d) : x.toLocaleDateString('el-GR');
};

async function decrypt(envelope, password) {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64(envelope.salt), iterations: envelope.iter, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(envelope.iv) }, key, b64(envelope.data));
  const stream = new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'));
  return JSON.parse(await new Response(stream).text());
}

function viewLogin(msg) {
  $title.textContent = 'ORASIS Mobile';
  $back.hidden = true; $lock.hidden = true;
  $app.innerHTML = `
    <div class="card">
      <p>Επίλεξε το αρχείο <b>orasis_mobile.enc</b> (από το Google Drive) και γράψε τον κωδικό.</p>
      <input type="file" id="file" accept=".enc,application/json,*/*">
      <input type="password" id="pw" placeholder="Κωδικός" autocomplete="off" style="margin-top:10px">
      <button class="btn" id="open">Άνοιγμα</button>
      <div class="err" id="err">${esc(msg || '')}</div>
    </div>`;
  document.getElementById('open').onclick = async () => {
    const f = document.getElementById('file').files[0];
    const pw = document.getElementById('pw').value;
    const err = document.getElementById('err');
    if (!f || !pw) { err.textContent = 'Διάλεξε αρχείο και γράψε κωδικό.'; return; }
    err.textContent = 'Αποκρυπτογράφηση…';
    try {
      const env = JSON.parse(await f.text());
      if (env.app !== 'EY-ORASIS-MOBILE') throw new Error('format');
      data = await decrypt(env, pw);
      tab = 'patients'; query = ''; currentId = null;
      render();
    } catch (e) {
      console.error(e); setTimeout(() => { err.textContent += ' [' + (e && e.name) + ': ' + (e && e.message) + ']'; }, 0);
      err.textContent = 'Λάθος κωδικός ή μη έγκυρο αρχείο.';
    }
  };
}

function lock() { data = null; currentId = null; viewLogin(); }
$lock.onclick = lock;
$back.onclick = () => { currentId = null; render(); };

function render() {
  if (!data) return viewLogin();
  $lock.hidden = false;
  if (currentId) return viewPatient(data.patients.find((p) => p.id === currentId));
  $back.hidden = true;
  $title.textContent = 'ORASIS';
  $app.innerHTML = `
    <div class="muted" style="margin-bottom:8px">Backup: ${esc(new Date(data.exportDate).toLocaleString('el-GR'))} · ${data.patients.length} ασθενείς</div>
    <div class="tabs">
      <button data-t="patients" class="${tab === 'patients' ? 'on' : ''}">Ασθενείς</button>
      <button data-t="surgeries" class="${tab === 'surgeries' ? 'on' : ''}">Χειρουργεία</button>
    </div>
    <div id="body"></div>`;
  $app.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => { tab = b.dataset.t; render(); }));
  if (tab === 'patients') listPatients(); else listSurgeries();
}

function listPatients() {
  const body = document.getElementById('body');
  body.innerHTML = `<input type="search" id="q" placeholder="Επώνυμο, όνομα, ΑΜΚΑ, τηλέφωνο, αρ. φακέλου" value="${esc(query)}"><div id="list" style="margin-top:10px"></div>`;
  const q = document.getElementById('q');
  const draw = () => {
    const terms = norm(query).split(/\s+/).filter(Boolean);
    let res = data.patients.filter((p) => {
      const hay = norm([p.lastName, p.firstName, p.fatherName, p.amka, p.phone1, p.phone2, p.patientNumber].join(' '));
      return terms.every((t) => hay.includes(t));
    });
    res.sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'el') || (a.firstName || '').localeCompare(b.firstName || '', 'el'));
    const total = res.length;
    res = res.slice(0, 100);
    document.getElementById('list').innerHTML = res.map((p) => `
      <div class="card item" data-id="${esc(p.id)}">
        <b>${esc(p.lastName)} ${esc(p.firstName)}</b>
        <span class="muted">του ${esc(p.fatherName)} · ${esc(fmtDate(p.birthDate))} · #${esc(p.patientNumber)}</span>
      </div>`).join('') + (total > 100 ? `<div class="muted">Εμφανίζονται 100 από ${total}. Στένεψε την αναζήτηση.</div>` : '') || '<div class="muted">Κανένα αποτέλεσμα</div>';
    document.querySelectorAll('.item').forEach((el) => (el.onclick = () => { currentId = el.dataset.id; render(); window.scrollTo(0, 0); }));
  };
  q.oninput = () => { query = q.value; draw(); };
  draw();
}

function allSurgeries() {
  const out = [];
  for (const p of data.patients) {
    for (const e of p.examinations || []) {
      for (const s of e.surgeriesPlanned || []) out.push({ p, s });
    }
  }
  return out;
}

function listSurgeries() {
  const body = document.getElementById('body');
  const list = allSurgeries().sort((a, b) => String(b.s.date).localeCompare(String(a.s.date)));
  body.innerHTML = list.length ? list.slice(0, 200).map(({ p, s }) => `
    <div class="card item" data-id="${esc(p.id)}">
      <b>${esc(fmtDate(s.date))} · ${esc(s.condition)} <span class="tag">${esc(s.eye)}</span>${s.ib ? `<span class="tag">${esc(s.ib)}</span>` : ''}</b>
      <span class="muted">${esc(p.lastName)} ${esc(p.firstName)}${s.notes ? ' · ' + esc(s.notes) : ''}</span>
    </div>`).join('') : '<div class="muted">Δεν υπάρχουν χειρουργεία</div>';
  document.querySelectorAll('.item').forEach((el) => (el.onclick = () => { currentId = el.dataset.id; render(); window.scrollTo(0, 0); }));
}

const row = (k, v) => (v ? `<div class="row"><span>${k}</span><span class="pre">${esc(v)}</span></div>` : '');
const block = (title, v) => (v ? `<h3>${title}</h3><div class="pre">${esc(v)}</div>` : '');
const rx = (r) => (r && (r.sph || r.cyl || r.axe) ? `${r.sph > 0 ? '+' : ''}${r.sph} (${r.cyl > 0 ? '+' : ''}${r.cyl}) x${r.axe}°` : '—');
const va = (v) => (v ? `sc ${v.sc || '—'} / cc ${v.cc || '—'} / ph ${v.ph || '—'}` : '—');

function viewPatient(p) {
  if (!p) { currentId = null; return render(); }
  $back.hidden = false;
  $title.textContent = `${p.lastName} ${p.firstName}`;
  const exams = [...(p.examinations || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const surg = [];
  exams.forEach((e) => (e.surgeriesPlanned || []).forEach((s) => surg.push(s)));
  surg.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  $app.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Στοιχεία</h3>
      ${row('Επώνυμο', p.lastName)}${row('Όνομα', p.firstName)}${row('Πατρώνυμο', p.fatherName)}
      ${row('ΑΜΚΑ', p.amka)}${row('Ημ. γέννησης', fmtDate(p.birthDate))}
      ${row('Τηλέφωνο 1', p.phone1)}${row('Τηλέφωνο 2', p.phone2)}${row('Διεύθυνση', p.address)}
      ${row('Αρ. φακέλου', p.patientNumber)}
      ${block('Γενικό ιστορικό', p.generalHistory)}
      ${block('Οφθαλμολογικό ιστορικό', p.ophthalmicHistory)}
      ${block('Σημειώσεις', p.notes)}
    </div>
    <div class="card">
      <h3 style="margin-top:0">Χειρουργεία (${surg.length})</h3>
      ${surg.map((s) => `<div class="row"><span>${esc(fmtDate(s.date))}</span><span>${esc(s.condition)} <span class="tag">${esc(s.eye)}</span>${s.ib ? `<span class="tag">${esc(s.ib)}</span>` : ''}${s.notes ? '<br><span class="muted">' + esc(s.notes) + '</span>' : ''}</span></div>`).join('') || '<div class="muted">—</div>'}
    </div>
    <h3>Επισκέψεις (${exams.length})</h3>
    ${exams.map((e) => `
      <div class="card">
        <b>${esc(fmtDate(e.date))}</b>
        <div class="eyes">
          <div><b>ΔΟ</b><br>VA: ${esc(va(e.vaRight))}<br>Rx: ${esc(rx(e.refractionRight))}<br>Near: ${esc(rx(e.refractionRightNear))}<br>IOP: ${esc(e.tonometryRight || '—')}${e.cctRight ? '<br>CCT: ' + esc(e.cctRight) : ''}${e.cdRight ? '<br>C/D: ' + esc(e.cdRight) : ''}</div>
          <div><b>ΑΟ</b><br>VA: ${esc(va(e.vaLeft))}<br>Rx: ${esc(rx(e.refractionLeft))}<br>Near: ${esc(rx(e.refractionLeftNear))}<br>IOP: ${esc(e.tonometryLeft || '—')}${e.cctLeft ? '<br>CCT: ' + esc(e.cctLeft) : ''}${e.cdLeft ? '<br>C/D: ' + esc(e.cdLeft) : ''}</div>
        </div>
        ${block('Πρόσθιο ΔΟ', e.anteriorSegmentRight)}${block('Πρόσθιο ΑΟ', e.anteriorSegmentLeft)}
        ${block('Βυθός ΔΟ', e.fundoscopyRight)}${block('Βυθός ΑΟ', e.fundoscopyLeft)}
        ${block('Σχόλια ΔΟ', e.eyeCommentsRight)}${block('Σχόλια ΑΟ', e.eyeCommentsLeft)}
        ${block('Σχόλια', e.comments)}${block('Σημειώσεις', e.notes)}
        ${(e.images || []).length ? `<h3>Εικόνες (${e.images.length})</h3><div class="imgs">${e.images.map(imgTile).join('')}</div>` : ''}
      </div>`).join('') || '<div class="muted">Καμία επίσκεψη</div>'}`;
}

// Attachments may be images or PDFs (stored as data: URLs). PDFs cannot render in <img>, so show a tile that opens a blob URL.
function imgTile(im) {
  const url = String(im.url || '');
  if (/^data:application\/pdf/i.test(url) || /\.pdf$/i.test(im.name || '')) {
    return `<a class="pdf-tile" href="#" data-pdf="${esc(im.id)}" title="${esc(im.name)}" style="display:flex;flex-direction:column;align-items:center;justify-content:center;aspect-ratio:1;border-radius:8px;background:#fee2e2;color:#991b1b;font-weight:700;text-decoration:none;font-size:12px;padding:4px;text-align:center;overflow:hidden"><span style="font-size:22px">PDF</span><span style="font-weight:400;word-break:break-all;max-height:3.6em;overflow:hidden">${esc(im.name)}</span></a>`;
  }
  return `<img loading="lazy" src="${esc(url)}" alt="${esc(im.name)}" title="${esc(im.name)}">`;
}

document.addEventListener('click', (ev) => {
  const a = ev.target.closest && ev.target.closest('.pdf-tile');
  if (!a) return;
  ev.preventDefault();
  let found = null;
  for (const p of (data && data.patients) || []) for (const x of p.examinations || []) for (const im of x.images || []) if (im.id === a.dataset.pdf) found = im;
  if (!found) return;
  const bin = atob(String(found.url).split(',')[1]);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  window.open(URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })), '_blank');
});

// Tap an image to view it full screen (pinch to zoom); tap again to close
document.addEventListener('click', (ev) => {
  const t = ev.target;
  if (t.matches && t.matches('.imgs img')) {
    const o = document.createElement('div');
    o.className = 'lightbox';
    o.innerHTML = `<img src="${t.src}">`;
    o.onclick = () => o.remove();
    document.body.appendChild(o);
  }
});

// Auto-lock when the app goes to background for >2 minutes
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (data && hiddenAt && Date.now() - hiddenAt > 120000) lock();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
viewLogin();
