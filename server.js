const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const nodemailer = require('nodemailer');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Data storage (JSON file-based - replace with DynamoDB for production)
const DATA_FILE = path.join(__dirname, 'data', 'sites.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// File upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const siteDir = path.join(UPLOADS_DIR, req.params.siteId || 'temp');
    fs.mkdirSync(siteDir, { recursive: true });
    cb(null, siteDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// Helper functions
function readSites() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
function writeSites(sites) { fs.writeFileSync(DATA_FILE, JSON.stringify(sites, null, 2)); }

// --- API ROUTES ---

// Get all sites
app.get('/api/sites', (req, res) => {
  res.json(readSites());
});

// Get single site
app.get('/api/sites/:id', (req, res) => {
  const sites = readSites();
  const site = sites.find(s => s.id === req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(site);
});

// Create site
app.post('/api/sites', (req, res) => {
  const sites = readSites();
  const site = {
    id: 'SITE-' + Date.now(),
    ...req.body,
    documents: [],
    amendments: [],
    activityLog: [{ action: 'Site created', by: req.body.createdBy || 'System', at: new Date().toISOString() }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  sites.push(site);
  writeSites(sites);
  res.status(201).json(site);
});

// Update site
app.put('/api/sites/:id', (req, res) => {
  const sites = readSites();
  const idx = sites.findIndex(s => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });

  const old = sites[idx];
  const updated = { ...old, ...req.body, updatedAt: new Date().toISOString() };

  // Track status changes in activity log
  if (req.body.loiActualDate && !old.loiActualDate) {
    updated.activityLog = [...(old.activityLog || []), { action: 'LOI marked as sent', by: req.body.updatedBy || 'System', at: new Date().toISOString() }];
  }
  if (req.body.woActualDate && !old.woActualDate) {
    updated.activityLog = [...(old.activityLog || []), { action: 'Work Order executed', by: req.body.updatedBy || 'System', at: new Date().toISOString() }];
  }

  sites[idx] = updated;
  writeSites(sites);
  res.json(updated);
});

// Delete site
app.delete('/api/sites/:id', (req, res) => {
  let sites = readSites();
  sites = sites.filter(s => s.id !== req.params.id);
  writeSites(sites);
  res.json({ success: true });
});

// Upload documents for a site
app.post('/api/sites/:siteId/documents', upload.array('files', 10), (req, res) => {
  const sites = readSites();
  const idx = sites.findIndex(s => s.id === req.params.siteId);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });

  const newDocs = req.files.map(f => ({
    id: 'DOC-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
    name: f.originalname,
    path: `/uploads/${req.params.siteId}/${f.filename}`,
    category: req.body.category || 'Other',
    version: 1,
    uploadedBy: req.body.uploadedBy || 'System',
    uploadedAt: new Date().toISOString()
  }));

  sites[idx].documents = [...(sites[idx].documents || []), ...newDocs];
  sites[idx].activityLog = [...(sites[idx].activityLog || []), { action: `Uploaded ${newDocs.length} document(s)`, by: req.body.uploadedBy || 'System', at: new Date().toISOString() }];
  sites[idx].updatedAt = new Date().toISOString();
  writeSites(sites);
  res.json(newDocs);
});

// Amend a document (upload new version)
app.post('/api/sites/:siteId/documents/:docId/amend', upload.single('file'), (req, res) => {
  const sites = readSites();
  const idx = sites.findIndex(s => s.id === req.params.siteId);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });

  const docIdx = sites[idx].documents.findIndex(d => d.id === req.params.docId);
  if (docIdx === -1) return res.status(404).json({ error: 'Document not found' });

  const oldDoc = sites[idx].documents[docIdx];
  const newVersion = (oldDoc.version || 1) + 1;

  // Update document to new version
  sites[idx].documents[docIdx] = {
    ...oldDoc,
    path: `/uploads/${req.params.siteId}/${req.file.filename}`,
    version: newVersion,
    uploadedAt: new Date().toISOString()
  };

  // Record amendment
  const amendment = {
    id: 'AMD-' + Date.now(),
    documentId: req.params.docId,
    documentName: oldDoc.name,
    description: req.body.description || 'Document amended',
    previousVersion: oldDoc.version || 1,
    newVersion,
    previousPath: oldDoc.path,
    amendedBy: req.body.amendedBy || 'System',
    amendedAt: new Date().toISOString()
  };

  sites[idx].amendments = [...(sites[idx].amendments || []), amendment];
  sites[idx].activityLog = [...(sites[idx].activityLog || []), { action: `Amended "${oldDoc.name}" (v${oldDoc.version} â†’ v${newVersion})`, by: req.body.amendedBy || 'System', at: new Date().toISOString() }];
  sites[idx].updatedAt = new Date().toISOString();
  writeSites(sites);
  res.json({ amendment, document: sites[idx].documents[docIdx] });
});

// Delete document
app.delete('/api/sites/:siteId/documents/:docId', (req, res) => {
  const sites = readSites();
  const idx = sites.findIndex(s => s.id === req.params.siteId);
  if (idx === -1) return res.status(404).json({ error: 'Site not found' });

  sites[idx].documents = (sites[idx].documents || []).filter(d => d.id !== req.params.docId);
  sites[idx].updatedAt = new Date().toISOString();
  writeSites(sites);
  res.json({ success: true });
});

// --- AUTOMATED OVERDUE EMAIL ---

// Configure email (update with your SMTP settings)
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.example.com',
  port: process.env.SMTP_PORT || 587,
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
};

async function sendOverdueEmails() {
  const sites = readSites();
  const today = new Date().toISOString().split('T')[0];
  const transporter = nodemailer.createTransport(EMAIL_CONFIG);

  for (const site of sites) {
    const overdue = [];
    if (!site.loiActualDate && site.loiTargetDate && site.loiTargetDate < today) {
      overdue.push({ task: 'LOI', dueDate: site.loiTargetDate });
    }
    if (site.loiActualDate && !site.woActualDate && site.woTargetDate && site.woTargetDate < today) {
      overdue.push({ task: 'Work Order', dueDate: site.woTargetDate });
    }

    if (overdue.length && site.pocEmail) {
      const daysDiff = (d) => Math.floor((new Date() - new Date(d)) / 86400000);
      const items = overdue.map(o => `â€¢ ${o.task} â€” due ${o.dueDate} (${daysDiff(o.dueDate)} days overdue)`).join('\n');

      await transporter.sendMail({
        from: '"Site Procurement Tracker" <tracker-noreply@yourcompany.com>',
        to: site.pocEmail,
        subject: `âš ï¸ [OVERDUE] ${site.siteName} â€” Action Required`,
        text: `Hi ${site.pocName},\n\nThe following tasks for site "${site.siteName}" (${site.city}) are overdue:\n\n${items}\n\nPlease update the tracker or escalate if blocked.\n\nâ€” Site Procurement Tracker`
      }).catch(err => console.error('Email failed for', site.siteName, err.message));
    }
  }
  console.log(`[${new Date().toISOString()}] Overdue email check completed.`);
}

// Run daily at 9 AM
cron.schedule('0 9 * * *', sendOverdueEmails);

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
