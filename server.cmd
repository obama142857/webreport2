@echo off
setlocal enabledelayedexpansion

REM ===== 配置 =====
set START_PORT=8000
set SITE_DIR=%~dp0



set PORT=%START_PORT%

:CHECK_PORT
REM 检查端口是否被占用
netstat -ano | findstr :%PORT% >nul
if %errorlevel%==0 (
    set /a PORT+=1
    goto CHECK_PORT
)


REM 切换到当前脚本所在目录
cd /d "%SITE_DIR%"

REM 启动 Python HTTP 服务（后台运行）
start "" python -m http.server %PORT%

REM 等待 1 秒让服务器启动
timeout /t 1 >nul

REM 打开浏览器访问 index.html
start "" "http://localhost:%PORT%/index.html"
