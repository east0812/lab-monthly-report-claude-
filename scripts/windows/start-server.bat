@echo off
rem 연구소 월차보고 사이트 실행 (Windows 서버 PC)
rem  - 처음 실행하거나 소스를 바꾼 뒤에는 build 를 다시 합니다.
rem  - 포트를 바꾸려면 아래 PORT 값을 수정하세요. (방화벽 인바운드 규칙도 같은 포트로)
chcp 65001 >nul
cd /d "%~dp0..\.."
if "%PORT%"=="" set PORT=3000

if not exist ".env.local" (
  echo [오류] .env.local 파일이 없습니다. .env.local.example 을 복사해 값을 채워 주세요.
  pause
  exit /b 1
)
if not exist "node_modules" (
  echo [1/3] 패키지 설치 중...
  call npm install || goto :fail
)
if not exist ".next\BUILD_ID" (
  echo [2/3] 빌드 중...
  call npm run build || goto :fail
)
echo [3/3] 서버 시작: http://(이 PC의 IP):%PORT%
call npm run start
goto :eof

:fail
echo [오류] 실행에 실패했습니다. 위 메시지를 확인해 주세요.
pause
exit /b 1
