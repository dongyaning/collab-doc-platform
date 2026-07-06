import { Controller, Inject, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser, type AuthUser } from '../auth/current-user.decorator.js';
import { FilesService } from './files.service.js';

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@UseGuards(JwtAuthGuard)
@Controller('files')
export class FilesController {
  constructor(@Inject(FilesService) private readonly files: FilesService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@CurrentUser() user: AuthUser, @UploadedFile() file: MulterFile) {
    if (!file) {
      return { error: 'No file provided' };
    }
    const record = await this.files.upload(file, user.id);
    return { id: record.id, url: record.url, originalName: record.originalName, size: record.size };
  }
}
