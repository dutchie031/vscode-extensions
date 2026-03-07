// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { DutchiesFilesConnector } from './connectors/dutchiesFiles';
import { LocalFilesMirror } from './connectors/localFiles';
import { DutchieFilesSyncTreeDataProvider, TreeItem } from './panels/DutchieFilesSyncTreeDataProvider';
import { File, Folder, FileItem } from './models/files';
import { showEditor } from './commands';
import { ExcalidrawUriHandler } from './uri-handler';
import { ExcalidrawEditorProvider } from './editor';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {

	console.log('Activating Excalidraw Sync extension...');

	context.subscriptions.push(await ExcalidrawEditorProvider.register(context));
	context.subscriptions.push(ExcalidrawUriHandler.register());

	context.subscriptions.push(
		vscode.commands.registerCommand("excalidraw-sync.showEditor", showEditor)
	);

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "excalidraw-sync" is now active!');

	const localFilesMirror = new LocalFilesMirror(context);
	const dutchiesFilesConnector = new DutchiesFilesConnector(context, localFilesMirror);

	const _fileWatchers = new Map<string, TreeItem>();
	function closeAllTabs() {
		for (const tabGroup of vscode.window.tabGroups.all) {
			for (const tab of tabGroup.tabs) {
				const tabInput = tab.input as any;
				if (tabInput && tabInput.uri) {
					const fileUri = tabInput.uri.toString();
					if (_fileWatchers.has(fileUri)) {
						vscode.window.tabGroups.close(tab);
						_fileWatchers.delete(fileUri);
					}
				}
			}
		}
	}

	const treeDataProvider = new DutchieFilesSyncTreeDataProvider(dutchiesFilesConnector);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			"excalidrawSyncPanel",
			treeDataProvider
		)
	);

	context.subscriptions.push(vscode.commands.registerCommand('excalidraw-sync.refreshFiles', async () => {
		closeAllTabs();
		treeDataProvider.refresh();
	}));

	context.subscriptions.push(
		vscode.commands.registerCommand('excalidraw-sync.addFolder', async (selected: vscode.TreeItem) => {

			try {
				const folderName = await vscode.window.showInputBox({ prompt: 'Enter a name for the new folder' });
				if (folderName && folderName.length > 0) {

					let parentPath = "";
					if (selected instanceof TreeItem) {
						const parentItem = selected.getFileItem();
						if (parentItem && parentItem.isDirectory === false) {
							vscode.window.showErrorMessage('Cannot add a folder inside a file. Please select a folder or the root.');
							return;
						}
						parentPath = parentItem ? parentItem.path : "";
					}

					const newFolderPath = parentPath ? `${parentPath}/${folderName}` : folderName;
					let newFolder = new Folder(folderName, newFolderPath);
					await dutchiesFilesConnector.createFolder(newFolder);
					vscode.window.showInformationMessage(`Created folder: ${newFolderPath}`);

					treeDataProvider.refresh();
				}
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to create folder: ${error}`);
				return;
			}
		})
	);

	vscode.commands.registerCommand('excalidraw-sync.createExcalidrawFile', async (selected: vscode.TreeItem) => {
		let fileName = await vscode.window.showInputBox({ prompt: 'Enter a name for the new Excalidraw file' });
		if (fileName && fileName.length > 0) {
			if (!fileName.endsWith('.excalidraw.json')) {
				fileName += '.excalidraw.json';
			}

			const excalidrawContent = JSON.stringify(defaultExcalidrawFile);
			const encoder = new TextEncoder();
			const contentArray = encoder.encode(excalidrawContent);

			let parentPath: string = "";
			if (selected instanceof TreeItem) {
				const parentItem = selected.getFileItem();
				if (parentItem && parentItem.isDirectory === false) {
					vscode.window.showErrorMessage('Cannot add a file inside a file. Please select a folder or the root.');
					return;
				}
				if (parentItem) {
					parentPath = parentItem.path;
				}
			}

			const newFilePath = parentPath ? `${parentPath}/${fileName}` : fileName;
			const file = new File(fileName, newFilePath);
			await dutchiesFilesConnector.updateFile(file, contentArray);
			await localFilesMirror.syncFile(file, contentArray);
			vscode.window.showInformationMessage(`Created file: ${newFilePath}`);

			if (selected instanceof TreeItem) {
				treeDataProvider.refresh(selected as TreeItem);

				const children = await treeDataProvider.getChildren(selected) as TreeItem[];
				const createdFileItem = children.find(item => item.getFileItem().path === file.path);
				if (createdFileItem && createdFileItem instanceof TreeItem) {
					// Open the newly created file
					vscode.commands.executeCommand(
						"excalidraw-sync.openExcalidrawFile",
						createdFileItem as TreeItem
					);
				}
			} else {
				treeDataProvider.refresh();
			}
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.deleteFile', async (selected: vscode.TreeItem) => {
		if (selected.id && selected.id.length > 0) {
			if (selected instanceof TreeItem) {
				const fileItem = selected.getFileItem();
				if (fileItem.isDirectory === true) {
					vscode.window.showErrorMessage('Can only delete files. Please select a file to delete.');
					return;
				}

				const confirmed = await vscode.window.showWarningMessage(
					`Are you sure you want to delete file "${selected.id}"? \n This action cannot be undone.`,
					{ modal: true },
					'Delete'
				);

				if (confirmed === 'Delete') {
					await dutchiesFilesConnector.deleteFile(fileItem as File);
					vscode.window.showInformationMessage(`Deleted file: ${selected.id}`);
					treeDataProvider.refresh();
				}
			}
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.refresh', async () => {
		closeAllTabs();
		treeDataProvider.refresh();
	});

	vscode.commands.registerCommand('excalidraw-sync.setApiKey', async () => {
		const apiKey = await vscode.window.showInputBox({ prompt: 'Enter your DutchiesFiles API Key', ignoreFocusOut: true, password: true });
		if (apiKey && apiKey.length > 0) {
			await dutchiesFilesConnector.setApiKey(apiKey);
			vscode.window.showInformationMessage('API Key saved successfully!');
			treeDataProvider.refresh();
		}
	});

	const _updateTimes = new Map<string, Date>();
	vscode.commands.registerCommand('excalidraw-sync.openExcalidrawFile', async (fileItem: TreeItem) => {
		const fileObject = fileItem.getFileItem();
		if (fileObject && fileObject.name.length > 0) {
			fileItem.isSyncing = true;
			treeDataProvider.refresh(fileItem);
			const fileUri = await dutchiesFilesConnector.getAndSyncLocalFilePath(fileObject as File);
			fileItem.isSyncing = false;
			treeDataProvider.refresh(fileItem);
			await showEditor(fileUri);
			_fileWatchers.set(fileUri.toString(), fileItem);
			_updateTimes.set(fileUri.toString(), new Date());
		}
	});

	const interval = setInterval(() => {

		const openEditors: vscode.Uri[] = [];
		for (const tabGroup of vscode.window.tabGroups.all) {
			for (const tab of tabGroup.tabs) {
				if ((tab.input as any).uri) {
					openEditors.push((tab.input as any).uri);
				}
			}
		}

		_fileWatchers.forEach((fileObject, fileUri) => {
			if (!openEditors.find(uri => uri.toString() === fileUri.toString())) {
				_fileWatchers.delete(fileUri);
				_updateTimes.delete(fileUri);
			}
		});
	}, 5000);
	context.subscriptions.push({ dispose: () => clearInterval(interval) });


	const syncInterval = setInterval(async () => {
		for (const [fileUri, fileItem] of _fileWatchers) {
			if (fileItem.getFileItem().isDirectory === true) {
				continue;
			}

			const lastUpdate = _updateTimes.get(fileUri);
			const uri = vscode.Uri.parse(fileUri);
			const stat = await vscode.workspace.fs.stat(uri);
			const modifiedTime = new Date(stat.mtime);

			if (lastUpdate && modifiedTime > lastUpdate) {
				fileItem.isSyncing = true;
				treeDataProvider.refresh(fileItem);
				console.log(`Detected changes for ${fileUri.toString()}, syncing to S3...`);
				await dutchiesFilesConnector.updateFile(fileItem.getFileItem() as File, await vscode.workspace.fs.readFile(uri));
				fileItem.isSyncing = false;
				treeDataProvider.refresh(fileItem);
				_updateTimes.set(fileUri, modifiedTime);
				console.log(`Synced changes for ${fileUri.toString()}`);

			}
		}
	}, 1000);
	context.subscriptions.push({ dispose: () => clearInterval(syncInterval) });

}

const defaultExcalidrawFile = {
	type: "excalidraw",
	version: 2,
	source: "excalidraw-sync",
	elements: [],
	appState: {
		viewBackgroundColor: "#222430"
	},
	files: {}
};

// This method is called when your extension is deactivated
export function deactivate() { }
