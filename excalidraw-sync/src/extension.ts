// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ExcalidrawSyncTreeDataProvider, S3FileItem } from './panels/ExcalidrawSyncTreeDataProvider';
import { S3Connector, Directory, File } from './connectors/s3connector';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "excalidraw-sync" is now active!');

	const s3Connector = new S3Connector(context);
	const _fileWatchers = new Map<string, S3FileItem>();
	function closeAllTabs(){
		for (const tabGroup of vscode.window.tabGroups.all) {
			for (const tab of tabGroup.tabs) {
				const tabInput = tab.input as any;
				if (tabInput && tabInput.uri) {
					const fileUri = tabInput.uri.toString();
					if(_fileWatchers.has(fileUri)){
						vscode.window.tabGroups.close(tab);
						_fileWatchers.delete(fileUri);
					}
				}
			}
		}
	}

	const treeDataProvider = new ExcalidrawSyncTreeDataProvider(s3Connector);
	context.subscriptions.push(
		vscode.window.registerTreeDataProvider(
			"excalidrawSyncPanel",
			treeDataProvider
		)
	);

	vscode.commands.registerCommand('excalidraw-sync.addS3Target', async () => {
		const targetName = await vscode.window.showInputBox({prompt: 'Enter a name for the new S3 Target'});
		if(targetName && targetName.length > 0) {
			await s3Connector.addTarget(targetName, context);
			treeDataProvider.refresh();
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.selectS3Target', async (selected: string) => {
		if(selected && selected.length > 0) {
			s3Connector.setTarget(selected);
			closeAllTabs();
			vscode.window.showInformationMessage(`Selected S3 Target: ${selected}`);
			treeDataProvider.refresh();
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.selectS3Bucket', async (selected: string) => {
		if(selected && selected.length > 0) {
			s3Connector.selectBucket(selected);
			closeAllTabs();
			vscode.window.showInformationMessage(`Selected S3 Bucket: ${selected}`);
			treeDataProvider.refresh();
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.deleteS3Bucket', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {

			const confirmed = await vscode.window.showWarningMessage(
				`Are you sure you want to delete bucket "${selected.id}"? \n This action cannot be undone.`,
				{ modal: true },
				'Delete'
			);

			if(confirmed === 'Delete') {
				await s3Connector.deleteBucket(selected.id);
				vscode.window.showInformationMessage(`Deleted S3 Bucket: ${selected.id}`);
				treeDataProvider.refresh();
			}
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.createS3Bucket', async () => {
		const bucketName = await vscode.window.showInputBox({prompt: 'Enter a name for the new S3 Bucket'});
		if(bucketName && bucketName.length > 0) {
			await s3Connector.createBucket(bucketName);
			vscode.window.showInformationMessage(`Created S3 Bucket: ${bucketName}`);
			treeDataProvider.refresh();
		}
	});


	vscode.commands.registerCommand('excalidraw-sync.removeS3Target', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {
			s3Connector.removeTarget(selected.id);
			vscode.window.showInformationMessage(`Removed S3 Target: ${selected}`);
			treeDataProvider.refresh();
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.editS3Target', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {
			await s3Connector.editTarget(selected.id, context);
			vscode.window.showInformationMessage(`Edited S3 Target: ${selected}`);
			treeDataProvider.refresh();
		}
	});

	
	vscode.commands.registerCommand('excalidraw-sync.addS3Folder', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {
			const folderName = await vscode.window.showInputBox({prompt: 'Enter a name for the new folder'});
			if(folderName && folderName.length > 0) {
				
				if(selected instanceof S3FileItem){
					// Has Parent folder
					const selectedFolder = selected as S3FileItem;
					if(!selectedFolder.isDirectory){
						vscode.window.showErrorMessage('Cannot add a folder inside a file. Please select a folder.');
						return;
					}
					const directory = new Directory(folderName, selectedFolder.directory);
					await s3Connector.addDirectory(directory);
				} else {
					// Root folder
					const directory = new Directory(folderName, undefined);
					await s3Connector.addDirectory(directory);
				}
				treeDataProvider.refresh();
			}
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.createExcalidrawFile', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {
			let fileName = await vscode.window.showInputBox({prompt: 'Enter a name for the new Excalidraw file'});
			if(fileName && fileName.length > 0) {
				if (!fileName.endsWith('.excalidraw.json')) {
					fileName += '.excalidraw.json';
				}

				const excalidrawContent = JSON.stringify(defaultExcalidrawFile);
				const encoder = new TextEncoder();
				const contentArray = encoder.encode(excalidrawContent);

				if(selected instanceof S3FileItem){
					// Has Parent folder
					const selectedFolder = selected as S3FileItem;
					if(!selectedFolder.isDirectory){
						vscode.window.showErrorMessage('Cannot add a file inside a file. Please select a folder.');
						return;
					}
					
					const file = new File(fileName, 12, selectedFolder.directory as Directory);
					const uri = s3Connector.toFileUri(file);
					await vscode.workspace.fs.writeFile(uri, contentArray);
					await s3Connector.updateFile(file, contentArray);

					treeDataProvider.refresh(selectedFolder);

					const children = await treeDataProvider.getChildren(selectedFolder);
					const createdFileItem = children.find(item => item.id === file.getObjectKey());
					if(createdFileItem && createdFileItem instanceof S3FileItem){
						// Open the newly created file
						vscode.commands.executeCommand(
							"excalidraw-sync.openExcalidrawFile",
							createdFileItem as S3FileItem
						);
					}
				}
			}
		}
	});
	
	vscode.commands.registerCommand('excalidraw-sync.deleteFile', async (selected: vscode.TreeItem) => {
		if(selected.id && selected.id.length > 0) {
			if(selected instanceof S3FileItem){
				const fileItem = selected as S3FileItem;
				if(fileItem.isDirectory === true || !fileItem.file){
					vscode.window.showErrorMessage('Can only delete files. Please select a file to delete.');
					return;
				}
				
				const confirmed = await vscode.window.showWarningMessage(
					`Are you sure you want to delete file "${selected.id}"? \n This action cannot be undone.`,
					{ modal: true },
					'Delete'
				);
				if(confirmed === 'Delete') {
					await s3Connector.deleteFile(fileItem.file);
					vscode.window.showInformationMessage(`Deleted file: ${selected.id}`);
					treeDataProvider.refresh();
				}
			}
		}
	});
	
	const _updateTimes = new Map<string, Date>();
	vscode.commands.registerCommand('excalidraw-sync.openExcalidrawFile', async (fileItem: S3FileItem) => {
		const fileObject = fileItem.file;
		if(fileObject && fileObject.name.length > 0) {
			fileItem.isSyncing = true;
			treeDataProvider.refresh(fileItem);
			const fileUri = await s3Connector.getAndSyncLocalFilePath(fileObject);
			fileItem.isSyncing = false;
			treeDataProvider.refresh(fileItem);
			await vscode.commands.executeCommand(
				'vscode.openWith',
				fileUri,
				'editor.excalidraw'
			);
			_fileWatchers.set(fileUri.toString(), fileItem);
			_updateTimes.set(fileUri.toString(), new Date());
		}
	});	

	const interval = setInterval(() => {

		const openEditors : vscode.Uri[] = [];
		for (const tabGroup of vscode.window.tabGroups.all) {
			for (const tab of tabGroup.tabs) {
				if ((tab.input as any).uri) {
					openEditors.push((tab.input as any).uri);
				}
			}
		}

		_fileWatchers.forEach((fileObject, fileUri) => {
			if(!openEditors.find(uri => uri.toString() === fileUri.toString())){
				_fileWatchers.delete(fileUri);
				_updateTimes.delete(fileUri);
			}
		});
	}, 5000);
	context.subscriptions.push({ dispose: () => clearInterval(interval) });

	
	const syncInterval = setInterval(async () => {
		for (const [fileUri, fileItem] of _fileWatchers) {
			if(fileItem.isDirectory === true || !fileItem.file){
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
				await s3Connector.updateFile(fileItem.file, await vscode.workspace.fs.readFile(uri));
				fileItem.isSyncing = false;
				treeDataProvider.refresh(fileItem);
				_updateTimes.set(fileUri, modifiedTime);
				console.log(`Synced changes for ${fileUri.toString()}`);

			}
		}
	},1000);
	context.subscriptions.push({ dispose: () => clearInterval(syncInterval) });
	
}

const defaultExcalidrawFile = {
	type: "excalidraw",
	version: 2,
	source: "excalidraw-sync",
	elements: [],
	appState: {
		viewBackgroundColor: "#1c1d27"
	},
	files: {}
};

// This method is called when your extension is deactivated
export function deactivate() {}
