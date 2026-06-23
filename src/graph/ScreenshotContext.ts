import * as vscode from 'vscode';

export interface ScreenshotContext {
  path: string;
  mediaType: string;
  dataUrl: string;
}

const SUPPORTED_EXTENSIONS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

let lastScreenshotPath: string | undefined;

export async function pickScreenshot(): Promise<ScreenshotContext | undefined> {
  const selected = await vscode.window.showOpenDialog({
    canSelectFiles: true,
    canSelectFolders: false,
    canSelectMany: false,
    title: 'Select LD/FBD screenshot for graph prediction',
    filters: {
      Images: ['png', 'jpg', 'jpeg', 'webp'],
    },
  });

  const uri = selected?.[0];
  if (!uri) {
    return undefined;
  }

  lastScreenshotPath = uri.fsPath;
  return loadScreenshot(uri.fsPath);
}

export async function loadLastScreenshot(): Promise<ScreenshotContext | undefined> {
  return lastScreenshotPath ? loadScreenshot(lastScreenshotPath) : undefined;
}

async function loadScreenshot(filePath: string): Promise<ScreenshotContext> {
  const mediaType = mediaTypeFromPath(filePath);
  if (!mediaType) {
    throw new Error('Unsupported screenshot file type. Use png, jpg, jpeg, or webp.');
  }

  const bytes = await vscode.workspace.fs.readFile(vscode.Uri.file(filePath));
  const base64 = Buffer.from(bytes).toString('base64');

  return {
    path: filePath,
    mediaType,
    dataUrl: `data:${mediaType};base64,${base64}`,
  };
}

function mediaTypeFromPath(filePath: string): string | undefined {
  const normalized = filePath.toLowerCase();
  const dotIndex = normalized.lastIndexOf('.');
  const extension = dotIndex >= 0 ? normalized.slice(dotIndex) : '';

  return SUPPORTED_EXTENSIONS[extension];
}
