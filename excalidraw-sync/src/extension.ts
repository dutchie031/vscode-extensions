// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ExcalidrawSyncTreeDataProvider, S3FileItem } from './panels/ExcalidrawSyncTreeDataProvider';
import { S3Connector, Directory } from './connectors/s3connector';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "excalidraw-sync" is now active!');

	const s3Connector = new S3Connector(context);

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
			vscode.window.showInformationMessage(`Selected S3 Target: ${selected}`);
			treeDataProvider.refresh();
		}
	});

	vscode.commands.registerCommand('excalidraw-sync.selectS3Bucket', async (selected: string) => {
		if(selected && selected.length > 0) {
			s3Connector.selectBucket(selected);
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
					const directory = new Directory(folderName, selectedFolder.directory as Directory);
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
}

// This method is called when your extension is deactivated
export function deactivate() {}
