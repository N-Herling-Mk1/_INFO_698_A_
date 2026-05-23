@echo off
title NODES // Local Server
echo.
echo   Starting NODES local server...
echo   Editor  ^>  http://localhost:5000
echo   Viewer  ^>  http://localhost:5000/view
echo   Login   ^>  http://localhost:5000/login
echo.
python nodes_server.py
pause
