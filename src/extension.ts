import * as vscode from 'vscode';

/**
 * 拡張機能が有効化される時に呼ばれるメイン関数
 * Multi AI チャットを開くコマンドを登録します
 * 
 * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト
 */
export function activate(context: vscode.ExtensionContext) {
	console.log('Multi AI Chat extension is now active!');

	let currentPanel: vscode.WebviewPanel | undefined = undefined;

	// チャットパネルを開くコマンド
	const openChatCommand = vscode.commands.registerCommand('multiai-chat.openChat', () => {
		console.log('Opening Multi AI Chat panel...');
		vscode.window.showInformationMessage('Multi AI Chat panel opening...');
		
		if (currentPanel) {
			currentPanel.reveal(vscode.ViewColumn.One);
		} else {
			const panel = vscode.window.createWebviewPanel(
				'chatgptChat',
				'Multi AI Chat',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);

			currentPanel = panel;
			console.log('Panel created successfully');
			panel.webview.html = getWebviewContent();

			// チャット履歴を読み込んで、Webviewに送信
			const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
			console.log('[DEBUG] Loading chat history, count:', chatHistory.length);
			for (const msg of chatHistory) {
				panel.webview.postMessage({
					type: 'restoreMessage',
					text: msg.text,
					isUser: msg.isUser
				});
			}

			// Webview からのメッセージを処理
			panel.webview.onDidReceiveMessage(
				async message => {
					if (message.type === 'sendMessage') {
						await handleChatMessage(panel.webview, message.text, context);
					} else if (message.type === 'clearHistory') {
						// VS Code API で確認ダイアログを表示
						const result = await vscode.window.showWarningMessage(
							'チャット履歴を削除してもよろしいですか？',
							{ modal: true },
							'削除',
							'キャンセル'
						);
						if (result === '削除') {
							console.log('[DEBUG] Before clear:', context.globalState.get('chatHistory'));
							await context.globalState.update('chatHistory', []);
							console.log('[DEBUG] After clear:', context.globalState.get('chatHistory'));
							panel.webview.postMessage({ type: 'historyCleared' });
							vscode.window.showInformationMessage('履歴を削除しました');
						}
					}
				},
				undefined,
				context.subscriptions
			);

			panel.onDidDispose(
				() => {
					currentPanel = undefined;
				},
				null,
				context.subscriptions
			);
		}
	});

	// 選択テキストをチャットに送信するコマンド
	const sendSelectionCommand = vscode.commands.registerCommand('multiai-chat.sendSelection', () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('テキストが選択されていません。');
			return;
		}

		const selection = editor.selection;
		const selectedText = editor.document.getText(selection);

		if (!selectedText) {
			vscode.window.showErrorMessage('テキストが選択されていません。');
			return;
		}

		// チャットパネルが開いていなければ開く
		if (!currentPanel) {
			const panel = vscode.window.createWebviewPanel(
				'chatgptChat',
				'Multi AI Chat',
				vscode.ViewColumn.One,
				{
					enableScripts: true,
					retainContextWhenHidden: true
				}
			);

			currentPanel = panel;
			panel.webview.html = getWebviewContent();

			panel.webview.onDidReceiveMessage(
				async message => {
					if (message.type === 'sendMessage') {
						await handleChatMessage(panel.webview, message.text, context);
					}
				},
				undefined,
				context.subscriptions
			);

			panel.onDidDispose(
				() => {
					currentPanel = undefined;
				},
				null,
				context.subscriptions
			);
		}

		// 選択されたテキストをチャットに送信
		currentPanel.webview.postMessage({
			type: 'insertText',
			text: selectedText
		});

		currentPanel.reveal(vscode.ViewColumn.One);
	});

	context.subscriptions.push(openChatCommand, sendSelectionCommand);
}

/**
 * OpenAI API にチャットメッセージを送信し、レスポンスを取得します
 * API キーの検証、HTTPリクエストの実行、エラーハンドリングを行います
 * 
 * @async
 * @param {vscode.Webview} webview - レスポンスを送信先の Webview パネル
 * @param {string} userMessage - ユーザーが入力したメッセージ
 * @returns {Promise<void>}
 */
async function handleChatMessage(webview: vscode.Webview, userMessage: string, context: vscode.ExtensionContext) {
	// ユーザーメッセージを履歴に保存
	const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
	chatHistory.push({ text: userMessage, isUser: true });
	await context.globalState.update('chatHistory', chatHistory);

	const config = vscode.workspace.getConfiguration('multiai-chat');
	const provider = config.get<string>('provider') || 'openai';

	if (provider === 'gemini') {
		await handleGeminiMessage(webview, userMessage, context);
	} else {
		await handleOpenAIMessage(webview, userMessage, context);
	}
}

// Gemini API 向けに現在のチャット履歴を contents 形式へ変換
function buildGeminiContents(context: vscode.ExtensionContext, fallbackUserMessage: string) {
	const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
	const contents = chatHistory.map(msg => ({
		role: msg.isUser ? 'user' : 'model',
		parts: [{ text: msg.text }]
	}));

	if (contents.length === 0 && fallbackUserMessage) {
		contents.push({ role: 'user', parts: [{ text: fallbackUserMessage }] });
	}

	return contents;
}

type GeminiEndpointInfo = {
	hostname: string;
	path: string;
	isStreaming: boolean;
};

// Resolve Gemini endpoint from custom URL only. Throws if not configured.
function resolveGeminiEndpoint(config: vscode.WorkspaceConfiguration): GeminiEndpointInfo {
	const customUrl = (config.get<string>('geminiCustomUrl') || '').trim();
	if (!customUrl) {
		throw new Error('Gemini Custom URL が設定されていません。Settings > Extensions > Multi AI Chat の "Gemini Custom URL" を設定してください。');
	}

	const normalized = customUrl.match(/^https?:\/\//) ? customUrl : `https://${customUrl}`;
	const parsed = new URL(normalized);
	const isStreaming = parsed.pathname.includes(':streamGenerateContent') || parsed.searchParams.get('alt') === 'sse';

	return {
		hostname: parsed.hostname,
		path: parsed.pathname + parsed.search,
		isStreaming
	};
}

/**
 * OpenAI API にリクエストを送信します
 * 
 * @async
 * @param {vscode.Webview} webview - レスポンスを送信先の Webview パネル
 * @param {string} userMessage - ユーザーメッセージ
 * @returns {Promise<void>}
 */
async function handleOpenAIMessage(webview: vscode.Webview, userMessage: string, context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('multiai-chat');
	const apiKey = config.get<string>('apiKey');
	const apiEndpoint = config.get<string>('apiEndpoint') || 'api.openai.com';

	if (!apiKey) {
		webview.postMessage({
			type: 'response',
			text: 'エラー: OpenAI API Keyが設定されていません。Settings > Extensions > Multi AI Chat で設定してください。'
		});
		return;
	}

	try {
		const https = await import('https');
		
		// チャット履歴を取得（直前のユーザーメッセージを含む）
		const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
		
		// OpenAI API 形式でメッセージを構築
		const messages = chatHistory.map(msg => ({
			role: msg.isUser ? 'user' : 'assistant',
			content: msg.text
		}));

		if (messages.length === 0) {
			messages.push({ role: 'user', content: userMessage });
		}
		
		const data = JSON.stringify({
			model: "gpt-3.5-turbo",
			messages: messages,
			stream: true
		});

		const options = {
			hostname: apiEndpoint,
			port: 443,
			path: '/v1/chat/completions',
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${apiKey}`,
				'Content-Length': Buffer.byteLength(data)
			}
		};

		const req = https.request(options, (res) => {
			let buffer = '';
			let fullResponse = '';

			res.on('data', (chunk) => {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				
				// 最後の不完全な行を保存
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const jsonStr = line.slice(6);
						if (jsonStr === '[DONE]') {
							continue;
						}
						try {
							const json = JSON.parse(jsonStr);
							const content = json.choices?.[0]?.delta?.content || '';
							if (content) {
								fullResponse += content;
								webview.postMessage({
									type: 'streamChunk',
									text: content
								});
							}
						} catch (e) {
							// JSON解析エラーをスキップ
						}
					}
				}
			});

			res.on('end', async () => {
				webview.postMessage({
					type: 'streamEnd'
				});

				// AIレスポンスを履歴に保存
				if (fullResponse) {
					const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
					chatHistory.push({ text: fullResponse, isUser: false });
					await context.globalState.update('chatHistory', chatHistory);
				}
			});
		});

		req.on('error', (error: any) => {
			webview.postMessage({
				type: 'response',
				text: `リクエストエラー: ${error.message}`
			});
		});

		req.write(data);
		req.end();

	} catch (error: any) {
		webview.postMessage({
			type: 'response',
			text: `エラー: ${error.message}`
		});
	}
}

/**
 * Google Gemini API にリクエストを送信します（ストリーミング対応）
 * 
 * @async
 * @param {vscode.Webview} webview - レスポンスを送信先の Webview パネル
 * @param {string} userMessage - ユーザーメッセージ
 * @returns {Promise<void>}
 */
async function handleGeminiMessage(webview: vscode.Webview, userMessage: string, context: vscode.ExtensionContext) {
	const config = vscode.workspace.getConfiguration('multiai-chat');
	const apiKey = config.get<string>('geminiApiKey');

	if (!apiKey) {
		webview.postMessage({
			type: 'response',
			text: 'エラー: Gemini API Keyが設定されていません。Settings > Extensions > Multi AI Chat で設定してください。'
		});
		return;
	}

	try {
		const https = await import('https');
		const endpointInfo = resolveGeminiEndpoint(config);

		if (!endpointInfo.isStreaming) {
			// URLが非ストリーミングの場合は通常リクエストにフォールバック
			return handleGeminiNonStreaming(webview, userMessage, context, endpointInfo);
		}
		const contents = buildGeminiContents(context, userMessage);
		const data = JSON.stringify({ contents });

		// ストリーミング対応エンドポイント
		const options = {
			hostname: endpointInfo.hostname,
			port: 443,
			path: endpointInfo.path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey,
				'Content-Length': Buffer.byteLength(data)
			}
		};

		const req = https.request(options, (res) => {
			let buffer = '';
			let fullResponse = '';

			res.on('data', (chunk) => {
				buffer += chunk.toString();
				const lines = buffer.split('\n');
				
				// 最後の不完全な行を保存
				buffer = lines.pop() || '';

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const jsonStr = line.slice(6);
						if (jsonStr.trim()) {
							try {
								const jsonResponse = JSON.parse(jsonStr);
								
								if (jsonResponse.error) {
									webview.postMessage({
										type: 'response',
										text: `エラー: ${jsonResponse.error.message}`
									});
									return;
								}
								
								const content = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
								if (content) {
									fullResponse += content;
									webview.postMessage({
										type: 'streamChunk',
										text: content
									});
								}
							} catch (e) {
								// JSON解析エラーをスキップ
							}
						}
					}
				}
			});

			res.on('end', async () => {
				webview.postMessage({
					type: 'streamEnd'
				});

				// AIレスポンスを履歴に保存
				if (fullResponse) {
					const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
					chatHistory.push({ text: fullResponse, isUser: false });
					await context.globalState.update('chatHistory', chatHistory);
				}
			});
		});

		req.on('error', (error: any) => {
			// ストリーミング失敗時は非ストリーミングにフォールバック
			console.log('Gemini streaming failed, falling back to non-streaming');
			handleGeminiNonStreaming(webview, userMessage, context, resolveGeminiEndpoint(config));
		});

		req.write(data);
		req.end();

	} catch (error: any) {
		webview.postMessage({
			type: 'response',
			text: `エラー: ${error.message}`
		});
	}
}

/**
 * Google Gemini API にリクエストを送信します（非ストリーミング版）
 * ストリーミング失敗時のフォールバック
 * 
 * @async
 * @param {vscode.Webview} webview - レスポンスを送信先の Webview パネル
 * @param {string} userMessage - ユーザーメッセージ
 * @returns {Promise<void>}
 */
async function handleGeminiNonStreaming(
	webview: vscode.Webview,
	userMessage: string,
	context: vscode.ExtensionContext,
	endpointOverride?: GeminiEndpointInfo
) {
	const config = vscode.workspace.getConfiguration('multiai-chat');
	const apiKey = config.get<string>('geminiApiKey');
	const endpointInfo = endpointOverride || resolveGeminiEndpoint(config);

	if (!apiKey) {
		webview.postMessage({
			type: 'response',
			text: 'エラー: Gemini API Keyが設定されていません。Settings > Extensions > Multi AI Chat で設定してください。'
		});
		return;
	}

	try {
		const https = await import('https');
		const contents = buildGeminiContents(context, userMessage);
		const data = JSON.stringify({ contents });

		const options = {
			hostname: endpointInfo.hostname,
			port: 443,
			path: endpointInfo.path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': apiKey,
				'Content-Length': Buffer.byteLength(data)
			}
		};

		const req = https.request(options, (res) => {
			let responseData = '';

			res.on('data', (chunk) => {
				responseData += chunk.toString();
			});

			res.on('end', async () => {
				try {
					const jsonResponse = JSON.parse(responseData);
					
					if (jsonResponse.error) {
						webview.postMessage({
							type: 'response',
							text: `エラー: ${jsonResponse.error.message}`
						});
					} else {
						const responseText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || 'レスポンスがありませんでした。';
						webview.postMessage({
							type: 'response',
							text: responseText
						});

						// AIレスポンスを履歴に保存
						const chatHistory = context.globalState.get<Array<{text: string, isUser: boolean}>>('chatHistory') || [];
						chatHistory.push({ text: responseText, isUser: false });
						await context.globalState.update('chatHistory', chatHistory);
					}
				} catch (error: any) {
					webview.postMessage({
						type: 'response',
						text: `JSONパースエラー: ${error.message}`
					});
				}
			});
		});

		req.on('error', (error: any) => {
			webview.postMessage({
				type: 'response',
				text: `リクエストエラー: ${error.message}`
			});
		});

		req.write(data);
		req.end();

	} catch (error: any) {
		webview.postMessage({
			type: 'response',
			text: `エラー: ${error.message}`
		});
	}
}

/**
 * チャットUI用の HTML コンテンツを生成します
 * Webview パネルに表示されるチャットインターフェースのマークアップとスタイル、スクリプトを返します
 * 
 * @returns {string} HTML コンテンツ文字列
 */
function getWebviewContent() {
	return `<!DOCTYPE html>
<html lang="ja">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<title>Multi AI Chat</title>
	<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
	<style>
		body {
			font-family: var(--vscode-font-family);
			padding: 10px;
			margin: 0;
			background-color: var(--vscode-editor-background);
			color: var(--vscode-editor-foreground);
		}
		#chat-container {
			display: flex;
			flex-direction: column;
			height: 100vh;
		}
		#messages {
			flex: 1;
			overflow-y: auto;
			padding: 10px;
			margin-bottom: 10px;
			border: 1px solid var(--vscode-panel-border);
			border-radius: 4px;
		}
		.message {
			margin-bottom: 15px;
			padding: 8px 12px;
			border-radius: 6px;
			max-width: 80%;
		}
		.user-message {
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			margin-left: auto;
			text-align: left;
			white-space: pre-wrap;
		}
		.assistant-message {
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			margin-right: auto;
		}
		.assistant-message pre {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 8px;
			border-radius: 4px;
			overflow-x: auto;
			margin: 8px 0;
		}
		.assistant-message code {
			background-color: var(--vscode-textCodeBlock-background);
			padding: 2px 4px;
			border-radius: 3px;
			font-family: var(--vscode-editor-font-family);
		}
		.assistant-message pre code {
			background-color: transparent;
			padding: 0;
		}
		.assistant-message p {
			margin: 8px 0;
		}
		.assistant-message ul, .assistant-message ol {
			margin: 8px 0;
			padding-left: 20px;
		}
		.assistant-message blockquote {
			border-left: 3px solid var(--vscode-textBlockQuote-border);
			padding-left: 12px;
			margin: 8px 0;
			color: var(--vscode-textBlockQuote-foreground);
		}
		#input-container {
			display: flex;
			gap: 10px;
		}
		#button-container {
			display: flex;
			flex-direction: column;
			gap: 5px;
		}
		#message-input {
			flex: 1;
			padding: 8px;
			background-color: var(--vscode-input-background);
			color: var(--vscode-input-foreground);
			border: 1px solid var(--vscode-input-border);
			border-radius: 4px;
			resize: vertical;
			font-family: var(--vscode-font-family);
		}
		#send-button, #clear-button {
			padding: 8px 16px;
			background-color: var(--vscode-button-background);
			color: var(--vscode-button-foreground);
			border: none;
			border-radius: 4px;
			cursor: pointer;
			white-space: nowrap;
		}
		#send-button:hover, #clear-button:hover {
			background-color: var(--vscode-button-hoverBackground);
		}
		#send-button:disabled {
			opacity: 0.5;
			cursor: not-allowed;
		}
	</style>
</head>
<body>
	<div id="chat-container">
		<div id="messages"></div>
		<div id="input-container">
			<textarea id="message-input" placeholder="メッセージを入力... (Ctrl+Enter で送信)" rows="3"></textarea>
			<div id="button-container">
				<button id="send-button">送信</button>
				<button id="clear-button">履歴削除</button>
			</div>
		</div>
	</div>

	<script src="https://cdn.jsdelivr.net/npm/marked@11.1.1/marked.min.js"></script>
	<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
	<script>
		const vscode = acquireVsCodeApi();
		const messagesDiv = document.getElementById('messages');
		const messageInput = document.getElementById('message-input');
		const sendButton = document.getElementById('send-button');
		const clearButton = document.getElementById('clear-button');

		console.log('[DEBUG] Script loaded');
		console.log('[DEBUG] messagesDiv:', messagesDiv);
		console.log('[DEBUG] messageInput:', messageInput);
		console.log('[DEBUG] sendButton:', sendButton);
		console.log('[DEBUG] clearButton:', clearButton);

		let currentStreamMessage = null;

		function addMessage(text, isUser) {
			const messageDiv = document.createElement('div');
			messageDiv.className = 'message ' + (isUser ? 'user-message' : 'assistant-message');
			
			if (isUser) {
				messageDiv.textContent = text;
			} else {
				// Markdownをパースして表示
				messageDiv.innerHTML = marked.parse(text);
				// コードブロックのシンタックスハイライト
				messageDiv.querySelectorAll('pre code').forEach((block) => {
					hljs.highlightElement(block);
				});
			}
			
			messagesDiv.appendChild(messageDiv);
			messagesDiv.scrollTop = messagesDiv.scrollHeight;
			return messageDiv;
		}

		function sendMessage() {
			const text = messageInput.value.trim();
			if (!text) return;

			addMessage(text, true);
			messageInput.value = '';
			messageInput.style.height = 'auto';
			sendButton.disabled = true;
			currentStreamMessage = null;

			vscode.postMessage({
				type: 'sendMessage',
				text: text
			});
		}

		function clearHistory() {
			console.log('[DEBUG] clearHistory function called');
			// 確認ダイアログはextension.ts側で表示されるため、ここでは直接メッセージ送信
			vscode.postMessage({
				type: 'clearHistory'
			});
		}

		console.log('[DEBUG] clearButton element:', clearButton);
		sendButton.addEventListener('click', sendMessage);
		if (clearButton) {
			console.log('[DEBUG] Adding click event listener to clearButton');
			clearButton.addEventListener('click', clearHistory);
		} else {
			console.error('[ERROR] clearButton not found!');
		}
		messageInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && e.ctrlKey) {
				e.preventDefault();
				sendMessage();
			}
		});

		window.addEventListener('message', event => {
			const message = event.data;
			if (message.type === 'streamChunk') {
				if (!currentStreamMessage) {
					currentStreamMessage = addMessage('', false);
				}
				// ストリーミング中もMarkdownをリアルタイムレンダリング
				const currentText = currentStreamMessage.getAttribute('data-raw-text') || '';
				const newText = currentText + message.text;
				currentStreamMessage.setAttribute('data-raw-text', newText);
				currentStreamMessage.innerHTML = marked.parse(newText);
				// コードブロックのシンタックスハイライト
				currentStreamMessage.querySelectorAll('pre code').forEach((block) => {
					hljs.highlightElement(block);
				});
				messagesDiv.scrollTop = messagesDiv.scrollHeight;
			} else if (message.type === 'streamEnd') {
				sendButton.disabled = false;
				currentStreamMessage = null;
			} else if (message.type === 'response') {
				addMessage(message.text, false);
				sendButton.disabled = false;
				currentStreamMessage = null;
			} else if (message.type === 'restoreMessage') {
				// チャット履歴を復元
				addMessage(message.text, message.isUser);
			} else if (message.type === 'historyCleared') {
				console.log('Chat history cleared');
				messagesDiv.innerHTML = '';
			} else if (message.type === 'insertText') {
				messageInput.value = message.text;
				messageInput.focus();
			}
		});
	</script>
</body>
</html>`;
}

/**
 * 拡張機能が無効化される時に呼ばれるクリーンアップ関数
 * 必要なリソースの解放などを行います
 */
export function deactivate() {}
