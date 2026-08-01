import {
  SaveFile,
  SelectDirectory,
  SelectFile,
  ShowMessage,
} from '../../../wailsjs/go/dialogs/Service';
import { OpenExternal, RevealInFinder } from '../../../wailsjs/go/shellapi/Service';
import type { MessageOptions } from './types';

/** Returns '' when the user cancels — a normal outcome, not an error. */
export function selectDirectory(title: string, defaultDir = ''): Promise<string> {
  return SelectDirectory(title, defaultDir);
}

export function selectFile(title: string, defaultDir = ''): Promise<string> {
  return SelectFile(title, defaultDir);
}

export function saveFile(title: string, defaultDir = '', defaultFilename = ''): Promise<string> {
  return SaveFile(title, defaultDir, defaultFilename);
}

/** Resolves to the label of the button the user chose. */
export function showMessage(opts: MessageOptions): Promise<string> {
  return ShowMessage(opts);
}

/** Rejects for any scheme other than http/https/mailto — repository data is untrusted. */
export function openExternal(url: string): Promise<void> {
  return OpenExternal(url);
}

export function revealInFinder(path: string): Promise<void> {
  return RevealInFinder(path);
}
