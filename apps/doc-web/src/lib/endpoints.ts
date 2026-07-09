import { api } from './api';
import type { JSONContent } from '@tiptap/react';
import type {
  KnowledgeBaseSummary,
  KnowledgeBaseTree,
  MonitorErrorEvent,
  MonitorEventRecord,
  MonitorSlowDoc,
  MonitorSlowRequest,
  MonitorSummary,
  MonitorTrendPoint,
  NodeDetail,
} from '@wiseflow/shared';
import type { AuthUser } from '../stores/auth.store';

// ---- shared types ----

export type NodeRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';
export type AccessRequestScope = 'KNOWLEDGE_BASE' | 'NODE';
export type AccessRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELED';

export interface AccessRequest {
  id: string;
  kbId: string;
  nodeId: string | null;
  scope: AccessRequestScope;
  requesterId: string;
  requester?: { id: string; email: string; name: string; avatarUrl: string };
  node?: { id: string; title: string; type: string } | null;
  requestedRole: Exclude<NodeRole, 'OWNER'>;
  requestedIncludeChildren: boolean;
  message: string | null;
  status: AccessRequestStatus;
  approvedRole: Exclude<NodeRole, 'OWNER'> | null;
  approvedScope: AccessRequestScope | null;
  approvedNodeId: string | null;
  approvedIncludeChildren: boolean | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAccessRequestInput {
  scope: AccessRequestScope;
  nodeId?: string;
  requestedRole?: Exclude<NodeRole, 'OWNER'>;
  includeChildren?: boolean;
  message?: string;
}

export interface ReviewAccessRequestInput {
  status: 'APPROVED' | 'REJECTED';
  role?: Exclude<NodeRole, 'OWNER'>;
  scope?: AccessRequestScope;
  nodeId?: string;
  includeChildren?: boolean;
}

export interface NodeMember {
  userId: string;
  email: string;
  name: string;
  avatarUrl: string;
  role: Exclude<NodeRole, 'OWNER'>;
  includeChildren?: boolean;
  createdAt: string;
}

export interface NodeMembersResponse {
  owner: { id: string; email: string; name: string; avatarUrl: string };
  members: NodeMember[];
}

export interface NodeVersion {
  id: string;
  version: number;
  label: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface NodeVersionDetail extends NodeVersion {
  content: unknown;
}

/** A shared node (from GET /nodes/shared) */
export interface SharedNode {
  node: {
    id: string;
    kbId: string;
    type: string;
    title: string;
    parentId: string | null;
  };
  kb: { id: string; title: string };
  role: NodeRole;
}

// ---- Knowledge Base API ----

export const knowledgeBasesApi = {
  list: () => api.get<KnowledgeBaseSummary[]>('/knowledge-bases').then((r) => r.data),
  create: (title?: string, description?: string) =>
    api.post<KnowledgeBaseSummary>('/knowledge-bases', { title, description }).then((r) => r.data),
  getTree: (id: string) =>
    api.get<KnowledgeBaseTree>(`/knowledge-bases/${id}/tree`).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/knowledge-bases/${id}`).then((r) => r.data),
  createAccessRequest: (id: string, data: CreateAccessRequestInput) =>
    api.post<AccessRequest>(`/knowledge-bases/${id}/access-requests`, data).then((r) => r.data),
  getMyAccessRequest: (id: string) =>
    api.get<AccessRequest | null>(`/knowledge-bases/${id}/access-requests/my`).then((r) => r.data),
  listAccessRequests: (id: string) =>
    api.get<AccessRequest[]>(`/knowledge-bases/${id}/access-requests`).then((r) => r.data),
  reviewAccessRequest: (id: string, requestId: string, data: ReviewAccessRequestInput) =>
    api
      .patch<AccessRequest>(`/knowledge-bases/${id}/access-requests/${requestId}`, data)
      .then((r) => r.data),
  listMembers: (id: string) =>
    api.get<NodeMembersResponse>(`/knowledge-bases/${id}/members`).then((r) => r.data),
  addMember: (id: string, email: string, role: Exclude<NodeRole, 'OWNER'>) =>
    api
      .post<{
        userId: string;
        email: string;
        name: string;
        role: NodeRole;
      }>(`/knowledge-bases/${id}/members`, { email, role })
      .then((r) => r.data),
  updateMemberRole: (id: string, userId: string, role: Exclude<NodeRole, 'OWNER'>) =>
    api
      .patch<{ ok: true }>(`/knowledge-bases/${id}/members/${userId}`, { role })
      .then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/knowledge-bases/${id}/members/${userId}`).then((r) => r.data),
};

// ---- Node API (documents are now nodes) ----

export const nodesApi = {
  get: (id: string) => api.get<NodeDetail>(`/nodes/${id}`).then((r) => r.data),
  getContent: (id: string) => api.get<JSONContent>(`/nodes/${id}/content`).then((r) => r.data),
  create: (data: { kbId: string; title?: string; type?: string; parentId?: string | null }) =>
    api.post<NodeDetail>('/nodes', data).then((r) => r.data),
  update: (id: string, patch: { title?: string }) =>
    api.patch<NodeDetail>(`/nodes/${id}`, patch).then((r) => r.data),
  move: (id: string, data: { parentId: string | null; index: number }) =>
    api.patch<{ ok: true }>(`/nodes/${id}/move`, data).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/nodes/${id}`).then((r) => r.data),
  listVersions: (id: string) => api.get<NodeVersion[]>(`/nodes/${id}/versions`).then((r) => r.data),
  createVersion: (id: string, label?: string) =>
    api
      .post<{ id: string; version: number }>(`/nodes/${id}/versions`, { label })
      .then((r) => r.data),
  getVersion: (id: string, versionId: string) =>
    api.get<NodeVersionDetail>(`/nodes/${id}/versions/${versionId}`).then((r) => r.data),
  listMembers: (id: string) =>
    api.get<NodeMembersResponse>(`/nodes/${id}/members`).then((r) => r.data),
  addMember: (
    id: string,
    email: string,
    role: Exclude<NodeRole, 'OWNER'>,
    includeChildren?: boolean
  ) =>
    api
      .post<{
        userId: string;
        email: string;
        name: string;
        role: NodeRole;
      }>(`/nodes/${id}/members`, { email, role, includeChildren })
      .then((r) => r.data),
  updateMemberRole: (
    id: string,
    userId: string,
    role: Exclude<NodeRole, 'OWNER'>,
    includeChildren?: boolean
  ) =>
    api
      .patch<{ ok: true }>(`/nodes/${id}/members/${userId}`, { role, includeChildren })
      .then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/nodes/${id}/members/${userId}`).then((r) => r.data),
  listShared: () => api.get<SharedNode[]>('/nodes/shared').then((r) => r.data),
};

export const filesApi = {
  upload: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{ id: string; url: string; originalName: string; size: number }>('/files/upload', fd)
      .then((r) => r.data);
  },
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return api
      .post<{
        id: string;
        url: string;
        originalName: string;
        size: number;
      }>('/files/avatar-upload', fd)
      .then((r) => r.data);
  },
};

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{
        accessToken: string;
        user: AuthUser;
      }>('/auth/login', { email, password })
      .then((r) => r.data),
  register: (email: string, password: string, name: string, avatarUrl: string) =>
    api
      .post<{
        accessToken: string;
        user: AuthUser;
      }>('/auth/register', { email, password, name, avatarUrl })
      .then((r) => r.data),
};

export interface MonitorQueryParams {
  from?: string;
  to?: string;
  docId?: string;
  eventType?: string;
  limit?: number;
}

export const monitorApi = {
  summary: (params?: MonitorQueryParams) =>
    api.get<MonitorSummary>('/monitor/summary', { params }).then((r) => r.data),
  trends: (params?: MonitorQueryParams) =>
    api.get<MonitorTrendPoint[]>('/monitor/trends', { params }).then((r) => r.data),
  slowRequests: (params?: MonitorQueryParams) =>
    api.get<MonitorSlowRequest[]>('/monitor/slow-requests', { params }).then((r) => r.data),
  slowDocs: (params?: MonitorQueryParams) =>
    api.get<MonitorSlowDoc[]>('/monitor/slow-docs', { params }).then((r) => r.data),
  errors: (params?: MonitorQueryParams) =>
    api.get<MonitorErrorEvent[]>('/monitor/errors', { params }).then((r) => r.data),
  event: (id: string) => api.get<MonitorEventRecord>(`/monitor/events/${id}`).then((r) => r.data),
};
