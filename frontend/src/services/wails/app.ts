import { Environment } from '../../../wailsjs/go/main/App';
import type { Environment as Env } from './types';

export function environment(): Promise<Env> {
  return Environment();
}
