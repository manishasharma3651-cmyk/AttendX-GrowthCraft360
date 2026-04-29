@echo off
echo ============================================
echo   AttendX - Starting Backend Server...
echo ============================================
cd backend
pip install flask flask-cors pyjwt bcrypt -q
python app.py
pause
