@echo off
rem 첨부파일 원본 백업 (Windows 작업 스케줄러에 매일 등록해 사용)
rem  사용: backup.bat D:\backup\labreport
rem  - 첨부 원본: ATTACHMENT_DIR(기본 data\attachments) 폴더 전체를 날짜별 폴더로 복사
rem  - 첨부 목록과 모든 업무 데이터는 PostgreSQL(Supabase)에 있으므로 DB 백업을 함께 받아야 복원할 수 있습니다.
rem    Supabase: 대시보드 Database - Backups, 또는 PostgreSQL 클라이언트가 있으면
rem      pg_dump "%DATABASE_URL%" -Fc -f "%DEST%\db.dump"
chcp 65001 >nul
cd /d "%~dp0..\.."
if "%~1"=="" (
  echo 사용법: backup.bat ^<백업 폴더^>
  exit /b 1
)
set SRC=%ATTACHMENT_DIR%
if "%SRC%"=="" set SRC=data\attachments
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd"') do set TODAY=%%i
set DEST=%~1\%TODAY%
robocopy "%SRC%" "%DEST%\attachments" /E /R:2 /W:2 /NFL /NDL /NP
if %ERRORLEVEL% GEQ 8 (
  echo [오류] 첨부파일 백업 실패
  exit /b 1
)
echo 첨부파일 백업 완료: %DEST%\attachments
exit /b 0
