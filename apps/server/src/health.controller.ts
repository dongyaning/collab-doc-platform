import { Controller, Get } from '@nestjs/common';
import { PROJECT_NAME } from '@wiseflow/shared';

@Controller('health')
export class HealthController {
  @Get()
  health() {
    return { project: PROJECT_NAME, milestone: 'M2', ok: true };
  }
}
