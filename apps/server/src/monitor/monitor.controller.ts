import {
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { IngestMonitorEventsDto, MonitorQueryDto } from './monitor.dto.js';
import { MonitorService } from './monitor.service.js';

@Controller('monitor')
export class MonitorController {
  constructor(@Inject(MonitorService) private readonly monitor: MonitorService) {}

  @Post('events')
  ingest(@Body() dto: IngestMonitorEventsDto) {
    return this.monitor.ingest(dto);
  }

  @Get('summary')
  summary(@Query() query: MonitorQueryDto) {
    return this.monitor.summary(query);
  }

  @Get('trends')
  trends(@Query() query: MonitorQueryDto) {
    return this.monitor.trends(query);
  }

  @Get('slow-requests')
  slowRequests(@Query() query: MonitorQueryDto) {
    return this.monitor.slowRequests(query);
  }

  @Get('slow-docs')
  slowDocs(@Query() query: MonitorQueryDto) {
    return this.monitor.slowDocs(query);
  }

  @Get('errors')
  errors(@Query() query: MonitorQueryDto) {
    return this.monitor.errors(query);
  }

  @Get('events/:id')
  async findOne(@Param('id') id: string) {
    const event = await this.monitor.findOne(id);
    if (!event) {
      throw new NotFoundException();
    }
    return event;
  }
}
