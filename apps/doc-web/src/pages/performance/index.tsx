import { useMemo, useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Drawer,
  Empty,
  Input,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Typography,
} from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { ColumnsType } from 'antd/es/table';
import type { MonitorErrorEvent, MonitorSlowDoc, MonitorSlowRequest } from '@wiseflow/shared';
import { monitorApi, type MonitorQueryParams } from '../../lib/endpoints';
import styles from './index.module.less';

const { RangePicker } = DatePicker;
const { Text } = Typography;

type RangeValue = [Dayjs, Dayjs];

const defaultRange = (): RangeValue => [dayjs().subtract(24, 'hour'), dayjs()];

function formatMs(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return '--';
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${value}ms`;
}

function formatTime(value: string) {
  return dayjs(value).format('MM-DD HH:mm');
}

export function PerformancePage() {
  const [range, setRange] = useState<RangeValue>(defaultRange);
  const [docId, setDocId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

  const params = useMemo<MonitorQueryParams>(
    () => ({
      docId: docId.trim() || undefined,
      from: range[0].toISOString(),
      limit: 50,
      to: range[1].toISOString(),
    }),
    [docId, range]
  );

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'Performance · WiseFlow';

    return () => {
      document.title = previousTitle;
    };
  }, []);

  const summary = useQuery({
    queryKey: ['monitor-summary', params],
    queryFn: () => monitorApi.summary(params),
  });
  const trends = useQuery({
    queryKey: ['monitor-trends', params],
    queryFn: () => monitorApi.trends(params),
  });
  const slowRequests = useQuery({
    queryKey: ['monitor-slow-requests', params],
    queryFn: () => monitorApi.slowRequests(params),
  });
  const slowDocs = useQuery({
    queryKey: ['monitor-slow-docs', params],
    queryFn: () => monitorApi.slowDocs(params),
  });
  const errors = useQuery({
    queryKey: ['monitor-errors', params],
    queryFn: () => monitorApi.errors(params),
  });
  const eventDetail = useQuery({
    enabled: Boolean(selectedEventId),
    queryKey: ['monitor-event', selectedEventId],
    queryFn: () => monitorApi.event(selectedEventId!),
  });

  const isLoading =
    summary.isLoading ||
    trends.isLoading ||
    slowRequests.isLoading ||
    slowDocs.isLoading ||
    errors.isLoading;
  const hasError =
    summary.isError || trends.isError || slowRequests.isError || slowDocs.isError || errors.isError;
  const maxTrendDuration = Math.max(
    1,
    ...(trends.data ?? []).map((point) => point.avgDocOpenDuration ?? 0)
  );

  const refresh = () => {
    void summary.refetch();
    void trends.refetch();
    void slowRequests.refetch();
    void slowDocs.refetch();
    void errors.refetch();
  };

  return (
    <div className={styles.page}>
      <div className={styles.content}>
        <div className={styles.header}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>Performance</h1>
            <Text className={styles.subtitle}>
              Document experience, request latency, and runtime errors.
            </Text>
          </div>
          <div className={styles.filters}>
            <RangePicker
              showTime
              value={range}
              onChange={(value) => {
                if (value?.[0] && value[1]) {
                  setRange([value[0], value[1]]);
                }
              }}
            />
            <Input
              allowClear
              placeholder="Document ID"
              value={docId}
              onChange={(event) => setDocId(event.target.value)}
              style={{ width: 220 }}
            />
            <Button icon={<ReloadOutlined />} onClick={refresh} />
          </div>
        </div>

        {hasError ? <Alert type="error" showIcon message="Failed to load monitor data." /> : null}

        <Spin spinning={isLoading}>
          <div className={styles.metricGrid}>
            <Card className={styles.metricCard}>
              <Statistic title="Events" value={summary.data?.eventCount ?? 0} />
            </Card>
            <Card className={styles.metricCard}>
              <Statistic title="Avg doc open" value={formatMs(summary.data?.avgDocOpenDuration)} />
            </Card>
            <Card className={styles.metricCard}>
              <Statistic title="P75 doc open" value={formatMs(summary.data?.p75DocOpenDuration)} />
            </Card>
            <Card className={styles.metricCard}>
              <Statistic title="P95 doc open" value={formatMs(summary.data?.p95DocOpenDuration)} />
            </Card>
            <Card className={styles.metricCard}>
              <Statistic
                title="Errors"
                value={summary.data?.errorCount ?? 0}
                valueStyle={{ color: '#cf1322' }}
              />
            </Card>
          </div>

          <div className={styles.grid}>
            <div className={styles.stack}>
              <Card title="Doc Open Trend" className={styles.card}>
                {trends.data?.length ? (
                  <div className={styles.trendList}>
                    {trends.data.map((point) => {
                      const width = `${Math.max(4, ((point.avgDocOpenDuration ?? 0) / maxTrendDuration) * 100)}%`;
                      return (
                        <div className={styles.trendRow} key={point.bucket}>
                          <Text className={styles.muted}>{formatTime(point.bucket)}</Text>
                          <div className={styles.trendBarTrack}>
                            <div className={styles.trendBar} style={{ width }} />
                          </div>
                          <Text>{formatMs(point.avgDocOpenDuration)}</Text>
                          <Text className={styles.muted}>{point.errorCount} err</Text>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No trend data" />
                )}
              </Card>

              <Card title="Slow Requests" className={styles.card}>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={slowRequestColumns}
                  dataSource={slowRequests.data ?? []}
                  onRow={(record) => ({ onClick: () => setSelectedEventId(record.id) })}
                />
              </Card>
            </div>

            <div className={styles.stack}>
              <Card title="Slow Documents" className={styles.card}>
                <Table
                  rowKey="docId"
                  size="small"
                  pagination={false}
                  columns={slowDocColumns}
                  dataSource={slowDocs.data ?? []}
                />
              </Card>

              <Card title="Errors" className={styles.card}>
                <Table
                  rowKey="id"
                  size="small"
                  pagination={false}
                  columns={errorColumns}
                  dataSource={errors.data ?? []}
                  onRow={(record) => ({ onClick: () => setSelectedEventId(record.id) })}
                />
              </Card>
            </div>
          </div>
        </Spin>
      </div>

      <Drawer
        title="Event detail"
        width={520}
        open={Boolean(selectedEventId)}
        onClose={() => setSelectedEventId(null)}
      >
        <Spin spinning={eventDetail.isLoading}>
          {eventDetail.data ? (
            <Space direction="vertical" size={12} style={{ width: '100%' }}>
              <Text strong>{eventDetail.data.name}</Text>
              <Text type="secondary">{eventDetail.data.eventType}</Text>
              <pre>{JSON.stringify(eventDetail.data, null, 2)}</pre>
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No event selected" />
          )}
        </Spin>
      </Drawer>
    </div>
  );
}

const slowRequestColumns: ColumnsType<MonitorSlowRequest> = [
  {
    dataIndex: 'method',
    key: 'method',
    render: (method: string | null) => <Tag>{method ?? 'GET'}</Tag>,
    title: 'Method',
    width: 92,
  },
  {
    dataIndex: 'url',
    ellipsis: true,
    key: 'url',
    title: 'URL',
  },
  {
    dataIndex: 'duration',
    key: 'duration',
    render: (value: number | null) => formatMs(value),
    title: 'Duration',
    width: 110,
  },
  {
    dataIndex: 'statusCode',
    key: 'statusCode',
    title: 'Status',
    width: 86,
  },
];

const slowDocColumns: ColumnsType<MonitorSlowDoc> = [
  {
    dataIndex: 'docId',
    ellipsis: true,
    key: 'docId',
    title: 'Document',
  },
  {
    dataIndex: 'p95Duration',
    key: 'p95Duration',
    render: (value: number | null) => formatMs(value),
    title: 'P95',
    width: 90,
  },
  {
    dataIndex: 'count',
    key: 'count',
    title: 'Count',
    width: 78,
  },
];

const errorColumns: ColumnsType<MonitorErrorEvent> = [
  {
    dataIndex: 'name',
    ellipsis: true,
    key: 'name',
    title: 'Name',
  },
  {
    dataIndex: 'docId',
    ellipsis: true,
    key: 'docId',
    render: (value: string | null) => value ?? '--',
    title: 'Doc',
    width: 100,
  },
  {
    dataIndex: 'createdAt',
    key: 'createdAt',
    render: formatTime,
    title: 'Time',
    width: 104,
  },
];
