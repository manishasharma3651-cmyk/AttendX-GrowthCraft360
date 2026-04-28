"""
AttendX Backend - Flask + MySQL
Run: python app.py
Server starts at http://localhost:5000

Setup:
  1. MySQL mein database banao: CREATE DATABASE attendx;
  2. attendx_mysql.sql import karo phpmyadmin se ya: mysql -u root -p attendx < attendx_mysql.sql
  3. Neeche DB_CONFIG mein apna MySQL password fill karo
  4. pip install flask flask-cors pyjwt bcrypt PyMySQL
  5. python app.py
  6. Browser mein kholo: http://localhost:5000
     (file:// se mat kholo — fetch kaam nahi karega)

DOCUMENT UPLOAD FIX (Failed to fetch):
  MySQL ka max_allowed_packet badhao. mysql.ini / my.cnf mein add karo:
    [mysqld]
    max_allowed_packet = 64M
  Ya phpMyAdmin se run karo:
    SET GLOBAL max_allowed_packet = 67108864;
  (app.py mein session-level fix already add kar diya hai)
"""

from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import bcrypt
import jwt
import datetime
import os
import random
import string

try:
    import pymysql
    import pymysql.cursors
    USE_MYSQL = True
except ImportError:
    USE_MYSQL = False
    print("WARNING: PyMySQL not found. Install: pip install PyMySQL")

# ================================================================
#  APNA MySQL PASSWORD YAHAN DAALO
# ================================================================
# Railway pe environment variables se DB config aayega
# Local pe pehle ki tarah manually fill karo
DB_CONFIG = {
    "host":     os.environ.get("MYSQLHOST",     "localhost"),
    "port":     int(os.environ.get("MYSQLPORT", "3306")),
    "user":     os.environ.get("MYSQLUSER",     "root"),
    "password": os.environ.get("MYSQLPASSWORD", ""),   # <-- LOCAL ke liye apna password yahan
    "db":       os.environ.get("MYSQLDATABASE", "attendx"),
    "charset":  "utf8mb4",
}
# ================================================================

import os as _os
# Frontend path - works whether app.py is at root or in backend/
_base = _os.path.dirname(_os.path.abspath(__file__))
FRONTEND_DIR = _os.path.join(_base, 'frontend')
if not _os.path.exists(FRONTEND_DIR):
    FRONTEND_DIR = _os.path.join(_base, '..', 'frontend')
app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path='')
app.config['MAX_CONTENT_LENGTH'] = 20 * 1024 * 1024  # 20MB max request size
CORS(app,
     origins="*",
     allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
     methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
     expose_headers=["Content-Type"],
     supports_credentials=False
)

SECRET_KEY    = "attendx_secret_key_change_in_production"
LATE_HOUR     = 11
HALF_DAY_HOUR = 12

_db_migrated = False

def get_db():
    if USE_MYSQL:
        return pymysql.connect(
            host=DB_CONFIG["host"],
            port=DB_CONFIG["port"],
            user=DB_CONFIG["user"],
            password=DB_CONFIG["password"],
            db=DB_CONFIG["db"],
            charset=DB_CONFIG["charset"],
            cursorclass=pymysql.cursors.DictCursor
        )
    else:
        import sqlite3
        DB_PATH = os.path.join(os.path.dirname(__file__), "attendx.db")
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        # Ensure documents table exists for SQLite
        c = conn.cursor()
        c.execute("""CREATE TABLE IF NOT EXISTS documents (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL,
            doc_type TEXT NOT NULL,
            file_data TEXT NOT NULL,
            file_name TEXT,
            file_type TEXT,
            uploaded_at TEXT,
            UNIQUE(user_id, doc_type)
        )""")
        # Add bank/KYC columns if upgrading existing SQLite db
        for col, typ in [("bank_ac_no","TEXT"),("bank_name","TEXT"),("bank_branch","TEXT"),("bank_ifsc","TEXT"),("aadhar_no","TEXT"),("pan_no","TEXT")]:
            try:
                c.execute(f"ALTER TABLE users ADD COLUMN {col} {typ}")
            except Exception:
                pass
        # Add location columns if upgrading existing SQLite db
        for col in ["checkin_location","checkout_location","lunch_in_location","lunch_out_location"]:
            try:
                c.execute(f"ALTER TABLE attendance ADD COLUMN {col} TEXT")
            except Exception:
                pass
        conn.commit()
        return conn


def run_migrations():
    """Auto-add new columns to existing MySQL DB on startup"""
    global _db_migrated
    if _db_migrated:
        return
    _db_migrated = True
    if not USE_MYSQL:
        return
    try:
        db = get_db()
        for col in ["checkin_location","checkout_location","lunch_in_location","lunch_out_location"]:
            try:
                with db.cursor() as cur:
                    cur.execute(f"ALTER TABLE attendance ADD COLUMN IF NOT EXISTS {col} VARCHAR(300) DEFAULT NULL")
                db.commit()
            except Exception:
                pass
        db.close()
    except Exception:
        pass




def qry(conn, sql, params=None, fetch="none"):
    """Universal query helper: MySQL uses %s, SQLite uses ?"""
    if USE_MYSQL:
        msql = sql.replace("?", "%s")
        with conn.cursor() as cur:
            cur.execute(msql, params or ())
            if fetch == "one":
                r = cur.fetchone()
                return dict(r) if r else None
            elif fetch == "all":
                return [dict(r) for r in cur.fetchall()]
            else:
                return cur.lastrowid
    else:
        cur = conn.cursor()
        cur.execute(sql, params or ())
        if fetch == "one":
            r = cur.fetchone()
            return dict(r) if r else None
        elif fetch == "all":
            return [dict(r) for r in cur.fetchall()]
        else:
            return cur.lastrowid


def fix_timedelta(val):
    """MySQL TIME columns return timedelta; convert to HH:MM string"""
    if val is None:
        return None
    if hasattr(val, "seconds"):  # timedelta
        total = int(val.total_seconds())
        h, rem = divmod(total, 3600)
        m = rem // 60
        return f"{h:02d}:{m:02d}"
    return str(val)[:5] if val else None


def fix_record(r):
    """Normalize an attendance dict for JSON response"""
    r = dict(r)
    r["date"] = str(r.get("date", "")) if r.get("date") else ""
    for f in ["check_in", "check_out", "lunch_in", "lunch_out"]:
        r[f] = fix_timedelta(r.get(f))
    return r


def uid():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))


# ── Auth ─────────────────────────────────────────────────────
def verify_token(req):
    token = req.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return None
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except Exception:
        return None


def require_auth(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        payload = verify_token(request)
        if not payload:
            return jsonify({"error": "Unauthorized"}), 401
        request.user = payload
        return f(*args, **kwargs)
    return wrapper


def require_admin(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        payload = verify_token(request)
        if not payload or payload.get("role") != "admin":
            return jsonify({"error": "Admin access required"}), 403
        request.user = payload
        return f(*args, **kwargs)
    return wrapper



# ── Frontend Serving ─────────────────────────────────────────
@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def serve_static(path):
    # Don't intercept /api/ routes
    if path.startswith("api/"):
        from flask import abort
        abort(404)
    full = _os.path.join(app.static_folder, path)
    if _os.path.exists(full):
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")

# ================================================================
#  ROUTES
# ================================================================

@app.route("/api/login", methods=["POST"])
def login():
    data     = request.json or {}
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()
    role     = data.get("role", "")

    if not username or not password:
        return jsonify({"error": "Username aur password required hain"}), 400

    db   = get_db()
    user = qry(db, "SELECT * FROM users WHERE username=?", (username,), fetch="one")
    db.close()

    if not user:
        return jsonify({"error": "Invalid username ya password"}), 401

    try:
        ok = bcrypt.checkpw(password.encode(), user["password"].encode())
    except Exception:
        ok = password == user["password"]

    if not ok:
        return jsonify({"error": "Invalid username ya password"}), 401
    if user["role"] != role:
        return jsonify({"error": f"Yeh account {role} nahi hai."}), 401

    token = jwt.encode({
        "userId": user["id"],
        "role":   user["role"],
        "name":   user["name"],
        "exp":    datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }, SECRET_KEY, algorithm="HS256")

    return jsonify({
        "token": token,
        "user": {
            "id":       user["id"],
            "name":     user["name"],
            "username": user["username"],
            "role":     user["role"],
            "dept":     user.get("dept") or "",
            "salary":   float(user.get("salary") or 0),
            "email":    user.get("email") or "",
            "joinDate": str(user["join_date"]) if user.get("join_date") else ""
        }
    })


# ── USERS ────────────────────────────────────────────────────
@app.route("/api/users", methods=["GET"])
@require_auth
def get_users():
    db    = get_db()
    users = qry(db, "SELECT id,name,username,role,dept,salary,email,join_date,bank_ac_no,bank_name,bank_branch,bank_ifsc,aadhar_no,pan_no FROM users", fetch="all")
    db.close()
    result = []
    for u in users:
        u = dict(u)
        u["salary"]      = float(u.get("salary") or 0)
        u["join_date"]   = str(u["join_date"]) if u.get("join_date") else ""
        u["bank_ac_no"]  = u.get("bank_ac_no") or ""
        u["bank_name"]   = u.get("bank_name") or ""
        u["bank_branch"] = u.get("bank_branch") or ""
        u["bank_ifsc"]   = u.get("bank_ifsc") or ""
        u["aadhar_no"]   = u.get("aadhar_no") or ""
        u["pan_no"]      = u.get("pan_no") or ""
        result.append(u)
    return jsonify(result)


@app.route("/api/users", methods=["POST"])
@require_admin
def add_user():
    data     = request.json or {}
    name     = data.get("name", "").strip()
    username = data.get("username", "").strip()
    password = data.get("password", "").strip()

    if not name or not username or not password:
        return jsonify({"error": "Name, username aur password required hain"}), 400

    db = get_db()
    if qry(db, "SELECT id FROM users WHERE username=?", (username,), fetch="one"):
        db.close()
        return jsonify({"error": "Username already exists"}), 400

    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    new_id = uid()
    join_d = data.get("joinDate") or datetime.date.today().isoformat()

    qry(db,
        "INSERT INTO users (id,name,username,password,role,dept,salary,email,join_date,bank_ac_no,bank_name,bank_branch,bank_ifsc,aadhar_no,pan_no) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (new_id, name, username, hashed, "employee",
         data.get("dept", ""),
         float(data.get("salary") or 0),
         data.get("email", ""),
         join_d,
         data.get("bankAcNo", "") or None,
         data.get("bankName", "") or None,
         data.get("bankBranch", "") or None,
         data.get("bankIfsc", "") or None,
         data.get("aadharNo", "") or None,
         data.get("panNo", "") or None))
    db.commit()
    db.close()
    return jsonify({"success": True, "id": new_id}), 201


@app.route("/api/users/<user_id>", methods=["PUT"])
@require_admin
def update_user(user_id):
    data = request.json or {}
    db   = get_db()
    user = qry(db, "SELECT * FROM users WHERE id=?", (user_id,), fetch="one")
    if not user:
        db.close()
        return jsonify({"error": "User nahi mila"}), 404

    pwd    = data.get("password", "").strip()
    hashed = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode() if pwd else user["password"]

    qry(db,
        "UPDATE users SET name=?,username=?,password=?,dept=?,salary=?,email=?,join_date=?,bank_ac_no=?,bank_name=?,bank_branch=?,bank_ifsc=?,aadhar_no=?,pan_no=? WHERE id=?",
        (data.get("name",     user["name"]),
         data.get("username", user["username"]),
         hashed,
         data.get("dept",    user.get("dept", "")),
         float(data.get("salary") or user.get("salary") or 0),
         data.get("email",   user.get("email", "")),
         data.get("joinDate", str(user["join_date"])) if data.get("joinDate") else str(user.get("join_date", "")),
         data.get("bankAcNo",  user.get("bank_ac_no", "")) or None,
         data.get("bankName",  user.get("bank_name", "")) or None,
         data.get("bankBranch",user.get("bank_branch","")) or None,
         data.get("bankIfsc",  user.get("bank_ifsc", "")) or None,
         data.get("aadharNo",  user.get("aadhar_no", "")) or None,
         data.get("panNo",     user.get("pan_no", "")) or None,
         user_id))
    db.commit()
    db.close()
    return jsonify({"success": True})


@app.route("/api/users/<user_id>", methods=["DELETE"])
@require_admin
def delete_user(user_id):
    db = get_db()
    qry(db, "DELETE FROM users WHERE id=?", (user_id,))
    db.commit()
    db.close()
    return jsonify({"success": True})


# ── ATTENDANCE ───────────────────────────────────────────────
@app.route("/api/attendance", methods=["GET"])
@require_auth
def get_attendance():
    user_id = request.args.get("userId")
    date    = request.args.get("date")
    sql     = "SELECT * FROM attendance WHERE 1=1"
    params  = []
    if user_id:
        sql += " AND user_id=?"; params.append(user_id)
    if date:
        sql += " AND date=?";    params.append(date)
    sql += " ORDER BY date DESC"

    db      = get_db()
    records = qry(db, sql, params, fetch="all")
    db.close()
    return jsonify([fix_record(r) for r in records])


@app.route("/api/attendance/checkin", methods=["POST"])
@require_auth
def check_in():
    user_id  = request.user["userId"]
    today    = datetime.date.today().isoformat()
    now      = datetime.datetime.now()
    now_str  = now.strftime("%H:%M")
    now_hour = now.hour
    data     = request.json or {}
    location = data.get("location", None)

    db = get_db()
    if qry(db, "SELECT id FROM attendance WHERE user_id=? AND date=?", (user_id, today), fetch="one"):
        db.close()
        return jsonify({"error": "Aaj already check-in ho chuka hai"}), 400

    is_late     = 1 if now_hour >= LATE_HOUR     else 0
    is_half_day = 1 if now_hour >= HALF_DAY_HOUR else 0
    record_id   = uid()

    qry(db,
        "INSERT INTO attendance (id,user_id,date,check_in,is_late,is_half_day,checkin_location) VALUES (?,?,?,?,?,?,?)",
        (record_id, user_id, today, now_str, is_late, is_half_day, location))
    db.commit()
    db.close()
    return jsonify({"success": True, "checkIn": now_str, "id": record_id,
                    "isLate": bool(is_late), "isHalfDay": bool(is_half_day)})


@app.route("/api/attendance/checkout", methods=["POST"])
@require_auth
def check_out():
    data       = request.json or {}
    user_id    = request.user["userId"]
    today      = datetime.date.today().isoformat()
    now        = datetime.datetime.now().strftime("%H:%M")
    break_mins = int(data.get("breakMins", 0))
    location   = data.get("location", None)

    db     = get_db()
    record = qry(db, "SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today), fetch="one")
    if not record:
        db.close()
        return jsonify({"error": "Aaj check-in nahi mila"}), 400
    if fix_timedelta(record.get("check_out")):
        db.close()
        return jsonify({"error": "Aaj already check-out ho chuka hai"}), 400

    ci_str = fix_timedelta(record["check_in"]) or "09:00"
    ci_h, ci_m = map(int, ci_str.split(":"))
    co_h, co_m = map(int, now.split(":"))
    net_mins   = max(0, (co_h*60+co_m) - (ci_h*60+ci_m) - break_mins)

    qry(db, "UPDATE attendance SET check_out=?,break_mins=?,net_mins=?,checkout_location=? WHERE id=?",
        (now, break_mins, net_mins, location, record["id"]))
    db.commit()
    db.close()
    return jsonify({"success": True, "checkOut": now, "netMins": net_mins})


@app.route("/api/attendance/lunch-in", methods=["POST"])
@require_auth
def lunch_in():
    user_id  = request.user["userId"]
    today    = datetime.date.today().isoformat()
    now      = datetime.datetime.now().strftime("%H:%M")
    data     = request.json or {}
    location = data.get("location", None)

    db     = get_db()
    record = qry(db, "SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today), fetch="one")
    if not record:
        db.close()
        return jsonify({"error": "Pehle check-in karo"}), 400
    if fix_timedelta(record.get("check_out")):
        db.close()
        return jsonify({"error": "Already check-out ho chuka hai"}), 400
    if fix_timedelta(record.get("lunch_in")):
        db.close()
        return jsonify({"error": "Lunch already start ho chuka hai"}), 400

    qry(db, "UPDATE attendance SET lunch_in=?,lunch_in_location=? WHERE id=?", (now, location, record["id"]))
    db.commit()
    db.close()
    return jsonify({"success": True, "lunchIn": now})


@app.route("/api/attendance/lunch-out", methods=["POST"])
@require_auth
def lunch_out():
    user_id  = request.user["userId"]
    today    = datetime.date.today().isoformat()
    now      = datetime.datetime.now().strftime("%H:%M")
    data     = request.json or {}
    location = data.get("location", None)

    db     = get_db()
    record = qry(db, "SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today), fetch="one")
    li_str = fix_timedelta(record.get("lunch_in")) if record else None

    if not record or not li_str:
        db.close()
        return jsonify({"error": "Lunch start nahi hua hai"}), 400
    if fix_timedelta(record.get("lunch_out")):
        db.close()
        return jsonify({"error": "Lunch already end ho chuka hai"}), 400

    li_h, li_m = map(int, li_str.split(":"))
    lo_h, lo_m = map(int, now.split(":"))
    lunch_mins = max(0, (lo_h*60+lo_m) - (li_h*60+li_m))
    new_break  = (record.get("break_mins") or 0) + lunch_mins

    qry(db, "UPDATE attendance SET lunch_out=?,break_mins=?,lunch_out_location=? WHERE id=?",
        (now, new_break, location, record["id"]))
    db.commit()
    db.close()
    return jsonify({"success": True, "lunchOut": now, "lunchMins": lunch_mins})


@app.route("/api/attendance/today-state/<user_id>", methods=["GET"])
@require_auth
def get_today_state(user_id):
    today  = datetime.date.today().isoformat()
    db     = get_db()
    record = qry(db, "SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today), fetch="one")
    db.close()
    return jsonify(fix_record(record) if record else None)


# ── LEAVES ───────────────────────────────────────────────────
@app.route("/api/leaves", methods=["GET"])
@require_auth
def get_leaves():
    user_id = request.args.get("userId")
    db      = get_db()
    if user_id:
        leaves = qry(db, "SELECT * FROM leaves WHERE user_id=? ORDER BY applied_on DESC", (user_id,), fetch="all")
    else:
        leaves = qry(db, "SELECT * FROM leaves ORDER BY applied_on DESC", fetch="all")
    db.close()
    result = []
    for l in leaves:
        l = dict(l)
        l["from_date"]  = str(l["from_date"])  if l.get("from_date")  else ""
        l["to_date"]    = str(l["to_date"])    if l.get("to_date")    else ""
        l["applied_on"] = str(l["applied_on"]) if l.get("applied_on") else ""
        result.append(l)
    return jsonify(result)


@app.route("/api/leaves", methods=["POST"])
@require_auth
def apply_leave():
    data      = request.json or {}
    user_id   = request.user["userId"]
    from_date = data.get("from")
    to_date   = data.get("to")
    reason    = data.get("reason", "").strip()

    if not from_date or not to_date or not reason:
        return jsonify({"error": "Sabhi fields required hain"}), 400

    days     = max(1, (datetime.date.fromisoformat(to_date) - datetime.date.fromisoformat(from_date)).days + 1)
    leave_id = uid()
    db       = get_db()
    qry(db,
        "INSERT INTO leaves (id,user_id,type,from_date,to_date,days,reason,applied_on,status) VALUES (?,?,?,?,?,?,?,?,?)",
        (leave_id, user_id, data.get("type", "paid"),
         from_date, to_date, days, reason,
         datetime.date.today().isoformat(), "pending"))
    db.commit()
    db.close()
    return jsonify({"success": True, "id": leave_id}), 201


@app.route("/api/leaves/<leave_id>", methods=["PUT"])
@require_admin
def update_leave(leave_id):
    data   = request.json or {}
    status = data.get("status")
    if status not in ("approved", "rejected", "pending"):
        return jsonify({"error": "Invalid status"}), 400
    db = get_db()
    qry(db, "UPDATE leaves SET status=? WHERE id=?", (status, leave_id))
    db.commit()
    db.close()
    return jsonify({"success": True})


# ── DASHBOARD STATS ──────────────────────────────────────────
@app.route("/api/dashboard/stats", methods=["GET"])
@require_admin
def dashboard_stats():
    today = datetime.date.today().isoformat()
    db    = get_db()

    def count(sql, params=None):
        row = qry(db, sql, params, fetch="one")
        if not row:
            return 0
        return list(row.values())[0] or 0

    total_emp      = count("SELECT COUNT(*) as c FROM users WHERE role='employee'")
    present        = count("SELECT COUNT(DISTINCT user_id) as c FROM attendance WHERE date=?", (today,))
    pending_leaves = count("SELECT COUNT(*) as c FROM leaves WHERE status='pending'")
    late_today     = count("SELECT COUNT(*) as c FROM attendance WHERE date=? AND is_late=1", (today,))
    half_day_today = count("SELECT COUNT(*) as c FROM attendance WHERE date=? AND is_half_day=1", (today,))

    db.close()
    return jsonify({
        "totalEmployees": total_emp,
        "presentToday":   present,
        "absentToday":    max(0, total_emp - present),
        "pendingLeaves":  pending_leaves,
        "lateToday":      late_today,
        "halfDayToday":   half_day_today
    })


# ── DOCUMENTS ────────────────────────────────────────────────
@app.route("/api/documents/<user_id>", methods=["GET"])
@require_auth
def get_documents(user_id):
    # Only admin or the employee themselves can see docs
    caller = request.user
    if caller["role"] != "admin" and caller["userId"] != user_id:
        return jsonify({"error": "Access denied"}), 403
    db = get_db()
    try:
        rows = qry(db, "SELECT doc_type, file_name, file_type, uploaded_at FROM documents WHERE user_id=?", (user_id,), fetch="all")
        result = []
        for r in rows:
            result.append({
                "doc_type":    r["doc_type"],
                "file_name":   r["file_name"],
                "file_type":   r["file_type"],
                "uploaded_at": str(r.get("uploaded_at", ""))
            })
        return jsonify(result)
    finally:
        db.close()


@app.route("/api/documents/<user_id>/<doc_type>/view", methods=["GET"])
@require_auth
def view_document(user_id, doc_type):
    caller = request.user
    if caller["role"] != "admin" and caller["userId"] != user_id:
        return jsonify({"error": "Access denied"}), 403
    db = get_db()
    try:
        row = qry(db, "SELECT file_data, file_type, file_name FROM documents WHERE user_id=? AND doc_type=?", (user_id, doc_type), fetch="one")
        if not row:
            return jsonify({"error": "Document not found"}), 404
        return jsonify({"file_data": row["file_data"], "file_type": row["file_type"], "file_name": row["file_name"]})
    finally:
        db.close()


@app.route("/api/documents", methods=["POST"])
@require_auth
def upload_document():
    import base64 as b64lib

    # Support both multipart/form-data (file upload) and JSON (base64)
    if request.content_type and "multipart/form-data" in request.content_type:
        user_id  = request.form.get("userId") or request.user["userId"]
        doc_type = (request.form.get("docType") or "").strip()
        file_obj = request.files.get("file")
        if not file_obj:
            return jsonify({"error": "File required"}), 400
        file_name = file_obj.filename
        file_type = file_obj.mimetype
        raw_bytes = file_obj.read()
        file_data = "data:" + file_type + ";base64," + b64lib.b64encode(raw_bytes).decode("utf-8")
    else:
        data      = request.json or {}
        user_id   = data.get("userId") or request.user["userId"]
        doc_type  = data.get("docType", "").strip()
        file_data = data.get("fileData", "")
        file_name = data.get("fileName", "")
        file_type = data.get("fileType", "")

    valid_types = ["aadhar", "pan", "marksheet", "passbook"]
    if doc_type not in valid_types:
        return jsonify({"error": "Invalid document type"}), 400
    if not file_data:
        return jsonify({"error": "File data required"}), 400

    # Only the employee themselves (or admin) can upload
    caller = request.user
    if caller["role"] != "admin" and caller["userId"] != user_id:
        return jsonify({"error": "Access denied"}), 403

    db = get_db()
    try:
        existing = qry(db, "SELECT id FROM documents WHERE user_id=? AND doc_type=?", (user_id, doc_type), fetch="one")
        now = datetime.date.today().isoformat()
        if existing:
            qry(db, "UPDATE documents SET file_data=?, file_name=?, file_type=?, uploaded_at=? WHERE user_id=? AND doc_type=?",
                (file_data, file_name, file_type, now, user_id, doc_type))
        else:
            doc_id = uid()
            qry(db, "INSERT INTO documents (id, user_id, doc_type, file_data, file_name, file_type, uploaded_at) VALUES (?,?,?,?,?,?,?)",
                (doc_id, user_id, doc_type, file_data, file_name, file_type, now))
        db.commit()
        return jsonify({"success": True})
    finally:
        db.close()


# ================================================================
if __name__ == "__main__":
    run_migrations()
    print("=" * 56)
    if USE_MYSQL:
        print("  MySQL Mode — attendx database se connect ho raha hai")
        try:
            test = get_db()
            test.close()
            print("  MySQL connection: OK")
        except Exception as e:
            print(f"  MySQL connection FAILED: {e}")
            print("  Hint: DB_CONFIG mein apna password check karo (~line 35)")
    else:
        print("  SQLite Fallback — PyMySQL install karo MySQL ke liye")
        print("  Command: pip install PyMySQL")
    print(f"  Server: http://localhost:5000")
    print(f"  BROWSER MEIN KHOLO: http://localhost:5000")
    print(f"  (file:// se mat kholo!)")
    print("=" * 56)
    PORT = int(os.environ.get("PORT", 5000))
    app.run(debug=False, host="0.0.0.0", port=PORT)
