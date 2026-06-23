import { Controller, Get } from '@nestjs/common';
import { PROJECT_NAME } from '@collab/shared';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { project: PROJECT_NAME, milestone: 'M1', ok: true };
  }
}
