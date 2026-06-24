import { api } from '../lib/api';

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
  restoreVersion: (id: string, versionId: string) =>
    api
      .post<{ ok: true }>(`/documents/${id}/versions/${versionId}/restore`, {})
      .then((r) => r.data),
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

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<{
        accessToken: string;
        user: { id: string; email: string; name: string };
      }>('/auth/login', { email, password })
      .then((r) => r.data),
};
