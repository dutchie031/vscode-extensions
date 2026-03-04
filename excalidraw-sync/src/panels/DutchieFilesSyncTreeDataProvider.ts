import { File, Folder, FileItem } from "../models/files";
import { DutchiesFilesConnector } from "../connectors/dutchiesFiles";
import * as vscode from 'vscode';

export class DutchieFilesSyncTreeDataProvider implements vscode.TreeDataProvider<TreeItem> 
{
    dutchiesFilesConnector : DutchiesFilesConnector;

    constructor(dutchiesFilesConnector: DutchiesFilesConnector) {
        this.dutchiesFilesConnector = dutchiesFilesConnector;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    refresh(element?: TreeItem): void {
        this._onDidChangeTreeData.fire(element);
    }

    getTreeItem(element: TreeItem): vscode.TreeItem | Thenable<vscode.TreeItem> { 
        if(element instanceof TreeItem && element.label){
            if(element.isSyncing){
                element.label = `🔄 ${element.label.toString().replace('🔄 ', '')}`;
            } else {
                element.label = element.label.toString().replace('🔄 ', '');
            }
        }
        return element;
    }

    getChildren(element?: TreeItem): vscode.ProviderResult<TreeItem[]> {
        let fileItem : FileItem | undefined = undefined;
        if(element){
            if(element instanceof TreeItem){
                fileItem = element.getFileItem();
                if (fileItem.isDirectory === false){
                    return [];
                }
            }
        }
        return this.dutchiesFilesConnector.getFilesInDirectory(fileItem as Folder).then(fileItems => {
            return fileItems.map(item => {
                return new TreeItem(item.name, item);
            });
        });
    }

    // getParent?(element: TreeItem): vscode.ProviderResult<TreeItem>
    // {
    //     throw new Error("Method not implemented.");
    // }

    // resolveTreeItem?(item: TreeItem, element: TreeItem, token: vscode.CancellationToken): vscode.ProviderResult<TreeItem> {
    //     throw new Error("Method not implemented.");
    // }

}

export class TreeItem extends vscode.TreeItem {
    isSyncing: boolean = false;
    private fileItem : FileItem;
    constructor(label: string, fileItem: FileItem) {
        super(label, fileItem.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);

        this.contextValue = fileItem.isDirectory ? 'treeitem_directory' : 'treeitem_file';

        this.fileItem = fileItem;

        if(!fileItem.isDirectory){
            this.command = {
                command: 'excalidraw-sync.openExcalidrawFile',
                title: 'Open Excalidraw File',
                arguments: [this]
            };
        }   
    }

    getFileItem() : FileItem {
        return this.fileItem;
    }
}