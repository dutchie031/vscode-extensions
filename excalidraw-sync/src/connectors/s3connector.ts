
import { ExtensionContext, Memento, SecretStorage, window } from "vscode";
import { S3Client, ListBucketsCommand, ListObjectsV2Command, GetObjectCommand, PutObjectCommand, PutObjectCommandInput } from "@aws-sdk/client-s3";
import { S3SettingsPrompt, S3SettingsResult } from './s3SettingsPrompt';

export class S3Connector {
    
    globalState: Memento;
    secretStorage: SecretStorage;
    targets: string[] = [];
    settings: Map<string, TargetSettings> = new Map();
    clients: Map<string, S3Client> = new Map();

    currentTarget: string | undefined;
    currentBucket: string | undefined;

    constructor(extensionContext: ExtensionContext) {
        this.secretStorage = extensionContext.secrets;
        this.globalState = extensionContext.globalState;
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
    
    async getBuckets(): Promise<string[]>{
        if (this.currentTarget === undefined) {
            return [];
        }

        const client = await this.getClient(this.currentTarget);
        const command = new ListBucketsCommand({});
        const response = await client.send(command);
        const bucketNames = response.Buckets?.map(bucket => bucket.Name || "") || [];
        return bucketNames;
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
        const prefix = parent ?  parent.getObjectKey() + '/' : '';
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
                const dir = new Directory(dirName, parent as Directory | undefined);
                items.push(dir);
            }
        }

        for (const obj of response.Contents || []) {
            if (obj.Key && obj.Key !== prefix) {
                const fileName = obj.Key.slice(prefix.length);
                if (!fileName.endsWith('/')) { // Exclude directories
                    const file = new File(fileName, parent as Directory | undefined);
                    items.push(file);
                }
            }
        }
        return items;
    }

    async getFile(file: File): Promise<Uint8Array> {
        
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            return new Uint8Array(0);
        }

        const client = await this.getClient(this.currentTarget);
        const command = new GetObjectCommand({
            Bucket: this.currentBucket,
            Key: file.getObjectKey(),
        });
        const response = await client.send(command);

        if (response.Body) {
            const stream = response.Body as ReadableStream<Uint8Array>;
            const reader = stream.getReader();
            const chunks: Uint8Array[] = [];
            let done = false;

            while (!done) {
                const { value, done: doneReading } = await reader.read();
                if (value) {
                    chunks.push(value);
                }
                done = doneReading;
            }

            // Concatenate all chunks into a single ArrayBuffer
            const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0);
            const arrayBuffer = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                arrayBuffer.set(chunk, offset);
                offset += chunk.length;
            }

            return arrayBuffer;
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
            Body: ''
        });
        await client.send(command);
    }

    async addFile(file: File, content: Uint8Array): Promise<void> {
        if (this.currentTarget === undefined || this.currentBucket === undefined) {
            return;
        }
        
        const key = file.getObjectKey();
        const client = await this.getClient(this.currentTarget);
        const command = new PutObjectCommand({
            Bucket: this.currentBucket,
            Key: key,
            Body: content
        });
        await client.send(command);
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
    constructor(fileName: string, parentDir?: Directory){
        super(fileName, false, parentDir);
    }
}