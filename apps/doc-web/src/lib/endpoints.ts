import { api } from './api';
import type { KnowledgeBaseSummary, KnowledgeBaseTree, NodeDetail } from '@wiseflow/shared';

// ---- shared types ----

export type NodeRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export interface NodeMember {
  userId: string;
  email: string;
  name: string;
  role: Exclude<NodeRole, 'OWNER'>;
  includeChildren?: boolean;
  createdAt: string;
}

export interface NodeMembersResponse {
  owner: { id: string; email: string; name: string };
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
  create: (data: { kbId: string; title?: string; type?: string; parentId?: string | null }) =>
    api.post<NodeDetail>('/nodes', data).then((r) => r.data),
  update: (id: string, patch: { title?: string; content?: unknown }) =>
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
};

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{
        accessToken: string;
        user: { id: string; email: string; name: string };
      }>('/auth/login', { email, password })
      .then((r) => r.data),
  register: (email: string, password: string, name: string) =>
    api
      .post<{
        accessToken: string;
        user: { id: string; email: string; name: string };
      }>('/auth/register', { email, password, name })
      .then((r) => r.data),
};
