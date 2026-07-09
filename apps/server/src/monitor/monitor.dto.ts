import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import type { MonitorEventType } from '@wiseflow/shared';

const EVENT_TYPES: MonitorEventType[] = [
  'web_vital',
  'resource',
  'request',
  'error',
  'business',
  'custom',
];

export class MonitorEventDto {
  @IsOptional()
  @IsString()
  eventId?: string;

  @IsIn(EVENT_TYPES)
  eventType!: MonitorEventType;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  app?: string;

  @IsOptional()
  @IsNumber()
  timestamp?: number;

  @IsOptional()
  @IsIn(['ok', 'error'])
  status?: 'ok' | 'error';

  @IsOptional()
  @IsNumber()
  value?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  duration?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  anonymousId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  sessionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  pageViewId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  traceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(240)
  route?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  docId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  method?: string;

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(599)
  statusCode?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  errorMessage?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  browser?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  os?: string;
}

export class IngestMonitorEventsDto {
  @IsString()
  @MaxLength(80)
  app!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MonitorEventDto)
  events!: MonitorEventDto[];
}

export class MonitorQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  docId?: string;

  @IsOptional()
  @IsIn(EVENT_TYPES)
  eventType?: MonitorEventType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}
