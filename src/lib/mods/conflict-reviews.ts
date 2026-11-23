import type { ConflictFilePage } from '../api';
import { call } from '../api/bridge';
import type { ConflictReviewCounts, ConflictReviewSummary } from '../types';

export type ReviewScope = { gameRoot: string; profileId: string };
export type ReviewView = keyof ConflictReviewCounts;
export type ReviewFile = ConflictFilePage['files'][number] & { revision: string; contentVersions: number };
export interface ReviewPage extends Omit<ConflictFilePage, 'files'> {
  counts: ConflictReviewCounts;
  files: ReviewFile[];
}

export function defaultReviewView(counts?: ConflictReviewCounts): ReviewView {
  if (counts?.pending) return 'pending';
  if (counts?.overlap) return 'overlap';
  return counts?.reviewed ? 'reviewed' : 'pending';
}

export function readConflictReviews(scope: ReviewScope, view: ReviewView, query: string, page: number, modId?: string) {
  return call<ReviewPage>('mod-conflict-files', { ...scope, query, page, view, modId });
}

export function setConflictReviewed(scope: ReviewScope, { path, revision }: ReviewFile, reviewed: boolean) {
  return call<{ reviewed: boolean; summary: ConflictReviewSummary }>('set-mod-conflict-reviewed', { ...scope, path, revision, reviewed });
}

export function disableConflictProvider(scope: ReviewScope, { path, revision }: ReviewFile, modId: string) {
  return call<{ status: 'saved'; applies: 'draft' }>('disable-mod-conflict-provider', { ...scope, path, revision, modId });
}

export async function conflictReviewNotice(scope: ReviewScope, hasOverlaps: boolean) {
  if (!hasOverlaps) return '';
  try {
    const { counts } = await readConflictReviews(scope, 'pending', '', 0);
    return counts.pending ? `\n\n方案有 ${counts.pending} 个资源冲突。可在 Mod 页「检查资源」查看。` : '';
  } catch {
    // The informational check must not become a precondition for an existing launch or apply flow.
    return '\n\n方案包含同路径文件，可在 Mod 页「检查资源」核对。';
  }
}
