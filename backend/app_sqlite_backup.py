"""
AttendX Backend - Flask + SQLite
Run: python app.py
Server starts at http://localhost:5000
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import sqlite3
import bcrypt
import jwt
import datetime
import os
import random
import string

app = Flask(__name__)
CORS(app, origins="*")

SECRET_KEY = "attendx_secret_key_change_in_production"
DB_PATH = os.path.join(os.path.dirname(__file__), "attendx.db")

LATE_HOUR = 11      # >= 11:00 AM → late warning
HALF_DAY_HOUR = 12  # >= 12:00 PM → half-day

def get_db():
    db = sqlite3.connect(DB_PATH)
    db.row_factory = sqlite3.Row
    return db

def uid():
    return ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))

def init_db():
    db = get_db()
    c = db.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'employee',
        dept TEXT,
        salary REAL DEFAULT 0,
        email TEXT,
        join_date TEXT
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS attendance (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        date TEXT NOT NULL,
        check_in TEXT,
        check_out TEXT,
        lunch_in TEXT,
        lunch_out TEXT,
        break_mins INTEGER DEFAULT 0,
        net_mins INTEGER DEFAULT 0,
        is_late INTEGER DEFAULT 0,
        is_half_day INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    # Migrate: add new columns if missing (for existing DBs)
    existing_cols = [row[1] for row in c.execute("PRAGMA table_info(attendance)").fetchall()]
    for col, defn in [
        ("lunch_in",    "TEXT"),
        ("lunch_out",   "TEXT"),
        ("is_late",     "INTEGER DEFAULT 0"),
        ("is_half_day", "INTEGER DEFAULT 0"),
    ]:
        if col not in existing_cols:
            c.execute(f"ALTER TABLE attendance ADD COLUMN {col} {defn}")

    c.execute("""
    CREATE TABLE IF NOT EXISTS leaves (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        from_date TEXT NOT NULL,
        to_date TEXT NOT NULL,
        days INTEGER DEFAULT 1,
        reason TEXT,
        applied_on TEXT,
        status TEXT DEFAULT 'pending',
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    c.execute("""
    CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        doc_type TEXT NOT NULL,
        file_data TEXT NOT NULL,
        file_name TEXT,
        file_type TEXT,
        uploaded_at TEXT,
        UNIQUE(user_id, doc_type),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )""")

    existing = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    if existing == 0:
        default_users = [
            ("u1", "Admin User",  "admin",  "admin123", "admin",    "Management",  80000, "admin@attendx.com",  "2022-01-01"),
            ("u2", "John Sharma", "john",   "pass123",  "employee", "Engineering", 55000, "john@attendx.com",   "2023-03-15"),
            ("u3", "Priya Patel", "priya",  "pass123",  "employee", "Design",      48000, "priya@attendx.com",  "2023-06-01"),
            ("u4", "Rahul Gupta", "rahul",  "pass123",  "employee", "Marketing",   42000, "rahul@attendx.com",  "2023-09-10"),
            ("u5", "Anjali Singh","anjali", "pass123",  "employee", "HR",          45000, "anjali@attendx.com", "2022-11-20"),
            ("u6", "Manisha Sharma","manisha","manisha01","employee","Engineering", 25000, "manishasharma3651@gmail.com", "2026-04-17"),
        ]
        for u in default_users:
            hashed = bcrypt.hashpw(u[3].encode(), bcrypt.gensalt()).decode()
            c.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)",
                      (u[0], u[1], u[2], hashed, u[4], u[5], u[6], u[7], u[8]))

        from datetime import date, timedelta
        employees = ["u2", "u3", "u4", "u5"]
        for i in range(13, 0, -1):
            d = date.today() - timedelta(days=i)
            if d.weekday() >= 5:
                continue
            date_str = d.isoformat()
            for emp_id in employees:
                if random.random() < 0.15:
                    continue
                ci_h = 8 + random.randint(0, 1)
                ci_m = random.randint(0, 29)
                work_h = 7 + random.randint(0, 2)
                co_h = min(ci_h + work_h, 20)
                co_m = random.randint(0, 29)
                break_mins = 20 + random.randint(0, 29)
                check_in  = f"{ci_h:02d}:{ci_m:02d}"
                check_out = f"{co_h:02d}:{co_m:02d}"
                li_h = ci_h + 3
                li_m = random.randint(0, 29)
                lo_h = li_h
                lo_m = li_m + random.randint(20, 40)
                if lo_m >= 60:
                    lo_h += 1
                    lo_m -= 60
                lunch_in  = f"{min(li_h,19):02d}:{li_m:02d}"
                lunch_out = f"{min(lo_h,20):02d}:{lo_m:02d}"
                ci_total = ci_h * 60 + ci_m
                co_total = co_h * 60 + co_m
                net_mins = max(0, co_total - ci_total - break_mins)
                is_late = 1 if ci_h >= LATE_HOUR else 0
                is_half_day = 1 if ci_h >= HALF_DAY_HOUR else 0
                c.execute(
                    "INSERT INTO attendance (id,user_id,date,check_in,check_out,lunch_in,lunch_out,break_mins,net_mins,is_late,is_half_day) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (uid(), emp_id, date_str, check_in, check_out, lunch_in, lunch_out, break_mins, net_mins, is_late, is_half_day)
                )

        for l in [
            ("u2","paid","2024-12-20","2024-12-22",3,"Family trip","2024-12-15","approved"),
            ("u3","sick","2025-01-05","2025-01-06",2,"Not feeling well","2025-01-05","approved"),
            ("u4","unpaid","2025-02-10","2025-02-10",1,"Personal work","2025-02-08","rejected"),
            ("u5","casual","2025-03-15","2025-03-15",1,"Personal errand","2025-03-14","pending"),
        ]:
            c.execute("INSERT INTO leaves VALUES (?,?,?,?,?,?,?,?,?)",
                      (uid(), l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]))

    db.commit()
    db.close()

def verify_token(req):
    token = req.headers.get("Authorization", "").replace("Bearer ", "")
    if not token:
        return None
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=["HS256"])
    except:
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

# ── AUTH ──
@app.route("/api/login", methods=["POST"])
def login():
    data = request.json
    username = data.get("username","").strip()
    password = data.get("password","").strip()
    role = data.get("role","")
    if not username or not password:
        return jsonify({"error": "Username and password required"}), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    db.close()
    if not user:
        return jsonify({"error": "Invalid username or password"}), 401
    try:
        ok = bcrypt.checkpw(password.encode(), user["password"].encode())
    except:
        ok = password == user["password"]
    if not ok:
        return jsonify({"error": "Invalid username or password"}), 401
    if user["role"] != role:
        return jsonify({"error": f"This account is not a {role}."}), 401
    token = jwt.encode({
        "userId": user["id"], "role": user["role"], "name": user["name"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(days=7)
    }, SECRET_KEY, algorithm="HS256")
    return jsonify({"token": token, "user": {
        "id": user["id"], "name": user["name"], "username": user["username"],
        "role": user["role"], "dept": user["dept"], "salary": user["salary"],
        "email": user["email"], "joinDate": user["join_date"]
    }})

# ── USERS ──
@app.route("/api/users", methods=["GET"])
@require_auth
def get_users():
    db = get_db()
    users = db.execute("SELECT id,name,username,role,dept,salary,email,join_date FROM users").fetchall()
    db.close()
    return jsonify([dict(u) for u in users])

@app.route("/api/users", methods=["POST"])
@require_admin
def add_user():
    data = request.json
    name = data.get("name","").strip()
    username = data.get("username","").strip()
    password = data.get("password","").strip()
    if not name or not username or not password:
        return jsonify({"error": "Name, username and password required"}), 400
    db = get_db()
    if db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone():
        db.close()
        return jsonify({"error": "Username already exists"}), 400
    hashed = bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    new_id = uid()
    db.execute("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?)",
               (new_id, name, username, hashed, "employee",
                data.get("dept",""), data.get("salary",0),
                data.get("email",""), data.get("joinDate","")))
    db.commit(); db.close()
    return jsonify({"success": True, "id": new_id}), 201

@app.route("/api/users/<user_id>", methods=["PUT"])
@require_admin
def update_user(user_id):
    data = request.json
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE id=?", (user_id,)).fetchone()
    if not user:
        db.close()
        return jsonify({"error": "User not found"}), 404
    pwd = data.get("password","").strip()
    hashed = bcrypt.hashpw(pwd.encode(), bcrypt.gensalt()).decode() if pwd else user["password"]
    db.execute("UPDATE users SET name=?,username=?,password=?,dept=?,salary=?,email=?,join_date=? WHERE id=?",
               (data.get("name",user["name"]), data.get("username",user["username"]), hashed,
                data.get("dept",user["dept"]), data.get("salary",user["salary"]),
                data.get("email",user["email"]), data.get("joinDate",user["join_date"]), user_id))
    db.commit(); db.close()
    return jsonify({"success": True})

@app.route("/api/users/<user_id>", methods=["DELETE"])
@require_admin
def delete_user(user_id):
    db = get_db()
    db.execute("DELETE FROM users WHERE id=?", (user_id,))
    db.commit(); db.close()
    return jsonify({"success": True})

# ── ATTENDANCE ──
@app.route("/api/attendance", methods=["GET"])
@require_auth
def get_attendance():
    user_id = request.args.get("userId")
    date = request.args.get("date")
    db = get_db()
    q = "SELECT * FROM attendance WHERE 1=1"
    params = []
    if user_id: q += " AND user_id=?"; params.append(user_id)
    if date:    q += " AND date=?";    params.append(date)
    q += " ORDER BY date DESC"
    records = db.execute(q, params).fetchall()
    db.close()
    return jsonify([dict(r) for r in records])

@app.route("/api/attendance/checkin", methods=["POST"])
@require_auth
def check_in():
    user_id = request.user["userId"]
    today = datetime.date.today().isoformat()
    now = datetime.datetime.now()
    now_str = now.strftime("%H:%M")
    now_hour = now.hour

    db = get_db()
    if db.execute("SELECT id FROM attendance WHERE user_id=? AND date=?", (user_id, today)).fetchone():
        db.close()
        return jsonify({"error": "Already checked in today"}), 400

    is_late     = 1 if now_hour >= LATE_HOUR else 0
    is_half_day = 1 if now_hour >= HALF_DAY_HOUR else 0

    record_id = uid()
    db.execute(
        "INSERT INTO attendance (id,user_id,date,check_in,is_late,is_half_day) VALUES (?,?,?,?,?,?)",
        (record_id, user_id, today, now_str, is_late, is_half_day)
    )
    db.commit(); db.close()
    return jsonify({"success": True, "checkIn": now_str, "id": record_id,
                    "isLate": bool(is_late), "isHalfDay": bool(is_half_day)})

@app.route("/api/attendance/checkout", methods=["POST"])
@require_auth
def check_out():
    data = request.json or {}
    user_id = request.user["userId"]
    today = datetime.date.today().isoformat()
    now = datetime.datetime.now().strftime("%H:%M")
    break_mins = int(data.get("breakMins", 0))

    db = get_db()
    record = db.execute("SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today)).fetchone()
    if not record:
        db.close()
        return jsonify({"error": "No check-in found for today"}), 400
    if record["check_out"]:
        db.close()
        return jsonify({"error": "Already checked out today"}), 400

    ci_h, ci_m = map(int, record["check_in"].split(":"))
    co_h, co_m = map(int, now.split(":"))
    net_mins = max(0, (co_h*60+co_m) - (ci_h*60+ci_m) - break_mins)
    db.execute("UPDATE attendance SET check_out=?,break_mins=?,net_mins=? WHERE id=?",
               (now, break_mins, net_mins, record["id"]))
    db.commit(); db.close()
    return jsonify({"success": True, "checkOut": now, "netMins": net_mins})

@app.route("/api/attendance/lunch-in", methods=["POST"])
@require_auth
def lunch_in():
    user_id = request.user["userId"]
    today = datetime.date.today().isoformat()
    now = datetime.datetime.now().strftime("%H:%M")

    db = get_db()
    record = db.execute("SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today)).fetchone()
    if not record:
        db.close()
        return jsonify({"error": "Check in first"}), 400
    if record["check_out"]:
        db.close()
        return jsonify({"error": "Already checked out"}), 400
    if record["lunch_in"]:
        db.close()
        return jsonify({"error": "Lunch already started"}), 400

    db.execute("UPDATE attendance SET lunch_in=? WHERE id=?", (now, record["id"]))
    db.commit(); db.close()
    return jsonify({"success": True, "lunchIn": now})

@app.route("/api/attendance/lunch-out", methods=["POST"])
@require_auth
def lunch_out():
    user_id = request.user["userId"]
    today = datetime.date.today().isoformat()
    now = datetime.datetime.now().strftime("%H:%M")

    db = get_db()
    record = db.execute("SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today)).fetchone()
    if not record or not record["lunch_in"]:
        db.close()
        return jsonify({"error": "Lunch not started"}), 400
    if record["lunch_out"]:
        db.close()
        return jsonify({"error": "Lunch already ended"}), 400

    li_h, li_m = map(int, record["lunch_in"].split(":"))
    lo_h, lo_m = map(int, now.split(":"))
    lunch_mins = max(0, (lo_h*60+lo_m) - (li_h*60+li_m))
    new_break = (record["break_mins"] or 0) + lunch_mins

    db.execute("UPDATE attendance SET lunch_out=?,break_mins=? WHERE id=?",
               (now, new_break, record["id"]))
    db.commit(); db.close()
    return jsonify({"success": True, "lunchOut": now, "lunchMins": lunch_mins})

@app.route("/api/attendance/today-state/<user_id>", methods=["GET"])
@require_auth
def get_today_state(user_id):
    today = datetime.date.today().isoformat()
    db = get_db()
    record = db.execute("SELECT * FROM attendance WHERE user_id=? AND date=?", (user_id, today)).fetchone()
    db.close()
    return jsonify(dict(record) if record else None)

# ── LEAVES ──
@app.route("/api/leaves", methods=["GET"])
@require_auth
def get_leaves():
    user_id = request.args.get("userId")
    db = get_db()
    if user_id:
        leaves = db.execute("SELECT * FROM leaves WHERE user_id=? ORDER BY applied_on DESC", (user_id,)).fetchall()
    else:
        leaves = db.execute("SELECT * FROM leaves ORDER BY applied_on DESC").fetchall()
    db.close()
    return jsonify([dict(l) for l in leaves])

@app.route("/api/leaves", methods=["POST"])
@require_auth
def apply_leave():
    data = request.json
    user_id = request.user["userId"]
    from_date = data.get("from"); to_date = data.get("to"); reason = data.get("reason","").strip()
    if not from_date or not to_date or not reason:
        return jsonify({"error": "All fields required"}), 400
    from datetime import date
    days = max(1, (date.fromisoformat(to_date) - date.fromisoformat(from_date)).days + 1)
    leave_id = uid()
    db = get_db()
    db.execute("INSERT INTO leaves VALUES (?,?,?,?,?,?,?,?,?)",
               (leave_id, user_id, data.get("type","paid"), from_date, to_date,
                days, reason, datetime.date.today().isoformat(), "pending"))
    db.commit(); db.close()
    return jsonify({"success": True, "id": leave_id}), 201

@app.route("/api/leaves/<leave_id>", methods=["PUT"])
@require_admin
def update_leave(leave_id):
    data = request.json
    status = data.get("status")
    if status not in ("approved","rejected","pending"):
        return jsonify({"error": "Invalid status"}), 400
    db = get_db()
    db.execute("UPDATE leaves SET status=? WHERE id=?", (status, leave_id))
    db.commit(); db.close()
    return jsonify({"success": True})

# ── DASHBOARD STATS ──
@app.route("/api/dashboard/stats", methods=["GET"])
@require_admin
def dashboard_stats():
    today = datetime.date.today().isoformat()
    db = get_db()
    total_emp      = db.execute("SELECT COUNT(*) FROM users WHERE role='employee'").fetchone()[0]
    present        = db.execute("SELECT COUNT(DISTINCT user_id) FROM attendance WHERE date=?", (today,)).fetchone()[0]
    pending_leaves = db.execute("SELECT COUNT(*) FROM leaves WHERE status='pending'").fetchone()[0]
    late_today     = db.execute("SELECT COUNT(*) FROM attendance WHERE date=? AND is_late=1", (today,)).fetchone()[0]
    half_day_today = db.execute("SELECT COUNT(*) FROM attendance WHERE date=? AND is_half_day=1", (today,)).fetchone()[0]
    db.close()
    return jsonify({
        "totalEmployees": total_emp,
        "presentToday": present,
        "absentToday": total_emp - present,
        "pendingLeaves": pending_leaves,
        "lateToday": late_today,
        "halfDayToday": half_day_today
    })

# ── DOCUMENTS ──
@app.route("/api/documents/<user_id>", methods=["GET"])
@require_auth
def get_documents(user_id):
    caller = request.user
    if caller["role"] != "admin" and caller["userId"] != user_id:
        return jsonify({"error": "Access denied"}), 403
    db = get_db()
    rows = db.execute("SELECT doc_type, file_name, file_type, uploaded_at, file_data FROM documents WHERE user_id=?", (user_id,)).fetchall()
    db.close()
    result = [{"doc_type": r["doc_type"], "file_name": r["file_name"], "file_type": r["file_type"],
               "uploaded_at": str(r["uploaded_at"] or ""), "file_data": r["file_data"]} for r in rows]
    return jsonify(result)

@app.route("/api/documents", methods=["POST"])
@require_auth
def upload_document():
    data = request.json or {}
    user_id = data.get("userId") or request.user["userId"]
    doc_type = data.get("docType", "").strip()
    file_data = data.get("fileData", "")
    file_name = data.get("fileName", "")
    file_type = data.get("fileType", "")
    valid_types = ["aadhar", "pan", "marksheet", "passbook"]
    if doc_type not in valid_types:
        return jsonify({"error": "Invalid document type"}), 400
    if not file_data:
        return jsonify({"error": "File data required"}), 400
    caller = request.user
    if caller["role"] != "admin" and caller["userId"] != user_id:
        return jsonify({"error": "Access denied"}), 403
    db = get_db()
    now = datetime.date.today().isoformat()
    existing = db.execute("SELECT id FROM documents WHERE user_id=? AND doc_type=?", (user_id, doc_type)).fetchone()
    if existing:
        db.execute("UPDATE documents SET file_data=?, file_name=?, file_type=?, uploaded_at=? WHERE user_id=? AND doc_type=?",
                   (file_data, file_name, file_type, now, user_id, doc_type))
    else:
        import random, string
        doc_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
        db.execute("INSERT INTO documents (id, user_id, doc_type, file_data, file_name, file_type, uploaded_at) VALUES (?,?,?,?,?,?,?)",
                   (doc_id, user_id, doc_type, file_data, file_name, file_type, now))
    db.commit(); db.close()
    return jsonify({"success": True})

if __name__ == "__main__":
    init_db()
    print("=" * 50)
    print("  AttendX Backend running at http://localhost:5000")
    print("=" * 50)
    app.run(debug=True, port=5000)
