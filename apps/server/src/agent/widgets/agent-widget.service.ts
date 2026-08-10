import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.module.js';

export interface CreateComponentInput {
  widgetType: string;
  kbId: string;
  title: string;
  sourceCode: string;
  jsCodeGzip: Uint8Array;
  propsSchema?: unknown;
}

@Injectable()
export class AgentWidgetService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /** 生成模式：创建 DRAFT 组件，用户确认提案后才激活。 */
  async createComponent(input: CreateComponentInput) {
    return this.prisma.agentComponent.create({
      data: {
        widgetType: input.widgetType,
        kbId: input.kbId,
        title: input.title,
        version: 1,
        sourceCode: input.sourceCode,
        jsCodeGzip: Buffer.from(input.jsCodeGzip),
        propsSchema: input.propsSchema as object | undefined,
        status: 'DRAFT',
      },
    });
  }

  /**
   * 确认提案时激活组件。widgetType 非唯一字段（widgetType+version 联合唯一），
   * 因此用 updateMany 按 status DRAFT 定位；复用模式（已 ACTIVE）自然为 no-op。
   */
  async activateComponent(widgetType: string) {
    await this.prisma.agentComponent.updateMany({
      where: { widgetType, status: 'DRAFT' },
      data: { status: 'ACTIVE' },
    });
  }

  /** 组件目录：知识库内 ACTIVE 组件，供 Agent 复用决策。 */
  async listActive(kbId: string) {
    return this.prisma.agentComponent.findMany({
      where: { kbId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: {
        widgetType: true,
        title: true,
        version: true,
        propsSchema: true,
      },
    });
  }

  /** 复用校验：widgetType 在该知识库存在且 ACTIVE，返回组件行（含 title 供评审展示）。 */
  async findActiveForReuse(widgetType: string, kbId: string) {
    return this.prisma.agentComponent.findFirst({
      where: { widgetType, kbId, status: 'ACTIVE' },
    });
  }

  /** 详情：widgetType 的 ACTIVE 版本，供前端渲染拉取 jsCode。 */
  async getActive(widgetType: string) {
    return this.prisma.agentComponent.findFirst({
      where: { widgetType, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
  }
}
