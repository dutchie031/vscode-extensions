import * as vscode from 'vscode';
import { S3Connector, File, Directory } from '../connectors/s3connector';
import { title } from 'process';

export class ExcalidrawSyncTreeDataProvider implements vscode.TreeDataProvider<TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> = new vscode.EventEmitter<TreeItem | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> = this._onDidChangeTreeData.event;

    s3Connector : S3Connector;

    constructor(s3Connector : S3Connector) {
        this.s3Connector  = s3Connector;
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: TreeItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: TreeItem): Thenable<TreeItem[]> {
        if (!element) {

            const filesItem = new SectionItem('Files & Folders', 'files');
            filesItem.contextValue = 'excalidrawsync_s3filesection';

            // Top-level: 3 sections
            return Promise.resolve([
                new SectionItem('Targets', 'targets'),
                new SectionItem('Buckets', 'buckets'),
                filesItem
            ]);
        }

        if (element.id === 'targets') {
            return this.getTargets();
        }

        if (element.id === 'buckets') {
            return this.getBuckets();
        }

        if (element.id === 'files') {
            return this.getFileObjects(undefined);
        }
        if (element.contextValue === 'excalidrawsync_s3directory') {
            const dirItem = element as S3FileItem;
            return this.getFileObjects(dirItem.directory);
        }

        return Promise.resolve([]);
    }

    private getTargets(): Thenable<TreeItem[]> {
        // Children for Targets section
    
        const targets = this.s3Connector.getTargets();
        const items: TreeItem[] = [];
        for(let t of targets) {

            const command : vscode.Command = {
                command: 'excalidraw-sync.selectS3Target',
                title: 'Select S3 Target',
                arguments: [t]
            };
            let label = t;
            if(this.s3Connector.currentTarget === t){
                label = `✔ ${t}`;
            }

            const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
            item.command = command;
            item.contextValue = 'excalidrawsync_s3target'; // Used to show context menu for deletion
            item.id = t;

            items.push(item);
        }

        const addItem : vscode.TreeItem = new vscode.TreeItem('Add Target...', vscode.TreeItemCollapsibleState.None);
        addItem.command = {
            command: 'excalidraw-sync.addS3Target',
            title: 'Add S3 Target',
            arguments: []
        };

        items.push(addItem);
        return Promise.resolve(items);
    }

    private getBuckets(): Thenable<TreeItem[]> {
        // Children for Buckets section
        return this.s3Connector.getBuckets().then(buckets => {
            const items: TreeItem[] = [];
            for(const b of buckets) {

                let label = b;
                if(this.s3Connector.currentBucket === b){
                    label = `✔ ${b}`;
                }

                const command : vscode.Command = {
                    command: 'excalidraw-sync.selectS3Bucket',
                    title: 'Select S3 Bucket',
                    arguments: [b]
                };

                const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
                item.command = command;
                item.contextValue = 'excalidrawsync_s3bucket'; // Used to show context menu for deletion
                item.id = b;
                
                items.push(item);
            }

            const addBucketItem : vscode.TreeItem = new vscode.TreeItem('Add Bucket...', 
                vscode.TreeItemCollapsibleState.None);

            items.push(addBucketItem);

            return items;
        });
    }

    private async getFileObjects(parentFolder : Directory | undefined) : Promise<TreeItem[]>{

        const items = await this.s3Connector.getFilesInBucket(parentFolder);
        const treeItems : TreeItem[] = [];

        for(const item of items){
            const treeItem = new S3FileItem(
                item.name, 
                item.getObjectKey(),  
                item.isDirectory, 
                parentFolder);

            if(item.isDirectory){
                treeItem.contextValue = 'excalidrawsync_s3directory';
            } else {
                treeItem.contextValue = 'excalidrawsync_s3file';
            }

            treeItems.push(treeItem);
        }

        return Promise.resolve(treeItems);
    }
}

class SectionItem extends vscode.TreeItem {
    constructor(label: string, id: string) {
        super(label, vscode.TreeItemCollapsibleState.Collapsed);
        this.id = id;
    }
}

export class S3FileItem extends vscode.TreeItem {
    directory: Directory | undefined;

    constructor(label: string, id: string, isDirectory: boolean, parentDir?: Directory) {
        const collapsibleType = isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None;
        super(label, collapsibleType);
        this.id = id;
        this.directory = parentDir;
        if(isDirectory){
            this.contextValue = 'excalidrawsync_s3directory';
        } else {
            this.contextValue = 'excalidrawsync_s3file';
        }
    }
}

export type TreeItem = SectionItem;
export type S3TreeItem = S3FileItem;
