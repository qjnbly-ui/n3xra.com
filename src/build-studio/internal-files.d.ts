  export function startFiles(options: any): Promise<void>;
  export function selectedInternalFiles(): any[];
  export function openInternalFilesFolder(websiteId: string): Promise<void>;
  export function internalFileDownload(file: any): Promise<{url: string}>;
