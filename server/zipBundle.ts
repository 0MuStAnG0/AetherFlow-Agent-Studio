import AdmZip from 'adm-zip';
import type { BundleFileEntry } from '../src/utils/exportBundle.ts';

export function createZipBufferFromBundle(files: BundleFileEntry[]): Buffer {
  const zip = new AdmZip();
  for (const file of files) {
    zip.addFile(file.path, Buffer.from(file.content, 'utf-8'));
  }
  return zip.toBuffer();
}
