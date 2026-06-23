import { api } from '../lib/api';

export interface DocumentSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentDetail extends DocumentSummary {
  content: unknown;
}

export const documentsApi = {
  list: () => api.get<DocumentSummary[]>('/documents').then((r) => r.data),
  get: (id: string) => api.get<DocumentDetail>(`/documents/${id}`).then((r) => r.data),
  create: (title?: string) => api.post<DocumentDetail>('/documents', { title }).then((r) => r.data),
  update: (id: string, patch: { title?: string; content?: unknown }) =>
    api.patch<DocumentDetail>(`/documents/${id}`, patch).then((r) => r.data),
  remove: (id: string) => api.delete(`/documents/${id}`).then((r) => r.data),
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
