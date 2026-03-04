
export abstract class FileItem {
    name: string;
    path: string;
    isDirectory: boolean;

    constructor(name: string, path: string, isDirectory: boolean) {
        this.name = name;
        this.path = path;
        this.isDirectory = isDirectory;
    }
}

export class File extends FileItem {
    constructor(name: string, path: string) {
        super(name, path, false);
    }
}

export class Folder extends FileItem {
    constructor(name: string, path: string) {
        super(name, path, true);
    }
}