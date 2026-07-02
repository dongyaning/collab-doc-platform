import { api } from './api';
import type { KnowledgeBaseSummary, KnowledgeBaseTree, NodeDetail } from '@collab/shared';

// ---- existing document types ----

export type DocumentRole = 'OWNER' | 'EDITOR' | 'COMMENTER' | 'VIEWER';

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; email: string };
  role: DocumentRole;
}

export interface DocumentDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  content: unknown;
  ownerId: string;
  role: DocumentRole;
}

export interface DocumentVersion {
  id: string;
  version: number;
  label: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface DocumentVersionDetail extends DocumentVersion {
  content: unknown;
}

export interface DocumentMember {
  userId: string;
  email: string;
  name: string;
  role: Exclude<DocumentRole, 'OWNER'>;
  createdAt: string;
}

export interface DocumentMembersResponse {
  owner: { id: string; email: string; name: string };
  members: DocumentMember[];
}

// ---- knowledge base types ----

export interface KbMemberResponse {
  owner: { id: string; email: string; name: string };
  members: DocumentMember[];
}

// ---- API objects ----

export const documentsApi = {
  list: () => api.get<DocumentSummary[]>('/documents').then((r) => r.data),
  get: (id: string) => api.get<DocumentDetail>(`/documents/${id}`).then((r) => r.data),
  create: (title?: string) => api.post<DocumentDetail>('/documents', { title }).then((r) => r.data),
  update: (id: string, patch: { title?: string; content?: unknown }) =>
    api.patch<DocumentDetail>(`/documents/${id}`, patch).then((r) => r.data),
  remove: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
  listVersions: (id: string) =>
    api.get<DocumentVersion[]>(`/documents/${id}/versions`).then((r) => r.data),
  createVersion: (id: string, label?: string) =>
    api
      .post<{ id: string; version: number }>(`/documents/${id}/versions`, { label })
      .then((r) => r.data),
  getVersion: (id: string, versionId: string) =>
    api.get<DocumentVersionDetail>(`/documents/${id}/versions/${versionId}`).then((r) => r.data),
  listMembers: (id: string) =>
    api.get<DocumentMembersResponse>(`/documents/${id}/members`).then((r) => r.data),
  addMember: (id: string, email: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api
      .post<{
        userId: string;
        email: string;
        name: string;
        role: DocumentRole;
      }>(`/documents/${id}/members`, { email, role })
      .then((r) => r.data),
  updateMemberRole: (id: string, userId: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api.patch<{ ok: true }>(`/documents/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/documents/${id}/members/${userId}`).then((r) => r.data),
};

// ---- Knowledge Base API ----

export const knowledgeBasesApi = {
  list: () => api.get<KnowledgeBaseSummary[]>('/knowledge-bases').then((r) => r.data),
  create: (title?: string, description?: string) =>
    api.post<KnowledgeBaseSummary>('/knowledge-bases', { title, description }).then((r) => r.data),
  getTree: (id: string) =>
    api.get<KnowledgeBaseTree>(`/knowledge-bases/${id}/tree`).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/knowledge-bases/${id}`).then((r) => r.data),
  listMembers: (id: string) =>
    api.get<KbMemberResponse>(`/knowledge-bases/${id}/members`).then((r) => r.data),
  addMember: (id: string, email: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api
      .post<{
        userId: string;
        email: string;
        name: string;
        role: DocumentRole;
      }>(`/knowledge-bases/${id}/members`, { email, role })
      .then((r) => r.data),
  updateMemberRole: (id: string, userId: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api
      .patch<{ ok: true }>(`/knowledge-bases/${id}/members/${userId}`, { role })
      .then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/knowledge-bases/${id}/members/${userId}`).then((r) => r.data),
};

export const nodesApi = {
  get: (id: string) => api.get<NodeDetail>(`/nodes/${id}`).then((r) => r.data),
  create: (data: { kbId: string; title?: string; type?: string; parentId?: string | null }) =>
    api.post<NodeDetail>('/nodes', data).then((r) => r.data),
  update: (id: string, patch: { title?: string; content?: unknown }) =>
    api.patch<NodeDetail>(`/nodes/${id}`, patch).then((r) => r.data),
  move: (id: string, data: { parentId: string | null; sortOrder: number }) =>
    api.patch<{ ok: true }>(`/nodes/${id}/move`, data).then((r) => r.data),
  remove: (id: string) => api.delete<{ ok: true }>(`/nodes/${id}`).then((r) => r.data),
  listVersions: (id: string) =>
    api.get<DocumentVersion[]>(`/nodes/${id}/versions`).then((r) => r.data),
  createVersion: (id: string, label?: string) =>
    api
      .post<{ id: string; version: number }>(`/nodes/${id}/versions`, { label })
      .then((r) => r.data),
  getVersion: (id: string, versionId: string) =>
    api.get<DocumentVersionDetail>(`/nodes/${id}/versions/${versionId}`).then((r) => r.data),
  listMembers: (id: string) =>
    api.get<KbMemberResponse>(`/nodes/${id}/members`).then((r) => r.data),
  addMember: (id: string, email: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api
      .post<{
        userId: string;
        email: string;
        name: string;
        role: DocumentRole;
      }>(`/nodes/${id}/members`, { email, role })
      .then((r) => r.data),
  updateMemberRole: (id: string, userId: string, role: Exclude<DocumentRole, 'OWNER'>) =>
    api.patch<{ ok: true }>(`/nodes/${id}/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (id: string, userId: string) =>
    api.delete<{ ok: true }>(`/nodes/${id}/members/${userId}`).then((r) => r.data),
};

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{
        accessToken: string;
        user: { id: string; email: string; name: string };
      }>('/auth/login', { email, password })
      .then((r) => r.data),
};
