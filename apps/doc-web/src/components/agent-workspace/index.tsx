import { useEffect, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { Alert, App as AntdApp, Button, Divider, Input, Space, Spin, Tag, Typography } from 'antd';
import { CheckOutlined, CloseOutlined, SendOutlined, StopOutlined } from '@ant-design/icons';
import { agentApi } from '../../agent/agent.api';
import { applyAgentProposal, StaleAgentProposalError } from '../../agent/proposal-applier';
import type { AgentEvent, AgentProposal, AgentSelection } from '../../agent/agent.types';
import styles from './index.module.less';

const { Paragraph, Text } = Typography;
const { TextArea } = Input;

type RunState = 'idle' | 'running' | 'awaiting_confirmation' | 'applying' | 'completed' | 'error';

interface AgentWorkspaceProps {
  kbId: string;
  nodeId: string;
  nodeVersion: number;
  editor: Editor;
  selection: AgentSelection;
}

export function AgentWorkspace({
  kbId,
  nodeId,
  nodeVersion,
  editor,
  selection,
}: AgentWorkspaceProps) {
  const { message: messageApi } = AntdApp.useApp();
  const [instruction, setInstruction] = useState('帮我把这段话改得更专业');
  const [streamedText, setStreamedText] = useState('');
  const [finalAnswer, setFinalAnswer] = useState('');
  const [proposal, setProposal] = useState<AgentProposal | null>(null);
  const [runState, setRunState] = useState<RunState>('idle');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const onEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'token':
        setStreamedText((current) => current + event.text);
        break;
      case 'final_answer':
        setFinalAnswer(event.text);
        break;
      case 'proposal_ready':
        setProposal(event);
        setRunState('awaiting_confirmation');
        break;
      case 'run_completed':
        if (event.reason === 'error') {
          setError(event.error ?? 'Agent run failed');
          setRunState('error');
        } else {
          setRunState('completed');
        }
        break;
      case 'tool_error':
        setError(event.error);
        setRunState('error');
        break;
      default:
        break;
    }
  };

  const startRun = async () => {
    const command = instruction.trim();
    if (!command) {
      return;
    }

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setStreamedText('');
    setFinalAnswer('');
    setProposal(null);
    setError('');
    setRunState('running');

    try {
      await agentApi.run(
        {
          conversationId: `selection-${nodeId}`,
          message: command,
          kbId,
          nodeId,
          nodeBaseVersion: nodeVersion,
          selection,
        },
        onEvent,
        abort.signal
      );
    } catch (runError) {
      if (abort.signal.aborted) {
        setRunState('idle');
        return;
      }
      setError(runError instanceof Error ? runError.message : 'Agent run failed');
      setRunState('error');
    }
  };

  const confirmProposal = async () => {
    if (!proposal) {
      return;
    }

    setRunState('applying');
    setError('');
    try {
      await agentApi.confirmProposal(proposal.proposalId);
      applyAgentProposal(editor, proposal, selection, nodeVersion);
      await agentApi.acknowledgeApplied(proposal.proposalId);
      setRunState('completed');
      messageApi.success('Agent edit applied');
    } catch (applyError) {
      const isStale = applyError instanceof StaleAgentProposalError;
      if (isStale) {
        await agentApi.markProposalStale(proposal.proposalId).catch(() => undefined);
      }
      const message =
        applyError instanceof Error ? applyError.message : 'Agent edit could not be applied';
      setError(message);
      setRunState(isStale ? 'error' : 'awaiting_confirmation');
    }
  };

  const rejectProposal = async () => {
    if (!proposal) {
      return;
    }
    await agentApi.rejectProposal(proposal.proposalId);
    setProposal(null);
    setRunState('completed');
    messageApi.info('Agent edit rejected');
  };

  return (
    <div className={styles.workspace}>
      <section className={styles.contextSection}>
        <div className={styles.sectionHeader}>
          <Text strong>Selection</Text>
          <Tag color="blue">{selection.to - selection.from} positions</Tag>
        </div>
        <Paragraph className={styles.selectionText}>{selection.text}</Paragraph>
      </section>

      <Divider className={styles.divider} />

      <section className={styles.promptSection}>
        <TextArea
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder="Describe how to rewrite the selection"
          autoSize={{ minRows: 3, maxRows: 6 }}
          disabled={runState === 'running' || runState === 'applying'}
        />
        <Button
          type="primary"
          icon={runState === 'running' ? <StopOutlined /> : <SendOutlined />}
          onClick={runState === 'running' ? () => abortRef.current?.abort() : startRun}
          disabled={!instruction.trim() || runState === 'applying'}
          block
        >
          {runState === 'running' ? 'Stop' : 'Rewrite selection'}
        </Button>
      </section>

      {(streamedText || finalAnswer || runState === 'running') && (
        <section className={styles.responseSection}>
          <div className={styles.sectionHeader}>
            <Text strong>Agent</Text>
            {runState === 'running' ? <Spin size="small" /> : null}
          </div>
          <Paragraph className={styles.responseText}>{streamedText || finalAnswer}</Paragraph>
        </section>
      )}

      {proposal ? (
        <section className={styles.proposalSection}>
          <div className={styles.sectionHeader}>
            <Text strong>Proposed change</Text>
            <Tag color={runState === 'completed' ? 'green' : 'gold'}>
              {runState === 'completed' ? 'Applied' : 'Review'}
            </Tag>
          </div>
          <div className={styles.diffBlock}>
            <div className={styles.removedLine}>
              <span className={styles.diffMark}>−</span>
              <span>{selection.text}</span>
            </div>
            <div className={styles.addedLine}>
              <span className={styles.diffMark}>+</span>
              <span>{proposal.patch.newText}</span>
            </div>
          </div>
          {runState !== 'completed' ? (
            <Space className={styles.proposalActions}>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                loading={runState === 'applying'}
                onClick={confirmProposal}
              >
                Apply
              </Button>
              <Button
                icon={<CloseOutlined />}
                disabled={runState === 'applying'}
                onClick={rejectProposal}
              >
                Reject
              </Button>
            </Space>
          ) : null}
        </section>
      ) : null}

      {error ? <Alert type="error" message={error} showIcon /> : null}
    </div>
  );
}
