import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import { AgentService } from './agent.service.js';
import { ModelProviderFactory } from './model-provider.factory.js';

function createService() {
  const conversation = {
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  };
  const prisma = {
    agentConversation: conversation,
    agentRun: { create: vi.fn(), update: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
    agentProposal: { create: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
  };
  return { service: new AgentService(prisma as never), prisma };
}

describe('ModelProviderFactory', () => {
  it('declares ConfigService as an explicit constructor dependency', () => {
    expect(Reflect.getMetadata('self:paramtypes', ModelProviderFactory)).toEqual([
      { index: 0, param: ConfigService },
    ]);
  });
});

describe('AgentService conversations', () => {
  it('creates a conversation for a user scoped to a knowledge base', async () => {
    const { service, prisma } = createService();

    await service.createConversation('u1', 'kb1');

    expect(prisma.agentConversation.create).toHaveBeenCalledWith({
      data: { userId: 'u1', kbId: 'kb1' },
    });
  });

  it('lists conversations filtered by user and kb, newest message first', async () => {
    const { service, prisma } = createService();

    await service.listConversations('u1', 'kb1');

    expect(prisma.agentConversation.findMany).toHaveBeenCalledWith({
      where: { userId: 'u1', kbId: 'kb1' },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
    });
  });

  it('lists runs of a conversation with proposals, oldest first', async () => {
    const { service, prisma } = createService();

    await service.listConversationRuns('conv-1');

    expect(prisma.agentRun.findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conv-1' },
      orderBy: { createdAt: 'asc' },
      include: { proposals: true },
    });
  });

  it('touches lastMessageAt when a run starts', async () => {
    const { service, prisma } = createService();

    await service.touchConversation('conv-1');

    expect(prisma.agentConversation.update).toHaveBeenCalledWith({
      where: { id: 'conv-1' },
      data: { lastMessageAt: expect.any(Date) },
    });
  });

  it('updates the default title once with the first message truncated to 20 chars', async () => {
    const { service, prisma } = createService();
    const longMessage = '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十';

    await service.updateTitleIfDefault('conv-1', longMessage);

    expect(prisma.agentConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', title: '新会话' },
      data: { title: '一二三四五六七八九十一二三四五六七八九十' },
    });
  });

  it('leaves non-default titles untouched', async () => {
    const { service, prisma } = createService();

    await service.updateTitleIfDefault('conv-1', 'hello');

    expect(prisma.agentConversation.updateMany).toHaveBeenCalledWith({
      where: { id: 'conv-1', title: '新会话' },
      data: { title: 'hello' },
    });
  });
});
