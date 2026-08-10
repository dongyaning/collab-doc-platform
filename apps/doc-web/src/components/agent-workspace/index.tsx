import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import { Alert, App as AntdApp, Button, Empty, Input, Spin, Tag, Typography } from 'antd';
import {
  CheckOutlined,
  MessageOutlined,
  PlusOutlined,
  SendOutlined,
  StopOutlined,
} from '@ant-design/icons';
import { agentApi, type RunRecord } from '../../agent/agent.api';
import type {
  AgentEvent,
  AgentProposal,
  AgentSelection,
  ChatMessage,
  ConversationSummary,
  ViewProposal,
} from '../../agent/agent.types';
import type { ChangeSetItem } from '../../agent/review/apply-change-set';
import { ReviewViewer } from '../review-viewer';
import styles from './index.module.less';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;

/** summarizing 事件期间的占位文案，首条 token 到达时被覆盖。 */
const SUMMARIZING_TEXT = '正在总结对话内容中...';

interface AgentWorkspaceProps {
  kbId: string;
  nodeId: string;
  nodeVersion: number;
  editor: Editor;
  selection?: AgentSelection | null;
}

function toViewProposal(proposal: AgentProposal): ViewProposal {
  return {
    ...proposal,
    patch: {
      edits: proposal.patch.edits.map((edit, index) => ({
        ...edit,
        editId: `${proposal.proposalId}-${index}`,
      })),
    },
  };
}

/** 用历史 runs 重建消息流；finalAnswer 为空的 run 渲染为错误气泡。 */
function rebuildHistory(runs: RunRecord[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const run of runs) {
    messages.push({
      id: `run-${run.id}-user`,
      role: 'user',
      content: run.message,
      status: 'done',
    });
    const assistant: ChatMessage = {
      id: `run-${run.id}-assistant`,
      role: 'assistant',
      content: run.finalAnswer ?? '',
      status: 'done',
    };
    if (!run.finalAnswer) {
      assistant.status = 'error';
      assistant.error = run.error ?? '该轮对话失败';
    }
    const lastProposal = run.proposals[run.proposals.length - 1];
    if (lastProposal) {
      assistant.proposal = toViewProposal({
        proposalId: lastProposal.id,
        runId: run.id,
        nodeId: lastProposal.nodeId,
        baseVersion: lastProposal.baseVersion,
        patch: lastProposal.patch as AgentProposal['patch'],
      });
    }
    messages.push(assistant);
  }
  return messages;
}

export function AgentWorkspace({
  kbId,
  nodeId,
  nodeVersion,
  editor,
  selection,
}: AgentWorkspaceProps) {
  const { message: messageApi } = AntdApp.useApp();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [runState, setRunState] = useState<'idle' | 'running'>('idle');
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeConversationIdRef = useRef<string | null>(null);
  activeConversationIdRef.current = activeConversationId;

  // 评审视图：一次评审期（从首个提案到确认/拒绝），同一会话多次 run 的 edits 累积
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewBaseJson, setReviewBaseJson] = useState<JSONContent | null>(null);
  const [changeSet, setChangeSet] = useState<ChangeSetItem[]>([]);
  const reviewBaseJsonSetRef = useRef(false);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, runState]);

  // 加载会话列表，默认选中最近一个
  useEffect(() => {
    let cancelled = false;
    agentApi
      .listConversations(kbId)
      .then((items) => {
        if (cancelled) {
          return;
        }
        setConversations(items);
        if (items.length > 0 && !activeConversationIdRef.current) {
          setActiveConversationId(items[0].id);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHistoryError('会话列表加载失败');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [kbId]);

  const selectConversation = useCallback(async (conversationId: string) => {
    abortRef.current?.abort();
    setActiveConversationId(conversationId);
    setMessages([]);
    setHistoryLoading(true);
    setHistoryError('');
    // 切换会话时结束当前评审期
    setReviewOpen(false);
    setChangeSet([]);
    setReviewBaseJson(null);
    reviewBaseJsonSetRef.current = false;
    try {
      const runs = await agentApi.listRuns(conversationId);
      setMessages(rebuildHistory(runs));
    } catch {
      setHistoryError('历史消息加载失败');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const newConversation = useCallback(async () => {
    abortRef.current?.abort();
    try {
      const conversation = await agentApi.createConversation(kbId);
      setConversations((prev) => [conversation, ...prev]);
      setActiveConversationId(conversation.id);
      setMessages([]);
      setHistoryError('');
    } catch {
      messageApi.error('创建会话失败');
    }
  }, [kbId, messageApi]);

  const patchLastAssistantMessage = useCallback((patch: (message: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') {
        return prev;
      }
      return [...prev.slice(0, -1), patch(last)];
    });
  }, []);

  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'token':
        patchLastAssistantMessage((last) => ({
          ...last,
          content: last.content === SUMMARIZING_TEXT ? event.text : last.content + event.text,
        }));
        break;
      case 'summarizing':
        patchLastAssistantMessage((last) => ({
          ...last,
          content: SUMMARIZING_TEXT,
        }));
        break;
      case 'proposal_ready': {
        const viewProposal = toViewProposal({
          proposalId: event.proposalId,
          runId: event.runId,
          nodeId: event.nodeId,
          baseVersion: event.baseVersion,
          patch: event.patch as AgentProposal['patch'],
        });
        patchLastAssistantMessage((last) => ({ ...last, proposal: viewProposal }));
        // 首次提案时记录评审基线快照，后续 run 的 edits 累积进同一变更集
        if (editor && !reviewBaseJsonSetRef.current) {
          reviewBaseJsonSetRef.current = true;
          setReviewBaseJson(editor.getJSON() as JSONContent);
        }
        setChangeSet((prev) => [
          ...prev,
          { proposalId: event.proposalId, edits: viewProposal.patch.edits },
        ]);
        setReviewOpen(true);
        break;
      }
      case 'final_answer':
        patchLastAssistantMessage((last) => ({ ...last, content: event.text }));
        break;
      case 'tool_error':
        patchLastAssistantMessage((last) => ({
          ...last,
          status: 'error',
          error: event.error,
        }));
        setRunState('idle');
        break;
      case 'run_completed':
        if (event.reason === 'error') {
          patchLastAssistantMessage((last) => ({
            ...last,
            status: 'error',
            error: event.error ?? 'Agent run failed',
          }));
        } else {
          patchLastAssistantMessage((last) => ({ ...last, status: 'done' }));
        }
        setRunState('idle');
        break;
      default:
        break;
    }
  };

  const startRun = async () => {
    const command = input.trim();
    if (!command || runState === 'running') {
      return;
    }

    // 无会话时先创建
    let conversationId = activeConversationId;
    if (!conversationId) {
      const conversation = await agentApi.createConversation(kbId);
      setConversations((prev) => [conversation, ...prev]);
      setActiveConversationId(conversation.id);
      conversationId = conversation.id;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setInput('');
    setHistoryError('');
    setRunState('running');

    const userMessage: ChatMessage = {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: command,
      status: 'done',
      selectionContent: selection?.content,
    };
    const assistantMessage: ChatMessage = {
      id: `local-assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
      status: 'streaming',
    };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    try {
      await agentApi.run(
        {
          conversationId,
          message: command,
          kbId,
          nodeId,
          nodeBaseVersion: nodeVersion,
          selection: selection ?? undefined,
        },
        onEvent,
        abort.signal
      );
    } catch (runError) {
      if (abort.signal.aborted) {
        patchLastAssistantMessage((last) => ({
          ...last,
          status: last.content ? 'done' : 'error',
          error: last.content ? undefined : '已停止',
        }));
        setRunState('idle');
        return;
      }
      patchLastAssistantMessage((last) => ({
        ...last,
        status: 'error',
        error: runError instanceof Error ? runError.message : 'Agent run failed',
      }));
      setRunState('idle');
    }
  };

  const handleReviewConfirmed = useCallback(
    async (proposalIds: string[]) => {
      for (const proposalId of proposalIds) {
        await agentApi.acknowledgeApplied(proposalId).catch(() => undefined);
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.proposal && proposalIds.includes(msg.proposal.proposalId)
            ? { ...msg, status: 'done', proposalOutcome: 'applied' }
            : msg
        )
      );
      setChangeSet([]);
      setReviewBaseJson(null);
      reviewBaseJsonSetRef.current = false;
      messageApi.success('Agent edit applied');
    },
    [messageApi]
  );

  const handleReviewRejected = useCallback(
    async (proposalIds: string[]) => {
      for (const proposalId of proposalIds) {
        await agentApi.rejectProposal(proposalId).catch(() => undefined);
      }
      setMessages((prev) =>
        prev.map((msg) =>
          msg.proposal && proposalIds.includes(msg.proposal.proposalId)
            ? { ...msg, status: 'done', proposalOutcome: 'rejected' }
            : msg
        )
      );
      setChangeSet([]);
      setReviewBaseJson(null);
      reviewBaseJsonSetRef.current = false;
      messageApi.info('Agent edit rejected');
    },
    [messageApi]
  );

  const renderProposal = (message: ChatMessage) => {
    const proposal = message.proposal;
    if (!proposal) {
      return null;
    }
    return (
      <div className={styles.proposalSection}>
        <div className={styles.sectionHeader}>
          <Text strong>Proposed change</Text>
          {message.proposalOutcome === 'applied' ? (
            <Tag color="green">Applied</Tag>
          ) : message.proposalOutcome === 'rejected' ? (
            <Tag>Rejected</Tag>
          ) : (
            <Tag color="blue">待评审</Tag>
          )}
        </div>
        {!message.proposalOutcome ? (
          <Button
            size="small"
            icon={<CheckOutlined />}
            disabled={runState === 'running'}
            onClick={() => setReviewOpen(true)}
          >
            在文档中查看与确认变更
          </Button>
        ) : null}
      </div>
    );
  };

  const renderMessage = (message: ChatMessage) => {
    if (message.role === 'user') {
      return (
        <div key={message.id} className={`${styles.messageRow} ${styles.userRow}`}>
          <div className={`${styles.bubble} ${styles.userBubble}`}>
            <Paragraph className={styles.bubbleText}>{message.content}</Paragraph>
            {message.selectionContent ? (
              <Text className={styles.selectionHint} type="secondary">
                引用: {message.selectionContent}
              </Text>
            ) : null}
          </div>
        </div>
      );
    }
    return (
      <div key={message.id} className={`${styles.messageRow} ${styles.assistantRow}`}>
        <div className={`${styles.bubble} ${styles.assistantBubble}`}>
          {message.status === 'error' ? (
            <>
              <Alert type="error" title={message.error ?? 'Agent run failed'} showIcon />
              {message.content ? (
                <div className={styles.markdown}>
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.markdown}>
              <ReactMarkdown>{message.content}</ReactMarkdown>
              {message.status === 'streaming' ? <span className={styles.cursor} /> : null}
            </div>
          )}
          {renderProposal(message)}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.chatPanel}>
      <aside className={styles.sessionList}>
        <Button
          type="primary"
          block
          icon={<PlusOutlined />}
          onClick={newConversation}
          disabled={runState === 'running'}
        >
          新建会话
        </Button>
        <div className={styles.sessionItems}>
          {conversations.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无会话"
              className={styles.sessionEmpty}
            />
          ) : (
            <div className={styles.sessionListItems}>
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  className={
                    conversation.id === activeConversationId
                      ? styles.sessionItemActive
                      : styles.sessionItem
                  }
                  onClick={() => selectConversation(conversation.id)}
                >
                  <Text ellipsis={{ tooltip: conversation.title }} className={styles.sessionTitle}>
                    {conversation.title}
                  </Text>
                </button>
              ))}
            </div>
          )}
        </div>
      </aside>

      <main className={styles.chatMain}>
        {historyLoading ? (
          <div className={styles.centerState}>
            <Spin />
          </div>
        ) : messages.length === 0 && !historyError ? (
          <div className={styles.centerState}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <span>
                  <MessageOutlined /> 开始与 AI 对话
                  {selection ? '（已带上当前选区上下文）' : ''}
                </span>
              }
            />
          </div>
        ) : (
          <div className={styles.messageList}>
            {messages.map(renderMessage)}
            {runState === 'running' ? (
              <div className={styles.typingHint}>AI 正在思考...</div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>
        )}

        {historyError ? <Alert type="error" title={historyError} showIcon /> : null}

        <div className={styles.inputArea}>
          <TextArea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="输入指令，与 AI 对话..."
            autoSize={{ minRows: 2, maxRows: 5 }}
            disabled={runState === 'running'}
            onPressEnter={(event) => {
              if (!event.shiftKey) {
                event.preventDefault();
                void startRun();
              }
            }}
          />
          <div className={styles.inputActions}>
            <Text type="secondary" className={styles.inputHint}>
              Enter 发送，Shift+Enter 换行
            </Text>
            <Button
              type="primary"
              icon={runState === 'running' ? <StopOutlined /> : <SendOutlined />}
              onClick={runState === 'running' ? () => abortRef.current?.abort() : startRun}
              disabled={!input.trim() && runState !== 'running'}
            >
              {runState === 'running' ? '停止' : '发送'}
            </Button>
          </div>
        </div>
      </main>

      <ReviewViewer
        open={reviewOpen}
        editor={editor}
        baseJson={reviewBaseJson}
        changeSet={changeSet}
        confirmProposals={async (proposalIds) => {
          let lastError: unknown = null;
          for (const proposalId of proposalIds) {
            try {
              await agentApi.confirmProposal(proposalId);
            } catch (err) {
              // 409 = 已非 PENDING（已确认/过期/已应用），属于变更集残留，跳过即可
              const status = (err as { response?: { status: number } })?.response?.status;
              if (status !== 409) {
                lastError = err;
              }
            }
          }
          if (lastError) {
            throw lastError;
          }
        }}
        onClose={() => setReviewOpen(false)}
        onConfirmed={handleReviewConfirmed}
        onRejected={handleReviewRejected}
      />
    </div>
  );
}
