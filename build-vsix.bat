@echo off
setlocal enabledelayedexpansion

echo ========================================
echo VSCode拡張機能のVSIXパッケージを作成します
echo ========================================
echo.

REM 依存関係のインストール確認
echo [1/4] 依存関係を確認しています...
if not exist "node_modules" (
    echo 依存関係をインストールします...
    call npm install
    if errorlevel 1 (
        echo エラー: npm installが失敗しました
        pause
        exit /b 1
    )
) else (
    echo 依存関係は既にインストールされています
)
echo.

REM TypeScriptのコンパイル
echo [2/4] TypeScriptをコンパイルしています...
call npm run compile
if errorlevel 1 (
    echo エラー: コンパイルが失敗しました
    pause
    exit /b 1
)
echo コンパイルが完了しました
echo.

rem REM vsceがインストールされているか確認
rem echo [3/4] vsceを確認しています...
rem call npx vsce --version >nul 2>&1
rem if errorlevel 1 (
rem     echo vsceがインストールされていません。インストールします...
rem     call npm install -g @vscode/vsce
rem     if errorlevel 1 (
rem         echo エラー: vsceのインストールが失敗しました
rem         pause
rem         exit /b 1
rem     )
rem )
rem echo.

REM VSIXパッケージの作成
echo [4/4] VSIXパッケージを作成しています...
call npx vsce package
if errorlevel 1 (
    echo エラー: VSIXパッケージの作成が失敗しました
    pause
    exit /b 1
)
echo.

echo ========================================
echo VSIXパッケージの作成が完了しました！
echo ========================================
echo.
echo 作成されたファイル:
for %%f in (*.vsix) do (
    echo   %%f
)
echo.
pause
