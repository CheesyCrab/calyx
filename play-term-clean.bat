@echo off
rem Best effort for classic Console Host; Windows Terminal may ignore this hint.
mode con cols=320 lines=120 >nul 2>&1
call "%~dp0_run-catalog.bat" play-term --term-scale clean %*
