import { Readable } from 'node:stream';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { FileStorageService } from './file-storage.service.js';

interface UploadFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Injectable()
export class FilesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(FileStorageService) private readonly storage: FileStorageService
  ) {}

  async upload(file: UploadFile, uploadedById: string) {
    const stream = Readable.from(file.buffer);
    const result = await this.storage.save(file.originalname, file.mimetype, stream);

    const record = await this.prisma.fileStorage.create({
      data: {
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        storageType: result.storageType,
        storagePath: result.storagePath,
        url: result.url,
        uploadedById,
      },
    });

    return record;
  }

  async delete(id: string) {
    const record = await this.prisma.fileStorage.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('File not found');
    await this.storage.delete(record.storagePath);
    await this.prisma.fileStorage.delete({ where: { id } });
  }
}
