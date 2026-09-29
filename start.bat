@echo off
if exist "%~dp0Hackathon_demo_project1-main" (
    cd /d "%~dp0Hackathon_demo_project1-main"
) else (
    cd /d "%~dp0"
)
echo Starting MemOS Agent backend server on http://127.0.0.1:8000 ...
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
pause
