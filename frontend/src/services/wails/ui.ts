import {
  SaveFile,
  SelectDirectory,
  SelectFile,
  ShowMessage,
} from '../../../wailsjs/go/dialogs/Service';
import {
  OpenExternal,
  OpenInEditor,
  OpenPath,
  OpenTerminal,
  RevealInFinder,
} from '../../../wailsjs/go/shellapi/Service';
import { ClipboardSetText } from '../../../wailsjs/runtime/runtime';
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

/**
 * Open a local file or directory with the OS default handler.
 *
 * Separate from `openExternal` on purpose: that one refuses every scheme but
 * http/https/mailto so a hostile remote URL cannot become a local `open`. This
 * takes a path, and its callers pass paths that came from `git status` rather
 * than from repository content naming its own target.
 */
export function openPath(path: string): Promise<void> {
  return OpenPath(path);
}

/** Open a terminal with its working directory set to `dir`. */
export function openTerminal(dir: string): Promise<void> {
  return OpenTerminal(dir);
}

/**
 * Put text on the system clipboard.
 *
 * Through the Wails runtime rather than `navigator.clipboard`, which needs a
 * secure context and a permission the webview does not grant.
 */
export function copyToClipboard(text: string): Promise<boolean> {
  return ClipboardSetText(text);
}

/**
 * Open a file with the user's configured editor command, falling back to the
 * OS default when none is set.
 *
 * The fallback lives here rather than at each call site: "open this file" is
 * one intention, and every caller having to remember to check the preference
 * is how one of them ends up not doing it.
 */
export function openInEditor(path: string, command: string): Promise<void> {
  return command.trim() === '' ? OpenPath(path) : OpenInEditor(command, path);
}
