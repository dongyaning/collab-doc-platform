import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { FilesController } from './files.controller.js';
import { FilesService } from './files.service.js';
import { FileStorageService } from './file-storage.service.js';
import { LocalStorageService } from './local-storage.service.js';

@Module({
  imports: [
    ConfigModule,
    MulterModule.register({
      storage: memoryStorage(),
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  ],
  controllers: [FilesController],
  providers: [
    FilesService,
    {
      provide: FileStorageService,
      useFactory: (config: ConfigService) => {
        const dir = config.get<string>('FILE_STORAGE_LOCAL_DIR', './uploads');
        return new FileStorageService(new LocalStorageService(dir), dir);
      },
      inject: [ConfigService],
    },
  ],
  exports: [FileStorageService],
})
export class FilesModule {}
