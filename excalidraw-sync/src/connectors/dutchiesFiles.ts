import { File, Folder, FileItem } from "../models/files";
import { ExtensionContext, Memento, SecretStorage, Uri, window } from "vscode";
import { LocalFilesMirror, LocalFileData } from "./localFiles";

const DUTCHIES_ROOT_FOLDER = "https://files.dutchie031.com/api/files/excalidraw";
const DUTCHIES_DOWNLOAD_ROOT_FOLDER = "https://files.dutchie031.com/api/download/excalidraw";


export class DutchiesFilesConnector {

    globalState: Memento;
    secretStorage: SecretStorage;
    apiKey : string | undefined;
    localFilesMirror: LocalFilesMirror;
    
    constructor(context: ExtensionContext, localFilesMirror: LocalFilesMirror) {
        this.globalState = context.globalState;
        this.secretStorage = context.secrets;
        this.localFilesMirror = localFilesMirror;

        context.secrets.get('dutchiesFilesApiKey').then(key => {
            if(!key){
                window.showErrorMessage('No API key found for DutchiesFiles. Please set it up in the extension settings.');
            }
            this.apiKey = key;
        });
    }

    async setApiKey(apiKey: string) {
        await this.secretStorage.store('dutchiesFilesApiKey', apiKey);
        this.apiKey = apiKey;
    }
    
    async createFolder(folder: Folder): Promise<void> {
        const url = `${DUTCHIES_ROOT_FOLDER}/${folder.path}`;
        const result = await fetch(url, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey || ''
            }
        });
        if (!result.ok && result.status !== 202) {
            throw new Error(`Failed to create folder: ${result.status} ${result.statusText} \n ${await result.text()}`);
        }
    }

    async updateFile(file: File, content: Uint8Array): Promise<void> {
        const url = `${DUTCHIES_ROOT_FOLDER}/${file.path}?overwrite=true`;
        const formData = new FormData();
        // The backend expects the file under the "File" form field
        formData.append("File", new Blob([content]), file.name);

        const result = await fetch(url, {
            method: 'POST',
            headers: {
                'X-API-Key': this.apiKey || ''
            },
            body: formData
        });
        if (!result.ok && result.status !== 202) {
            throw new Error(`Failed to upload file: ${result.status} ${result.statusText} \n ${await result.text()}`);
        }
    }

    async deleteFile(file: File): Promise<void> {

        const url = `${DUTCHIES_ROOT_FOLDER}/${file.path}`;

        const result = await fetch(url, {
            method: 'DELETE',
            headers: {
                'X-API-Key': this.apiKey || ''
            }
        });
        if(!result.ok){
            throw new Error(`Failed to delete file from DutchiesFiles: ${result.status} ${result.statusText} \n ${await result.text()}`);
        }

    }

    async getAndSyncLocalFilePath(file: File) : Promise<Uri> {
        if(!await this.localFilesMirror.isExist(file)){
            // File does not exist locally, fetch content from remote and create local file
            const content = await this.getFileContent(file);
            await this.localFilesMirror.syncFile(file, content);
            return this.localFilesMirror.toFileUri(file);
        } else {
            // File exists locally, check if it's up to date with the remote version
            const localFileData = await this.localFilesMirror.getFileData(file);
            const remoteFileData = await this.getFileData(file);
            if (localFileData.sha256 !== remoteFileData.sha256Hash) {
                if(remoteFileData.lastModified > localFileData.lastModified){
                    // Remote file is newer, update local file
                    const content = await this.getFileContent(file);
                    await this.localFilesMirror.syncFile(file, content);
                    return this.localFilesMirror.toFileUri(file);
                } else {
                    // Local file is newer, update remote file
                    const content = await this.localFilesMirror.getFileData(file);
                    const fileContent = await this.localFilesMirror.getFileContent(file);
                    await this.updateFile(file, fileContent);
                    return this.localFilesMirror.toFileUri(file);
                }
            }
            return this.localFilesMirror.toFileUri(file);
        }
    }
    
    private async getFileData(file: File) : Promise<GetFileResult> {
        const url = `${DUTCHIES_ROOT_FOLDER}/${file.path}`;
        const result = await fetch(url, {
            method: 'GET',
            headers: {
                'X-API-Key': this.apiKey || ''
            }
        });
        if(!result.ok){
            throw new Error(`Failed to fetch file data from DutchiesFiles: ${result.status} ${result.statusText}`);
        }
        const data = await result.json() as GetFileResult;
        if(data.isDirectory){
            throw new Error('Expected a file but got a directory when fetching from DutchiesFiles');
        }
        return data;
    }

    private async getFileContent(file: File): Promise<Uint8Array> {
        const url = `${DUTCHIES_DOWNLOAD_ROOT_FOLDER}/${file.path}`;
        const result = await fetch(url, {
            method: 'GET',
            headers: {
                'X-API-Key': this.apiKey || ''
            }
        });
        if(!result.ok){
            throw new Error(`Failed to fetch file content from DutchiesFiles: ${result.status} ${result.statusText}`);
        }
        const arrayBuffer = await result.arrayBuffer();
        return new Uint8Array(arrayBuffer);
    }

    async getFilesInDirectory(directory?: Folder): Promise<FileItem[]> {
        
        let url = DUTCHIES_ROOT_FOLDER;
        if (directory) {
            url += `/${directory.path}`;
        }

        const result = await fetch(url, {
            method: 'GET',
            headers: {
                'X-API-Key': this.apiKey || ''
            }
        });
        if(!result.ok){
            throw new Error(`Failed to fetch files from DutchiesFiles: ${result.status} ${result.statusText}`);
        }

        const data = await result.json() as GetFileDirectoryResult | GetFileResult;
        if(data.isDirectory){
            const directoryData = data as GetFileDirectoryResult;
            const items = directoryData.children.map(child => {
                if(child.isDirectory){
                    return new Folder(child.name, `${directory ? directory.path + '/' : ''}${child.name}`);
                } else {
                    return new File(child.name, `${directory ? directory.path + '/' : ''}${child.name}`);
                }
            });
            return Promise.resolve(items);
        } else {
            throw new Error('Expected a directory but got a file when fetching from DutchiesFiles');
        }
    }
}


interface GetFilesResult {
    isDirectory: boolean;
}

interface GetFileChildItem {
    name: string;
    isDirectory: boolean;
    sha256Hash: string;
}

interface GetFileDirectoryResult extends GetFilesResult {
    name: string;
    lastModified: string; // Use string for ISO date, or Date if you parse it
    children: GetFileChildItem[];
}

interface GetFileResult extends GetFilesResult {
    name: string;
    lastModified: Date; // Use string for ISO date, or Date if you parse it
    size: number;
    sha256Hash: string;
}
