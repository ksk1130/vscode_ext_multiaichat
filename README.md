# Multi AI Chat - VS Code Extension

VS Codeで複数のAIプロバイダー（OpenAI / Gemini）とチャットできる拡張機能のサンプルです。

## 機能

- VS Code内でAIとチャットできるWebviewパネル
- OpenAI / Gemini APIを使用したリアルタイムのメッセージ送受信
- シンプルで使いやすいUI

## セットアップ

### 1. OpenAI API Keyの取得

1. [OpenAI Platform](https://platform.openai.com/)にアクセス
2. アカウントを作成してログイン
3. API Keysセクションで新しいAPIキーを作成

### 2. API Keyの設定

1. VS Codeの設定を開く（`Ctrl+,` または `Cmd+,`）
2. "Multi AI Chat" を検索
3. "Api Key" 欄にOpenAI API Keyを入力

または、`settings.json`に直接追加:

```json
{
  "multiai-chat.apiKey": "sk-your-api-key-here"
}
```

## 使い方

1. コマンドパレット（`Ctrl+Shift+P` または `Cmd+Shift+P`）を開く
2. "Multi AI Chat: チャットウィンドウを開く" を実行
3. チャットパネルが開いたら、メッセージを入力して送信

## Extension Settings

この拡張機能は以下の設定を提供します:

* `multiai-chat.apiKey`: OpenAI API Key
* `multiai-chat.geminiApiKey`: Gemini API Key
* `multiai-chat.geminiCustomUrl`: Gemini 完全URL（例: https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent または :streamGenerateContent?alt=sse）

## 技術スタック

- TypeScript
- VS Code Extension API
- OpenAI API (openai npm package)
- Webview API

## 開発

### ビルド

```bash
npm install
npm run compile
```

### デバッグ

1. VS Codeでこのプロジェクトを開く
2. F5キーを押して拡張機能開発ホストを起動
3. 新しいウィンドウでコマンドパレットから "ChatGPT: Open Chat" を実行

## 注意事項

- OpenAI APIの使用には料金が発生する場合があります
- API Keyは安全に管理してください
- このサンプルはgpt-3.5-turboモデルを使用しています

## Known Issues

Calling out known issues can help limit users opening duplicate issues against your extension.

## Release Notes

Users appreciate release notes as you update your extension.

### 1.0.0

Initial release of ...

### 1.0.1

Fixed issue #.

### 1.1.0

Added features X, Y, and Z.

---

## Following extension guidelines

Ensure that you've read through the extensions guidelines and follow the best practices for creating your extension.

* [Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)

## Working with Markdown

You can author your README using Visual Studio Code. Here are some useful editor keyboard shortcuts:

* Split the editor (`Cmd+\` on macOS or `Ctrl+\` on Windows and Linux).
* Toggle preview (`Shift+Cmd+V` on macOS or `Shift+Ctrl+V` on Windows and Linux).
* Press `Ctrl+Space` (Windows, Linux, macOS) to see a list of Markdown snippets.

## For more information

* [Visual Studio Code's Markdown Support](http://code.visualstudio.com/docs/languages/markdown)
* [Markdown Syntax Reference](https://help.github.com/articles/markdown-basics/)

**Enjoy!**
