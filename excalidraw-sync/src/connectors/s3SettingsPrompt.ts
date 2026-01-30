import * as vscode from 'vscode';

export interface S3SettingsResult {
    accessKeyId: string;
    secretAccessKey: string;
    host: string;
}

export class S3SettingsPrompt {
    static async show(context: vscode.ExtensionContext, target: string, keyId: string|undefined, secretKey: string|undefined, host: string|undefined): Promise<S3SettingsResult | undefined> {
        return new Promise((resolve) => {
            const panel = vscode.window.createWebviewPanel(
                's3Settings',
                `S3 Settings for ${target}`,
                vscode.ViewColumn.One,
                { enableScripts: true }
            );

            keyId = keyId || '';
            secretKey = secretKey || '';
            host = host || '';
            panel.webview.html = S3SettingsPrompt.getHtml(target, keyId, secretKey, host);

            panel.webview.onDidReceiveMessage(message => {
                if (message.command === 'save') {
                    const { accessKeyId, secretAccessKey, host } = message;
                    if (!accessKeyId || !secretAccessKey || !host) {
                        panel.webview.postMessage({ command: 'error', text: 'All fields are required.' });
                        return;
                    }
                    resolve({ accessKeyId, secretAccessKey, host });
                    panel.dispose();
                } else if (message.command === 'cancel') {
                    resolve(undefined);
                    panel.dispose();
                }
            });

            panel.onDidDispose(() => {
                resolve(undefined);
            });
        });
    }

    private static getHtml(target: string, keyId: string | undefined, secretKey: string | undefined, host: string | undefined): string {
        return /*html*/`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <style>
                body {
                    background-color: #1c1d27;
                    color: #ffffff;
                }

                input {
                    width: 100%;
                    background-color: #27293f;
                    border: none;
                    color: #ffffff;
                }

                button {
                    padding: 8px 16px;
                    background-color: #0e639c;
                    border:none;
                    border-radius: 8px;
                    color: white;
                }
            </style>
        </head>
        <body>
            <h2>S3 Settings for ${target}</h2>
            <form id="s3form">
                <label>Access Key ID:<br><input id="accessKeyId" type="text" value="${keyId}" /></label><br>
                <label>Secret Access Key:<br><input id="secretAccessKey" type="password" value="${secretKey}" /></label><br>
                <label>Host:<br><input id="host" type="text" value="${host}"/></label><br><br>
                <button type="button" onclick="save()">Save</button>
                <button type="button" onclick="cancel()">Cancel</button>
                <div id="error" style="color:red;"></div>
            </form>
            <script>
                const vscode = acquireVsCodeApi();
                function save() {
                    vscode.postMessage({
                        command: 'save',
                        accessKeyId: document.getElementById('accessKeyId').value,
                        secretAccessKey: document.getElementById('secretAccessKey').value,
                        host: document.getElementById('host').value
                    });
                }
                function cancel() {
                    vscode.postMessage({ command: 'cancel' });
                }
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'error') {
                        document.getElementById('error').textContent = message.text;
                    }
                });
            </script>
        </body>
        </html>
        `;
    }
}