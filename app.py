from flask import Flask, request, jsonify, send_from_directory
import os, json, uuid, smtplib
from datetime import datetime, timedelta
from email.mime.text import MIMEText
from werkzeug.utils import secure_filename
from apscheduler.schedulers.background import BackgroundScheduler

app = Flask(__name__, static_folder='frontend', static_url_path='')
PORT = int(os.environ.get('PORT', 3000))

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), 'uploads')
SITES_FILE = os.path.join(DATA_DIR, 'sites.json')
VISITS_FILE = os.path.join(DATA_DIR, 'visits.json')

os.makedirs(DATA_DIR, exist_ok=True)
os.makedirs(UPLOADS_DIR, exist_ok=True)
if not os.path.exists(SITES_FILE): json.dump([], open(SITES_FILE, 'w'))
if not os.path.exists(VISITS_FILE): json.dump([], open(VISITS_FILE, 'w'))

# --- Helpers ---
def read_sites():
    return json.load(open(SITES_FILE, 'r'))

def write_sites(sites):
    json.dump(sites, open(SITES_FILE, 'w'), indent=2)

def read_visits():
    return json.load(open(VISITS_FILE, 'r'))

def write_visits(visits):
    json.dump(visits, open(VISITS_FILE, 'w'))

# --- Static files ---
@app.route('/')
def index():
    return send_from_directory('frontend', 'index.html')

@app.route('/uploads/<path:filename>')
def uploaded_file(filename):
    return send_from_directory(UPLOADS_DIR, filename)

# --- Sites API ---
@app.route('/api/sites', methods=['GET'])
def get_sites():
    return jsonify(read_sites())

@app.route('/api/sites/<site_id>', methods=['GET'])
def get_site(site_id):
    sites = read_sites()
    site = next((s for s in sites if s['id'] == site_id), None)
    if not site: return jsonify({'error': 'Not found'}), 404
    return jsonify(site)

@app.route('/api/sites', methods=['POST'])
def create_site():
    sites = read_sites()
    data = request.json
    site = {
        'id': 'SITE-' + str(int(datetime.now().timestamp() * 1000)),
        **data,
        'documents': [],
        'amendments': [],
        'activityLog': [{'action': 'Site created', 'by': data.get('createdBy', 'System'), 'at': datetime.now().isoformat()}],
        'createdAt': datetime.now().isoformat(),
        'updatedAt': datetime.now().isoformat()
    }
    sites.append(site)
    write_sites(sites)
    return jsonify(site), 201

@app.route('/api/sites/<site_id>', methods=['PUT'])
def update_site(site_id):
    sites = read_sites()
    idx = next((i for i, s in enumerate(sites) if s['id'] == site_id), None)
    if idx is None: return jsonify({'error': 'Not found'}), 404
    old = sites[idx]
    data = request.json
    updated = {**old, **data, 'updatedAt': datetime.now().isoformat()}
    if data.get('loiActualDate') and not old.get('loiActualDate'):
        updated['activityLog'] = old.get('activityLog', []) + [{'action': 'LOI marked as sent', 'by': data.get('updatedBy', 'System'), 'at': datetime.now().isoformat()}]
    if data.get('woActualDate') and not old.get('woActualDate'):
        updated['activityLog'] = old.get('activityLog', []) + [{'action': 'Work Order executed', 'by': data.get('updatedBy', 'System'), 'at': datetime.now().isoformat()}]
    sites[idx] = updated
    write_sites(sites)
    return jsonify(updated)

@app.route('/api/sites/<site_id>', methods=['DELETE'])
def delete_site(site_id):
    sites = [s for s in read_sites() if s['id'] != site_id]
    write_sites(sites)
    return jsonify({'success': True})

# --- Documents API ---
@app.route('/api/sites/<site_id>/documents', methods=['POST'])
def upload_documents(site_id):
    sites = read_sites()
    idx = next((i for i, s in enumerate(sites) if s['id'] == site_id), None)
    if idx is None: return jsonify({'error': 'Not found'}), 404

    site_dir = os.path.join(UPLOADS_DIR, site_id)
    os.makedirs(site_dir, exist_ok=True)

    category = request.form.get('category', 'Other')
    uploaded_by = request.form.get('uploadedBy', 'System')
    new_docs = []

    for file in request.files.getlist('files'):
        filename = str(int(datetime.now().timestamp() * 1000)) + '-' + secure_filename(file.filename)
        file.save(os.path.join(site_dir, filename))
        doc = {
            'id': 'DOC-' + str(int(datetime.now().timestamp() * 1000)) + '-' + uuid.uuid4().hex[:5],
            'name': file.filename,
            'path': f'/uploads/{site_id}/{filename}',
            'category': category,
            'version': 1,
            'uploadedBy': uploaded_by,
            'uploadedAt': datetime.now().isoformat()
        }
        new_docs.append(doc)

    sites[idx]['documents'] = sites[idx].get('documents', []) + new_docs
    sites[idx]['activityLog'] = sites[idx].get('activityLog', []) + [{'action': f'Uploaded {len(new_docs)} document(s)', 'by': uploaded_by, 'at': datetime.now().isoformat()}]
    sites[idx]['updatedAt'] = datetime.now().isoformat()
    write_sites(sites)
    return jsonify(new_docs)

@app.route('/api/sites/<site_id>/documents/<doc_id>/amend', methods=['POST'])
def amend_document(site_id, doc_id):
    sites = read_sites()
    idx = next((i for i, s in enumerate(sites) if s['id'] == site_id), None)
    if idx is None: return jsonify({'error': 'Not found'}), 404

    doc_idx = next((i for i, d in enumerate(sites[idx].get('documents', [])) if d['id'] == doc_id), None)
    if doc_idx is None: return jsonify({'error': 'Doc not found'}), 404

    old_doc = sites[idx]['documents'][doc_idx]
    new_ver = old_doc.get('version', 1) + 1
    file = request.files['file']

    site_dir = os.path.join(UPLOADS_DIR, site_id)
    os.makedirs(site_dir, exist_ok=True)
    filename = str(int(datetime.now().timestamp() * 1000)) + '-' + secure_filename(file.filename)
    file.save(os.path.join(site_dir, filename))

    sites[idx]['documents'][doc_idx] = {**old_doc, 'path': f'/uploads/{site_id}/{filename}', 'version': new_ver, 'uploadedAt': datetime.now().isoformat()}

    amendment = {
        'id': 'AMD-' + str(int(datetime.now().timestamp() * 1000)),
        'documentId': doc_id,
        'documentName': old_doc['name'],
        'description': request.form.get('description', 'Amended'),
        'previousVersion': old_doc.get('version', 1),
        'newVersion': new_ver,
        'previousPath': old_doc['path'],
        'amendedBy': request.form.get('amendedBy', 'System'),
        'amendedAt': datetime.now().isoformat()
    }
    sites[idx]['amendments'] = sites[idx].get('amendments', []) + [amendment]
    sites[idx]['activityLog'] = sites[idx].get('activityLog', []) + [{'action': f'Amended "{old_doc["name"]}" (v{old_doc.get("version",1)} -> v{new_ver})', 'by': request.form.get('amendedBy', 'System'), 'at': datetime.now().isoformat()}]
    write_sites(sites)
    return jsonify({'amendment': amendment, 'document': sites[idx]['documents'][doc_idx]})

@app.route('/api/sites/<site_id>/documents/<doc_id>', methods=['DELETE'])
def delete_document(site_id, doc_id):
    sites = read_sites()
    idx = next((i for i, s in enumerate(sites) if s['id'] == site_id), None)
    if idx is None: return jsonify({'error': 'Not found'}), 404
    sites[idx]['documents'] = [d for d in sites[idx].get('documents', []) if d['id'] != doc_id]
    write_sites(sites)
    return jsonify({'success': True})

# --- Visits API ---
@app.route('/api/visits', methods=['POST'])
def track_visit():
    visits = read_visits()
    visits.append({'user': request.json.get('user', ''), 'at': datetime.now().isoformat()})
    write_visits(visits)
    return jsonify({'success': True})

@app.route('/api/visits/today', methods=['GET'])
def visits_today():
    visits = read_visits()
    today = datetime.now().strftime('%Y-%m-%d')
    today_visits = [v for v in visits if v.get('at', '').startswith(today)]
    visitors = list(set(v.get('user', '') for v in today_visits if v.get('user')))
    return jsonify({'count': len(today_visits), 'visitors': visitors})

# --- Automated Overdue Emails ---
SMTP_HOST = os.environ.get('SMTP_HOST', '')
SMTP_PORT = int(os.environ.get('SMTP_PORT', 587))
SMTP_USER = os.environ.get('SMTP_USER', '')
SMTP_PASS = os.environ.get('SMTP_PASS', '')

def send_overdue_emails():
    if not SMTP_HOST:
        print(f'[{datetime.now().isoformat()}] SMTP not configured, skipping emails')
        return
    sites = read_sites()
    today = datetime.now().strftime('%Y-%m-%d')

    for site in sites:
        overdue = []
        if not site.get('loiActualDate') and site.get('loiTargetDate') and site['loiTargetDate'] < today:
            overdue.append(('LOI', site['loiTargetDate']))
        if site.get('loiActualDate') and not site.get('woActualDate') and site.get('woTargetDate') and site['woTargetDate'] < today:
            overdue.append(('Work Order', site['woTargetDate']))
        if site.get('contractEndDate'):
            end = datetime.strptime(site['contractEndDate'], '%Y-%m-%d')
            if datetime.now() >= end - timedelta(days=60):
                overdue.append(('Contract Renewal', site['contractEndDate']))

        if overdue and site.get('pocEmail'):
            days_diff = lambda d: (datetime.now() - datetime.strptime(d, '%Y-%m-%d')).days
            items = '\n'.join(f"  - {task} (due {date}, {days_diff(date)} days overdue)" for task, date in overdue)
            body = f"Hi {site.get('pocName', '')},\n\nOverdue tasks for \"{site['siteName']}\" ({site.get('city', '')}):\n\n{items}\n\nPlease update the tracker.\n\n- Site Procurement Tracker"

            try:
                msg = MIMEText(body)
                msg['Subject'] = f"[OVERDUE] {site['siteName']} - Action Required"
                msg['From'] = 'tracker@yourcompany.com'
                msg['To'] = site['pocEmail']
                if site.get('managerEmail'):
                    msg['Cc'] = site['managerEmail']
                with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
                    server.starttls()
                    server.login(SMTP_USER, SMTP_PASS)
                    recipients = [site['pocEmail']] + ([site['managerEmail']] if site.get('managerEmail') else [])
                    server.sendmail('tracker@yourcompany.com', recipients, msg.as_string())
            except Exception as e:
                print(f"Email failed for {site['siteName']}: {e}")

    print(f'[{datetime.now().isoformat()}] Overdue check done.')

# Schedule daily at 9 AM
scheduler = BackgroundScheduler()
scheduler.add_job(send_overdue_emails, 'cron', hour=9, minute=0)
scheduler.start()

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=PORT, debug=False)
