import { ExtensionContext, Uri, workspace } from "vscode";
import { File, Folder, FileItem } from "../models/files";

import * as crypto from 'crypto';

export class LocalFilesMirror {
    
    private storagePath : Uri;

    constructor(context:ExtensionContext) {
        this.storagePath = context.globalStorageUri;
    }

    async syncFile(file: File, content: Uint8Array) : Promise<void> {
        const fileUri = this.toFileUri(file);
        await workspace.fs.writeFile(fileUri, content);
    }

    async deleteFile(file: File) : Promise<void> {
        const fileUri = this.toFileUri(file);
        await workspace.fs.delete(fileUri);
    }

    async getFileContent(file: File) : Promise<Uint8Array> {
        const fileUri = this.toFileUri(file);
        const content = await workspace.fs.readFile(fileUri);
        return content;
    }

    async isExist(file: File) : Promise<boolean> {
        const fileUri = this.toFileUri(file);
        try {
            await workspace.fs.stat(fileUri);
            return true;
        } catch (error) {
            return false;
        }
    }

    async getFileData(file: File) : Promise<LocalFileData> {
        const fileUri = this.toFileUri(file);
        const stat = await workspace.fs.stat(fileUri);
        const content = await workspace.fs.readFile(fileUri);
        const sha256 = await this.calculateSHA256(content);
        const modifiedTime = new Date(stat.mtime);
        return new LocalFileData(modifiedTime, sha256);
    }

    private async calculateSHA256(content: Uint8Array): Promise<string> {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    toPath(file: File) : string {
        return `${this.storagePath.fsPath}/${file.path}`;
    }

    toFileUri(file: File) : Uri {
        return Uri.file(this.toPath(file));
    }
}

export class LocalFileData {
    
    lastModified: Date;
    sha256: string;

    constructor(lastModified: Date, sha256: string) {
        this.lastModified = lastModified;
        this.sha256 = sha256;  
    }

}