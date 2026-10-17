@echo off
title Sawasdee Rental Web App Server
echo ========================================================
echo   SAWASDEE RENTAL - HIGH SPEED WEB APPLICATION
echo ========================================================
echo Starting FastAPI + Uvicorn server on http://localhost:8501 ...
echo.
python -m uvicorn server:app --host 0.0.0.0 --port 8501
pause
