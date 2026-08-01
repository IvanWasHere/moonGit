import { Available, Delete, Get, Set } from '../../../wailsjs/go/creds/Service';
import type { Secret } from './types';

/** Secrets live only in the OS keychain — never in SQLite or any file we write. */
export function setSecret(key: string, value: string): Promise<void> {
  return Set(key, value);
}

/** A missing entry resolves with found:false rather than rejecting. */
export function getSecret(key: string): Promise<Secret> {
  return Get(key);
}

export function deleteSecret(key: string): Promise<void> {
  return Delete(key);
}

/** False in a headless session or when the login keychain is locked. */
export function keychainAvailable(): Promise<boolean> {
  return Available();
}
