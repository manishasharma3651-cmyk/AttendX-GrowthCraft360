# AttendX — Attendance Management System
## (Flask + MySQL Backend)

---

## Project Structure

```
AttendX-Updated/
├── backend/
│   ├── app.py               ← Flask server (MySQL version)
│   └── app_sqlite_backup.py ← Purana SQLite wala (backup)
├── frontend/
│   ├── index.html
│   ├── admin.html
│   ├── employee.html
│   ├── css/
│   └── js/
├── attendx_mysql.sql        ← MySQL schema + sample data
├── start.bat
└── start.sh
```

---

## Setup (MySQL)

### Step 1 — MySQL database banao
```sql
CREATE DATABASE attendx;
```
Ya phpmyadmin se "attendx" naam ka database banao.

### Step 2 — SQL import karo
phpmyadmin se `attendx_mysql.sql` import karo.

### Step 3 — Password fill karo
`backend/app.py` file kholao, line ~35 par:
```python
"password": "YOUR_MYSQL_PASSWORD",  # <-- Apna password yahan
```

### Step 4 — Dependencies install karo
```bash
pip install flask flask-cors pyjwt bcrypt PyMySQL
```

### Step 5 — Server start karo
```bash
cd backend
python app.py
```
Server: http://localhost:5000

### Step 6 — Frontend kholao
`frontend/index.html` browser mein kholao.

---

## Default Login Credentials

| Role     | Username | Password   |
|----------|----------|------------|
| Admin    | admin    | admin123   |
| Employee | john     | pass123    |
| Employee | priya    | pass123    |
| Employee | rahul    | pass123    |
| Employee | anjali   | pass123    |
| Employee | manisha  | manisha01  |

---

## API Endpoints

| Method | Path                            | Description        |
|--------|---------------------------------|--------------------|
| POST   | /api/login                      | Login              |
| GET    | /api/users                      | Get all users      |
| POST   | /api/users                      | Add employee       |
| PUT    | /api/users/:id                  | Update employee    |
| DELETE | /api/users/:id                  | Delete employee    |
| GET    | /api/attendance                 | Get attendance     |
| POST   | /api/attendance/checkin         | Check in           |
| POST   | /api/attendance/checkout        | Check out          |
| GET    | /api/attendance/today-state/:id | Today record       |
| GET    | /api/leaves                     | Get leaves         |
| POST   | /api/leaves                     | Apply leave        |
| PUT    | /api/leaves/:id                 | Approve/Reject     |
| GET    | /api/dashboard/stats            | Dashboard stats    |
