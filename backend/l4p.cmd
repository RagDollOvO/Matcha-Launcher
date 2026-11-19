@echo off
setlocal
if defined L4P_NODE (
  "%L4P_NODE%" "%~dp0cli.mjs" %*
) else (
  node "%~dp0cli.mjs" %*
)
exit /b %errorlevel%
