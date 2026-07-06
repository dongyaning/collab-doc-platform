import { createWriteStream, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import type { FileStorageDriver, UploadResult } from './file-storage.interface.js';

export class LocalStorageService implements FileStorageDriver {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  async save(filename: string, _mimeType: string, stream: Readable): Promise<UploadResult> {
    const ext = extname(filename) || '';
    const datePath = new Date().toISOString().slice(0, 10).replace(/-/g, '/');
    const dir = join(this.baseDir, datePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const storageName = `${crypto.randomUUID()}${ext}`;
    const storagePath = `${datePath}/${storageName}`;
    const filePath = join(this.baseDir, storagePath);

    const writeStream = createWriteStream(filePath);
    await pipeline(stream, writeStream);

    return {
      url: `/uploads/${storagePath}`,
      storagePath,
      storageType: 'local',
    };
  }

  async delete(storagePath: string): Promise<void> {
    const filePath = join(this.baseDir, storagePath);
    try {
      unlinkSync(filePath);
    } catch {
      // file may already be deleted
    }
  }

  async read(storagePath: string): Promise<Buffer> {
    return readFile(join(this.baseDir, storagePath));
  }
}
