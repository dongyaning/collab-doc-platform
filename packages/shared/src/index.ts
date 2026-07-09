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

function diceBearPersonasUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/personas/svg?seed=${encodeURIComponent(seed)}`;
}

export const DEFAULT_AVATARS: DefaultAvatar[] = [
  {
    id: 'dong',
    label: 'Dong',
    url: diceBearPersonasUrl('Dong'),
    color: '#2563eb',
  },
  {
    id: 'alice',
    label: 'Alice',
    url: diceBearPersonasUrl('Alice'),
    color: '#0f766e',
  },
  {
    id: 'ming',
    label: 'Ming',
    url: diceBearPersonasUrl('Ming'),
    color: '#be123c',
  },
  {
    id: 'nora',
    label: 'Nora',
    url: diceBearPersonasUrl('Nora'),
    color: '#b45309',
  },
  {
    id: 'reviewer',
    label: 'Reviewer',
    url: diceBearPersonasUrl('Reviewer'),
    color: '#7c3aed',
  },
  {
    id: 'editor',
    label: 'Editor',
    url: diceBearPersonasUrl('Editor'),
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
  ownerId: string;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export * from './monitor.js';
