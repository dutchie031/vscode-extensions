import { ExtensionContext, Memento, SecretStorage, Uri, window } from "vscode";
import {    S3Client, ListBucketsCommand, ListObjectsV2Command, 
            GetObjectCommand, PutObjectCommand, DeleteBucketCommand, 
            DeleteObjectCommand, CreateBucketCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { S3SettingsPrompt, S3SettingsResult } from './s3SettingsPrompt';
import * as vscode from 'vscode';

export class S3Connector {
    
    globalState: Memento;
    secretStorage: SecretStorage;
    targets: string[] = [];
    settings: Map<string, TargetSettings> = new Map();
    clients: Map<string, S3Client> = new Map();
    

    currentTarget: string | undefined;
    currentBucket: string | undefined;

    private storagePath : Uri;

    constructor(extensionContext: ExtensionContext) {
        this.secretStorage = extensionContext.secrets;
        this.globalState = extensionContext.globalState;

        this.storagePath = extensionContext.globalStorageUri;
        const watcher = vscode.workspace.createFileSystemWatcher(this.storagePath.fsPath,
            false, false, false
        );
        watcher.onDidChange(async (uri) => {
            // Handle changes if needed
            console.log(`Storage path changed: ${uri.fsPath}`);
        });

        

        this.targets = this.globalState.get<string[]>("s3Targets") || [];
        this.currentTarget = this.targets.length > 0 ? this.targets[0] : undefined;
        this.targets.forEach(async (target) => {
            await this.verifySettings(target);
        });
    }


    async verifySettings(target: string) : Promise<boolean> {
        let settings = this.settings.get(target);
        if(!settings) {
            settings = new TargetSettings();
            this.settings.set(target, settings);
        }
        
        if(!settings.accessKeyId) {
            let value = await this.secretStorage.get(`${target}_s3AccessKeyId`);
            if (value && value.length > 0) {
                settings.accessKeyId = value;
            } else {
                return false;
            }
        }
        if(!settings.secretAccessKey) {
            const value = await this.secretStorage.get(`${target}_s3SecretAccessKey`);
            if (value && value.length > 0) {
                settings.secretAccessKey = value;
            } else {
                return false;
            }
        }
        if(!settings.host) {
            const value = await this.secretStorage.get(`${target}_s3Host`);
            if (value && value.length > 0) {
                settings.host = value;
            } else {
                return false;
            }
        }
        this.settings.set(target, settings);
        return true;
    }

    async getClient(target: string): Promise<S3Client> {
        
        if (!this.verifySettings(target)){
            window.showErrorMessage(`S3 settings not configured for ${target}`);
            throw new Error(`S3 settings not configured for ${target}`);
        }
        let client = this.clients.get(target);
        if (client) {
            return client;
        }
        const settings = this.settings.get(target);
        if (!settings) {
            window.showErrorMessage(`S3 settings not configured for ${target}`);
            throw new Error(`S3 settings not found for ${target}`);
        }
        window.showInformationMessage(`Connecting to S3 target ${target} at ${settings.host}`);
        client = new S3Client({
            region: "EU",
            endpoint: settings.host,
            credentials: {
                accessKeyId: settings.accessKeyId,
                secretAccessKey: settings.secretAccessKey
            },
            forcePathStyle: true
        });

        this.clients.set(target, client);
        return client;
    }

    selectBucket(bucketName: string): void {
        this.currentBucket = bucketName;
    }
    
    async getBuckets(): Promise<string[]> {
        if (this.currentTarget === undefined) {
            return [];
        }

        const client = await this.getClient(this.currentTarget);
        const command = new ListBucketsCommand({});
        const response = await client.send(command);
        const bucketNames = response.Buckets?.map(bucket => bucket.Name || "") || [];
        return bucketNames;
    }

    async createBucket(bucketName: string): Promise<void> {
        if (this.currentTarget === undefined) {
            return;
        }

        const client = await this.getClient(this.currentTarget);
        const command = new CreateBucketCommand({
            Bucket: bucketName
        });
        await client.send(command);
    }
    
    async deleteBucket(bucketName: string): Promise<void> {
        if (this.currentTarget === undefined) {
            return;
        }

        const client = await this.getClient(this.currentTarget);
        
        // First, list and delete all objects in the bucket
        let continuationToken: string | undefined;
        do {
            const listCommand = new ListObjectsV2Command({
                Bucket: bucketName,
                ContinuationToken: continuationToken
            });
            const listResponse = await client.send(listCommand);
            
            if (listResponse.Contents && listResponse.Contents.length > 0) {
                // Delete objects individually to avoid Content-MD5 requirement
                for (const obj of listResponse.Contents) {
                    if (obj.Key) {
                        const deleteCommand = new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: obj.Key
                        });
                        await client.send(deleteCommand);
                    }
                }
            }
            
            continuationToken = listResponse.NextContinuationToken;
        } while (continuationToken);
        
        // Now delete the empty bucket
        const deleteBucketCommand = new DeleteBucketCommand({
            Bucket: bucketName
        });
        await client.send(deleteBucketCommand);
    }

    async addTarget(target: string, context: ExtensionContext): Promise<void> {
        this.targets.push(target);
        this.globalState.update("s3Targets", this.targets);

        // Show the settings prompt webview
        const result: S3SettingsResult | undefined = await S3SettingsPrompt.show(context, target, undefined, undefined, undefined);
        if (!result) {
            // User cancelled, remove the target again
            this.targets = this.targets.filter(t => t !== target);
            this.globalState.update("s3Targets", this.targets);
            return;
        }

        // Store settings in secret storage
        await this.secretStorage.store(`${target}_s3AccessKeyId`, result.accessKeyId);
        await this.secretStorage.store(`${target}_s3SecretAccessKey`, result.secretAccessKey);
        await this.secretStorage.store(`${target}_s3Host`, result.host);

        // Optionally, update the settings map
        const settings = new TargetSettings();
        settings.accessKeyId = result.accessKeyId;
        settings.secretAccessKey = result.secretAccessKey;
        settings.host = result.host;
        this.settings.set(target, settings);
    }

    async editTarget(target: string, context: ExtensionContext): Promise<void> {
        // Show the settings prompt webview with current settings
        if(!this.verifySettings(target)){
            window.showErrorMessage(`S3 settings not configured for ${target}`);
            return;
        }
        const currentSettings = this.settings.get(target);
        const result: S3SettingsResult | undefined = await S3SettingsPrompt.show(context, target, currentSettings?.accessKeyId, currentSettings?.secretAccessKey, currentSettings?.host);
        if (!result) {
            // User cancelled, do nothing
            return;
        }

        // Store updated settings in secret storage
        await this.secretStorage.store(`${target}_s3AccessKeyId`, result.accessKeyId);
        await this.secretStorage.store(`${target}_s3SecretAccessKey`, result.secretAccessKey);
        await this.secretStorage.store(`${target}_s3Host`, result.host);

        // Update the settings map
        const settings = new TargetSettings();
        settings.accessKeyId = result.accessKeyId;
        settings.secretAccessKey = result.secretAccessKey;
        settings.host = result.host;
        this.settings.set(target, settings);

        // Invalidate existing client to force re-creation with new settings
        this.clients.delete(target);
    }

    getTargets(): string[] {  
        return this.targets;
    }

    setTarget(target: string): void {
        this.currentTarget = target;
        this.currentBucket = undefined;
    }

    removeTarget(target: string): void {
        this.targets = this.targets.filter(t => t !== target);
        this.globalState.update("s3Targets", this.targets);
        if (this.currentTarget === target) {
            this.currentTarget = this.targets.length > 0 ? this.targets[0] : undefined;
        }

        this.settings.delete(target);
        this.clients.delete(target);
        this.secretStorage.delete(`${target}_s3AccessKeyId`);
        this.secretStorage.delete(`${target}_s3SecretAccessKey`);
        this.secretStorage.delete(`${target}_s3Host`);
    }

    async getFilesInBucket(parent: Directory | undefined) : Promise<FileObject[]> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            return [];
        }

        const client = await this.getClient(this.currentTarget);
        const prefix = parent ?  parent.getObjectKey() : '';
        const command = new ListObjectsV2Command({
            Bucket: this.currentBucket,
            Prefix: prefix,
            Delimiter: '/'
        });
        const response = await client.send(command);

        const items: FileObject[] = [];
        for (const commonPrefix of response.CommonPrefixes || []) {
            if (commonPrefix.Prefix) {
                const dirName = commonPrefix.Prefix.slice(prefix.length).replace(/\/$/, '');
                if (dirName.length === 0) {
                    continue;
                }
                const dir = new Directory(dirName, parent as Directory | undefined);
                items.push(dir);
            }
        }

        for (const obj of response.Contents || []) {
            if (obj.Key && obj.Key !== prefix) {
                const fileName = obj.Key.slice(prefix.length);
                if (!fileName.endsWith('/')) { // Exclude directories
                    const size = obj.Size || 0;
                    const file = new File(fileName, size, parent as Directory | undefined);
                    items.push(file);
                }
            }
        }
        return items;
    }
    

    async getAndSyncLocalFilePath(file: File): Promise<Uri> {
        
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            window.showErrorMessage("No S3 target or bucket selected");
            throw new Error("No S3 target or bucket selected");
        }

        const fileExists = await this.fileExists(file);
        const fileUri = this.toFileUri(file);
        if (!fileExists) {
            const bufferedfile = await this.getFileFromS3(file);
            await vscode.workspace.fs.writeFile(fileUri, bufferedfile);
            return fileUri;
        }

        const localStat = await vscode.workspace.fs.stat(fileUri);
        const s3Timestamp = await this.getUpdateTimestamp(file);
        if (s3Timestamp && localStat.mtime < s3Timestamp.getTime()) {
            const bufferedfile = await this.getFileFromS3(file);
            await vscode.workspace.fs.writeFile(fileUri, bufferedfile);
        }

        return fileUri;
    }

    private async getUpdateTimestamp(file: File): Promise<Date | null> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            window.showErrorMessage("No S3 target or bucket selected");
            throw new Error("No S3 target or bucket selected");
        }

        const client = await this.getClient(this.currentTarget);
        const command = new HeadObjectCommand({
            Bucket: this.currentBucket,
            Key: file.getObjectKey(),
        });
        const response = await client.send(command);

        if (response.Metadata && response.Metadata['lastmodified']) {
            return new Date(response.Metadata['lastmodified']);
        }
        
        return null;
    }

    private async getFileFromS3(file: File): Promise<Uint8Array> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            window.showErrorMessage("No S3 target or bucket selected");
            throw new Error("No S3 target or bucket selected");
        }

        const client = await this.getClient(this.currentTarget);
        const command = new GetObjectCommand({
            Bucket: this.currentBucket,
            Key: file.getObjectKey(),
        });
        const response = await client.send(command);
        if(response.$metadata.httpStatusCode !== 200){
            window.showErrorMessage(`Failed to get file ${file.name} from S3. HTTP Status Code: ${response.$metadata.httpStatusCode}`);
            throw new Error(`Failed to get file ${file.name} from S3`);
        }

        if (response.Body) {
            const bytes = await response.Body?.transformToByteArray();
            return bytes;
        }

        return new Uint8Array(0);
    }

    async addDirectory(directory : Directory) : Promise<void> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            return;
        }
        const key = directory.getObjectKey();
        const client = await this.getClient(this.currentTarget);
        const command = new PutObjectCommand({
            Bucket: this.currentBucket,
            Key: key.endsWith('/') ? key + '/' : key,
            Body: '',
        });
        await client.send(command);
    }

    async updateFile(file: File, content: Uint8Array): Promise<void> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            window.showErrorMessage("Could not update file due to not having a target or bucket selected");
            return;
        }

        const fileUri = this.toFileUri(file);
        const stats = await vscode.workspace.fs.stat(fileUri);
        const lastModified = new Date(stats.mtime).toISOString();

        const key = file.getObjectKey();
        const client = await this.getClient(this.currentTarget);
        const command = new PutObjectCommand({
            Bucket: this.currentBucket,
            Key: key,
            Body: content,
            Metadata: {
                uploadedBy: 'excalidraw-sync',
                lastModified: lastModified
            }
        });
        await client.send(command);
    }

    async deleteFile(file: File): Promise<void> {

        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            window.showErrorMessage("Could not delete file due to not having a target or bucket selected");
            return;
        }

        const client = await this.getClient(this.currentTarget);
        const command = new DeleteObjectCommand({
            Bucket: this.currentBucket,
            Key: file.getObjectKey(),
        });
        await client.send(command);

        const fileUri = this.toFileUri(file);
        try {
            await vscode.workspace.fs.delete(fileUri);
        } catch (error) {
            console.error(`Failed to delete local file: ${fileUri.fsPath}`, error);
            window.showErrorMessage(`Failed to delete local file: ${fileUri.fsPath}`);
        }
    }

    toFileUri(file: File): Uri {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            throw new Error("No S3 target or bucket selected");
        }
        const fileUri = Uri.joinPath(this.storagePath, this.currentTarget!, this.currentBucket!, file.getObjectKey());
        return fileUri;
    }

    private async fileExists(file: File): Promise<boolean> {
        const fileUri = this.toFileUri(file);
        try {
            await vscode.workspace.fs.stat(fileUri);
            return true;
        } catch (error) {
            return false;
        }
    }
}

class TargetSettings {
    accessKeyId: string = "";
    secretAccessKey: string = "";
    host: string = "";
}

export abstract class FileObject {
    isDirectory : boolean;
    parentDir : Directory | undefined;
    name: string;

    constructor(name:string, isDir: boolean, parentDir?: Directory){
        this.name = name,
        this.isDirectory = isDir;
        this.parentDir = parentDir;
    }

    getObjectKey(): string {
        let name : string = this.name;

        let current : FileObject | undefined = this;
        while(current !== undefined){
            if(current.parentDir){
                name = `${current.parentDir.name}/${name}`;
            }
            current = current.parentDir;
        }

        if(this.isDirectory && !name.endsWith('/')){
            name = `${name}/`;
        }

        return name;
    }
} 

export class Directory extends FileObject {

    children: FileObject[] = [];
    
    constructor(name: string, parentDir?: Directory){
        super(name,true, parentDir);
    }
}

export class File extends FileObject {
    sizeBytes : number;
    constructor(fileName: string, sizeBytes: number, parentDir?: Directory){
        super(fileName, false, parentDir);
        this.sizeBytes = sizeBytes;
    }
}