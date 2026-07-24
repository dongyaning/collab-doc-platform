/**
 * Shared types and utilities across WiseFlow packages.
 */

export interface UserRef {
  id: string;
  name: string;
  avatarUrl?: string;
}

export const PROJECT_NAME = 'WiseFlow';

export interface DefaultAvatar {
  id: string;
  label: string;
  url: string;
  color: string;
}

export function croodlesAvatarUrl(id: string): string {
  return `/uploads/avatars/croodles-${id}.svg`;
}

export const DEFAULT_AVATARS: DefaultAvatar[] = [
  {
    id: 'atlas',
    label: 'Atlas',
    url: croodlesAvatarUrl('atlas'),
    color: '#2563eb',
  },
  {
    id: 'juniper',
    label: 'Juniper',
    url: croodlesAvatarUrl('juniper'),
    color: '#0f766e',
  },
  {
    id: 'marigold',
    label: 'Marigold',
    url: croodlesAvatarUrl('marigold'),
    color: '#be123c',
  },
  {
    id: 'sol',
    label: 'Sol',
    url: croodlesAvatarUrl('sol'),
    color: '#b45309',
  },
  {
    id: 'indigo',
    label: 'Indigo',
    url: croodlesAvatarUrl('indigo'),
    color: '#7c3aed',
  },
  {
    id: 'tide',
    label: 'Tide',
    url: croodlesAvatarUrl('tide'),
    color: '#475569',
  },
];

export const DEFAULT_AVATAR_URL = DEFAULT_AVATARS[0]?.url ?? '';

// ---- Knowledge Base types ----

export type NodeType = 'DOC' | 'FOLDER';

/** A flattened node for building the tree on the client. */
export interface TreeNode {
  id: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  sortOrder: number;
  children: TreeNode[];
}

/** Summary of a KB for the list view. */
export interface KnowledgeBaseSummary {
  id: string;
  title: string;
  description: string | null;
  owner: UserRef;
  createdAt: string;
  updatedAt: string;
  nodeCount: number;
  role?: string;
}

/** Full tree response from the server. */
export interface KnowledgeBaseTree {
  kb: KnowledgeBaseSummary;
  nodes: TreeNode[];
}

/** Node detail (for the editor page). */
export interface NodeDetail {
  id: string;
  kbId: string;
  parentId: string | null;
  type: NodeType;
  title: string;
  sortOrder: number;
  version: number;
  ownerId: string;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export * from './monitor.js';
