import type { Readable } from 'node:stream';
import { LocalStorageService } from './local-storage.service.js';

export class FileStorageService {
  constructor(
    private readonly driver: LocalStorageService,
    private readonly localDir: string
  ) {}

  getLocalDir(): string {
    return this.localDir;
  }

  async save(filename: string, mimeType: string, stream: Readable) {
    return this.driver.save(filename, mimeType, stream);
  }

  async delete(storagePath: string) {
    return this.driver.delete(storagePath);
  }
}
