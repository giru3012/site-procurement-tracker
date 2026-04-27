// --- CONFIG ---
const API = '/api';
const ADMIN_PIN = '123456'; // Change this
let sites = [];
let editId = null;
let adminMode = false;
let currentUser = '';

// Show login screen - mandatory
function showLogin() {
  document.getElementById('loginOverlay').style.display = 'flex';
}

function doLogin() {
  const name = document.getElementById('loginName').value.trim();
  if (!name) { document.getElementById('loginError').style.display = 'block'; return; }
  currentUser = name;
  localStorage.setItem('tracker_user', name);
  document.getElementById('loginOverlay').style.display = 'none';
  document.getElementById('userLabel').textContent = 'User: ' + currentUser;
  fetchSites();
}

// Check if user already logged in
const savedUser = localStorage.getItem('tracker_user');
if (savedUser) {
  currentUser = savedUser;
  document.getElementById('userLabel').textContent = 'User: ' + currentUser;
} else {
  showLogin();
}

document.getElementById('dtL').textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

// --- API CALLS ---
async function fetchSites() {
  try {
    const res = await fetch(API + '/sites');
    sites = await res.json();
    // Backup to localStorage
    localStorage.setItem('sites_backup', JSON.stringify(sites));
  } catch(e) {
    // If server fails, load from localStorage
    const backup = localStorage.getItem('sites_backup');
    if (backup) sites = JSON.parse(backup);
  }
  render();
  checkOverdue();
}

async function apiCreateSite(data) {
  const res = await fetch(API + '/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.json();
}

async function apiUpdateSite(id, data) {
  const res = await fetch(API + '/sites/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return res.json();
}

async function apiDeleteSite(id) {
  await fetch(API + '/sites/' + id, { method: 'DELETE' });
}

async function apiUploadDocs(siteId, files, category) {
  const fd = new FormData();
  for (const f of files) fd.append('files', f);
  fd.append('category', category);
  fd.append('uploadedBy', currentUser);
  const res = await fetch(API + '/sites/' + siteId + '/documents', { method: 'POST', body: fd });
  return res.json();
}

async function apiAmendDoc(siteId, docId, file, description) {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('description', description);
  fd.append('amendedBy', currentUser);
  const res = await fetch(API + '/sites/' + siteId + '/documents/' + docId + '/amend', { method: 'POST', body: fd });
  return res.json();
}

async function apiDeleteDoc(siteId, docId) {
  await fetch(API + '/sites/' + siteId + '/documents/' + docId, { method: 'DELETE' });
}

// --- STATUS HELPERS ---
function getStatus(s) {
  if (s.amendmentStatus && s.amendmentStatus !== 'None' && s.amendmentStatus !== 'Resolved') return 'a';
  if (s.woActualDate) return 'd';
  if (s.loiActualDate) return 'w';
  return 'l';
}

function isLoiOverdue(s) { return !s.loiActualDate && s.loiTargetDate && new Date() > new Date(s.loiTargetDate + 'T23:59:59'); }
function isWoOverdue(s) { return s.loiActualDate && !s.woActualDate && s.woTargetDate && new Date() > new Date(s.woTargetDate + 'T23:59:59'); }

function daysDiff(dateStr) { return Math.floor((new Date() - new Date(dateStr)) / 86400000); }

// --- RENDER ---
function render() {
  const q = document.getElementById('srch').value.toLowerCase();
  const filtered = sites.filter(s =>
    (s.siteName || '').toLowerCase().includes(q) ||
    (s.city || '').toLowerCase().includes(q) ||
    (s.partnerName || '').toLowerCase().includes(q) ||
    (s.siteType || '').toLowerCase().includes(q)
  );

  updateCards(filtered);

  const tb = document.getElementById('tb');
  if (!filtered.length) {
    tb.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:22px;color:#999;">No sites found. Click "Add New Site" to begin.</td></tr>';
    return;
  }

  tb.innerHTML = filtered.map((s, i) => {
    const st = getStatus(s), ol = isLoiOverdue(s), ow = isWoOverdue(s);
    const rc = ol ? 'rol' : ow ? 'row' : st === 'l' ? 'rl' : st === 'w' ? 'rw' : st === 'd' ? 'rd' : 'ra';
    const badge = ol ? '<span class="badge bo">? LOI OVERDUE (' + daysDiff(s.loiTargetDate) + 'd)</span>' :
                  ow ? '<span class="badge bo">? WO OVERDUE (' + daysDiff(s.woTargetDate) + 'd)</span>' :
                  st === 'l' ? '<span class="badge bl">LOI Pending</span>' :
                  st === 'w' ? '<span class="badge bw">WO Pending</span>' :
                  st === 'd' ? '<span class="badge bd">Completed</span>' :
                  '<span class="badge ba">Amendment</span>';
    const typeB = s.siteType ? '<span class="stb s' + s.siteType + '">' + s.siteType + '</span>' : '-';
    const delBtn = adminMode ? ' <button class="b-dl" onclick="deleteSite(\'' + s.id + '\')">[Del]</button>' : '';
    const docCount = (s.documents || []).length;
    const docNames = (s.documents || []).map(d => '<a href="' + d.path + '" target="_blank" style="font-size:10px;color:#2980b9;display:block;">' + d.category + ': ' + d.name + '</a>').join('');

    return `<tr class="${rc}">
      <td>${i + 1}</td><td><strong>${s.siteName || ''}</strong></td><td>${typeB}</td>
      <td>${s.city || ''}</td><td>${s.partnerName || ''}</td><td>${s.pocName || ''}</td>
      <td>${s.commercialCloseDate || '-'}</td><td style="font-weight:bold">${s.loiTargetDate || '-'}</td>
      <td>${s.loiActualDate || '-'}</td><td style="font-weight:bold">${s.woTargetDate || '-'}</td>
      <td>${s.woActualDate || '-'}</td><td>${s.amendmentStatus !== 'None' ? s.amendmentStatus : '-'}</td>
      <td>${badge}</td>
      <td style="max-width:180px;font-size:10px;">${docNames || '<span style="color:#999">No docs</span>'}</td>
      <td style="white-space:nowrap">
        <button class="b-view" onclick="showDetail('${s.id}')">[Docs] View (${docCount})</button>
        <button class="b-ed" onclick="showForm('${s.id}')">[Edit]</button>${delBtn}
      </td>
    </tr>`;
  }).join('');
}

function updateCards(list) {
  document.getElementById('cT').textContent = list.length;
  document.getElementById('cS').textContent = list.filter(s => s.siteType === 'SSD').length;
  document.getElementById('cD').textContent = list.filter(s => s.siteType === 'DG').length;
  document.getElementById('cF').textContent = list.filter(s => s.siteType === 'FC').length;
  document.getElementById('cO').textContent = list.filter(s => s.siteType === 'Other').length;
  document.getElementById('cL').textContent = list.filter(s => getStatus(s) === 'l').length;
  document.getElementById('cW').textContent = list.filter(s => getStatus(s) === 'w').length;
  document.getElementById('cDn').textContent = list.filter(s => getStatus(s) === 'd').length;
  document.getElementById('cA').textContent = list.filter(s => getStatus(s) === 'a').length;
}

function checkOverdue() {
  const od = sites.filter(s => isLoiOverdue(s) || isWoOverdue(s));
  const b = document.getElementById('ovb');
  if (!od.length) { b.style.display = 'none'; return; }
  b.style.display = 'block';
  document.getElementById('ovl').innerHTML = od.map(s => {
    let items = '';
    if (isLoiOverdue(s)) items += `<li><strong>${s.siteName}</strong> (${s.city}) - LOI overdue by ${daysDiff(s.loiTargetDate)} days</li>`;
    if (isWoOverdue(s)) items += `<li><strong>${s.siteName}</strong> (${s.city}) - WO overdue by ${daysDiff(s.woTargetDate)} days</li>`;
    return items;
  }).join('');
}

// --- FORM ---
function showForm(id) {
  editId = id === -1 ? null : id;
  const s = editId ? sites.find(x => x.id === editId) : null;
  document.getElementById('fpT').textContent = s ? 'Edit Site' : 'Add New Site';
  document.getElementById('fN').value = s ? s.siteName : '';
  document.getElementById('fTy').value = s ? s.siteType : '';
  document.getElementById('fCi').value = s ? s.city : '';
  document.getElementById('fPa').value = s ? s.partnerName : '';
  document.getElementById('fPn').value = s ? s.pocName : '';
  document.getElementById('fPe').value = s ? s.pocEmail : '';
  document.getElementById('fCd').value = s ? s.commercialCloseDate : '';
  document.getElementById('fLt').value = s ? s.loiTargetDate : '';
  document.getElementById('fLa').value = s ? s.loiActualDate : '';
  document.getElementById('fWt').value = s ? s.woTargetDate : '';
  document.getElementById('fWa').value = s ? s.woActualDate : '';
  document.getElementById('fAm').value = s ? s.amendmentStatus : 'None';
  document.getElementById('fRm').value = s ? s.remarks : '';

  // Clear file inputs
  ['fDocCommercial','fDocBRS','fDocLOI','fDocWO','fDocSurvey','fDocOther'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Show existing documents when editing
  const existingDiv = document.getElementById('existingDocs');
  if (s && s.documents && s.documents.length > 0) {
    existingDiv.innerHTML = '<label style="font-size:11px;font-weight:bold;color:#555;">Already Uploaded:</label>' +
      s.documents.map(d => `<div class="existing-doc-item">
        <span>?</span>
        <a href="${d.path}" target="_blank">${d.name}</a>
        <span style="color:#888;">[${d.category}] v${d.version}</span>
      </div>`).join('');
  } else {
    existingDiv.innerHTML = '';
  }

  document.getElementById('fp').style.display = 'block';
  document.getElementById('fp').scrollIntoView({ behavior: 'smooth' });
}

function hideForm() { document.getElementById('fp').style.display = 'none'; editId = null; }

async function saveSite() {
  const required = [
    { id: 'fN', lb: 'Site Name' }, { id: 'fTy', lb: 'Site Type' }, { id: 'fCi', lb: 'City' },
    { id: 'fPa', lb: 'Partner Name' }, { id: 'fPn', lb: 'POC Name' }, { id: 'fPe', lb: 'POC Email' },
    { id: 'fCd', lb: 'Commercial Close Date' }, { id: 'fLt', lb: 'LOI Target Date' }, { id: 'fWt', lb: 'WO Target Date' }
  ];
  for (const r of required) {
    if (!document.getElementById(r.id).value.trim()) { alert('Please fill: ' + r.lb); return; }
  }

  const data = {
    siteName: document.getElementById('fN').value.trim(),
    siteType: document.getElementById('fTy').value,
    city: document.getElementById('fCi').value.trim(),
    partnerName: document.getElementById('fPa').value.trim(),
    pocName: document.getElementById('fPn').value.trim(),
    pocEmail: document.getElementById('fPe').value.trim(),
    commercialCloseDate: document.getElementById('fCd').value,
    loiTargetDate: document.getElementById('fLt').value,
    loiActualDate: document.getElementById('fLa').value,
    woTargetDate: document.getElementById('fWt').value,
    woActualDate: document.getElementById('fWa').value,
    amendmentStatus: document.getElementById('fAm').value,
    remarks: document.getElementById('fRm').value.trim(),
    updatedBy: currentUser
  };

  let site;
  if (editId) {
    site = await apiUpdateSite(editId, data);
  } else {
    data.createdBy = currentUser;
    site = await apiCreateSite(data);
  }

  // Upload documents for each category
  const docFields = [
    { id: 'fDocCommercial', category: 'Commercial' },
    { id: 'fDocBRS', category: 'BRS' },
    { id: 'fDocLOI', category: 'LOI' },
    { id: 'fDocWO', category: 'Work Order' },
    { id: 'fDocSurvey', category: 'Site Survey' },
    { id: 'fDocOther', category: 'Other' }
  ];

  for (const df of docFields) {
    const input = document.getElementById(df.id);
    if (input && input.files && input.files.length > 0) {
      await apiUploadDocs(site.id, input.files, df.category);
    }
  }

  hideForm();
  await fetchSites();
}

async function deleteSite(id) {
  const s = sites.find(x => x.id === id);
  if (confirm('Delete "' + s.siteName + '"? This cannot be undone.')) {
    await apiDeleteSite(id);
    await fetchSites();
  }
}

// --- DETAIL PANEL (Documents, Amendments, Activity) ---
function showDetail(id) {
  const s = sites.find(x => x.id === id);
  if (!s) return;
  const panel = document.getElementById('detailPanel');
  panel.style.display = 'block';

  const docs = (s.documents || []).map(d => `
    <div class="doc-item">
      <span><a href="${d.path}" target="_blank">${d.name}</a></span>
      <span class="stb s${d.category || 'Other'}">${d.category || 'Other'}</span>
      <span style="color:#999;font-size:10px;">v${d.version} | ${d.uploadedBy} | ${d.uploadedAt ? d.uploadedAt.split('T')[0] : ''}</span>
      <button class="b-rm" onclick="amendDoc('${s.id}','${d.id}','${d.name}')">[Amend]</button>
      ${adminMode ? '<button class="b-dl" onclick="deleteDoc(\'' + s.id + '\',\'' + d.id + '\')">[Del]</button>' : ''}
    </div>
  `).join('') || '<p style="color:#999;font-size:11px;">No documents uploaded yet.</p>';

  const amendments = (s.amendments || []).map(a => `
    <div class="amend-item">
      <strong>${a.documentName}</strong> v${a.previousVersion} ? v${a.newVersion}<br/>
      ${a.description}<br/>
      <span style="color:#999;">By ${a.amendedBy} on ${a.amendedAt ? a.amendedAt.split('T')[0] : ''}</span>
    </div>
  `).join('') || '<p style="color:#999;font-size:11px;">No amendments.</p>';

  const activity = (s.activityLog || []).slice(-10).reverse().map(a => `
    <div class="activity-item">? ${a.action} ? <em>${a.by}</em> (${a.at ? a.at.split('T')[0] : ''})</div>
  `).join('');

  panel.innerHTML = `
    <div class="detail-header">
      <h2>? ${s.siteName} ? ${s.city}</h2>
      <button class="b-cn" onclick="document.getElementById('detailPanel').style.display='none'">X Close</button>
    </div>
    <div class="detail-section">
      <h3>Documents</h3>
      ${docs}
      <div class="upload-zone">
        <label><strong>Upload New Document:</strong></label><br/>
        <select id="docCat"><option value="Commercial">Commercial</option><option value="LOI">LOI</option><option value="Work Order">Work Order</option><option value="Amendment">Amendment</option><option value="Other">Other</option></select>
        <input type="file" id="docFiles" multiple accept=".pdf,.doc,.docx,.xlsx,.xls,.jpg,.jpeg,.png"/>
        <button class="b-sv" onclick="uploadDocs('${s.id}')" style="margin-top:5px;">Upload</button>
      </div>
    </div>
    <div class="detail-section">
      <h3>[Amend]ment History</h3>
      ${amendments}
    </div>
    <div class="detail-section">
      <h3>? Activity Log</h3>
      ${activity}
    </div>
  `;
  panel.scrollIntoView({ behavior: 'smooth' });
}

async function uploadDocs(siteId) {
  const files = document.getElementById('docFiles').files;
  if (!files.length) { alert('Select files to upload'); return; }
  const category = document.getElementById('docCat').value;
  await apiUploadDocs(siteId, files, category);
  await fetchSites();
  showDetail(siteId);
}

async function amendDoc(siteId, docId, docName) {
  const desc = prompt('What changed in "' + docName + '"?');
  if (!desc) return;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.doc,.docx,.xlsx,.xls,.jpg,.jpeg,.png';
  input.onchange = async () => {
    if (input.files.length) {
      await apiAmendDoc(siteId, docId, input.files[0], desc);
      await fetchSites();
      showDetail(siteId);
    }
  };
  input.click();
}

async function deleteDoc(siteId, docId) {
  if (confirm('Delete this document?')) {
    await apiDeleteDoc(siteId, docId);
    await fetchSites();
    showDetail(siteId);
  }
}

// --- EXPORT ---
function exportData() {
  const headers = ['Site Name','Type','City','Partner','POC Name','POC Email','Commercial Close','LOI Target','LOI Actual','WO Target','WO Actual','Amendment Status','Remarks','Status','Documents','Document Links'];
  const rows = sites.map(s => [
    s.siteName, s.siteType, s.city, s.partnerName, s.pocName, s.pocEmail,
    s.commercialCloseDate, s.loiTargetDate, s.loiActualDate, s.woTargetDate, s.woActualDate,
    s.amendmentStatus, s.remarks,
    getStatus(s)==='d'?'Completed':getStatus(s)==='w'?'WO Pending':getStatus(s)==='a'?'Amendment':'LOI Pending',
    (s.documents||[]).map(d => d.name).join('; '),
    (s.documents||[]).map(d => window.location.origin + d.path).join('; ')
  ].map(v => '"' + (v||'').replace(/"/g,'""') + '"').join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'SiteTracker_' + new Date().toISOString().split('T')[0] + '.csv';
  a.click();
}

// --- USER ACTIVITY LOG ---
function showActivityLog() {
  const panel = document.getElementById('detailPanel');
  panel.style.display = 'block';

  // Collect all activity from all sites, sorted by date (newest first)
  let allActivity = [];
  sites.forEach(s => {
    (s.activityLog || []).forEach(a => {
      allActivity.push({ site: s.siteName, city: s.city, action: a.action, by: a.by, at: a.at });
    });
  });
  allActivity.sort((a, b) => (b.at || '').localeCompare(a.at || ''));

  const rows = allActivity.slice(0, 50).map(a => 
    `<tr><td>${a.at ? a.at.split('T')[0] : '-'}</td><td>${a.at ? a.at.split('T')[1].substring(0,5) : ''}</td><td><strong>${a.by || '-'}</strong></td><td>${a.site} (${a.city})</td><td>${a.action}</td></tr>`
  ).join('');

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h2 style="color:#1a3c5e;font-size:16px;">User Activity Log (Last 50 actions)</h2>
      <button class="b-cn" onclick="document.getElementById('detailPanel').style.display='none'">X Close</button>
    </div>
    <table style="font-size:11px;">
      <thead><tr><th>Date</th><th>Time</th><th>User</th><th>Site</th><th>Action</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#999;">No activity yet.</td></tr>'}</tbody>
    </table>`;
  panel.scrollIntoView({ behavior: 'smooth' });
}

// --- LOGOUT ---
function logout() {
  localStorage.removeItem('tracker_user');
  currentUser = '';
  showLogin();
}

// --- ADMIN ---
function togAdm() {
  if (!adminMode) {
    document.getElementById('pIn').value = '';
    document.getElementById('pe').style.display = 'none';
    document.getElementById('po').style.display = 'block';
  } else {
    adminMode = false;
    document.getElementById('aBtn').textContent = 'Admin Mode [OFF]';
    document.getElementById('aBtn').className = 'b-adm';
    document.getElementById('adb').style.display = 'none';
    render();
  }
}

function verifyPin() {
  if (document.getElementById('pIn').value === ADMIN_PIN) {
    adminMode = true;
    document.getElementById('aBtn').textContent = 'Admin Mode [ON]';
    document.getElementById('aBtn').className = 'b-adm-on';
    document.getElementById('adb').style.display = 'block';
    document.getElementById('po').style.display = 'none';
    render();
  } else {
    document.getElementById('pe').style.display = 'block';
    document.getElementById('pIn').value = '';
  }
}

// --- INIT ---
if (currentUser) fetchSites();
