import { useMemo } from 'react';

interface UseDocLoadingParams {
  activeDocLoading: boolean;
  treeLoading: boolean;
  movePending: boolean;
  createPending: boolean;
  snapshotPending: boolean;
}

interface UseDocLoadingResult {
  /** true when a create or move operation is in progress */
  isCreating: boolean;
  /** true when the main document content is loading */
  isDocLoading: boolean;
}

export function useDocLoading({
  activeDocLoading,
  treeLoading,
  movePending,
  createPending,
}: UseDocLoadingParams): UseDocLoadingResult {
  return useMemo(
    () => ({
      isCreating: createPending || movePending,
      isDocLoading: activeDocLoading || treeLoading || movePending,
    }),
    [activeDocLoading, treeLoading, movePending, createPending]
  );
}
