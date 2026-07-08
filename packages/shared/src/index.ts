/**
 * Shared types and utilities across WiseFlow packages.
 */

export interface UserRef {
  id: string;
  name: string;
}

export const PROJECT_NAME = 'WiseFlow';

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
