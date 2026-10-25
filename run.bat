@echo off
cd /d "%~dp0"
echo Installing Flask (first time only)...
python -m pip install -r requirements.txt
echo.
echo Starting SkyBite. Open http://localhost:5000 in your browser.
echo Staff page: http://localhost:5000/staff
echo.
python app.py
pause
