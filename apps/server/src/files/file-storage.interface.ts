import type { Readable } from 'node:stream';

export interface UploadResult {
  /** Publicly accessible URL. */
  url: string;
  /** Relative storage path (e.g. "2026/07/06/uuid.ext") or S3 object key. */
  storagePath: string;
  /** Driver name: "local" | "s3". */
  storageType: string;
}

export interface FileStorageDriver {
  /** Save a file stream and return metadata. */
  save(filename: string, mimeType: string, stream: Readable): Promise<UploadResult>;
  /** Delete a file by its storage path. */
  delete(storagePath: string): Promise<void>;
}
