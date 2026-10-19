import type { ProjectStatus, RejectionCategory } from '../model'

// Stated review SLA (Q6, Manager set to 48h). Surfaced in the
// "Submit for Review" confirmation toast.
export const REVIEW_SLA_HOURS = 48

export const REJECTION_CATEGORIES: RejectionCategory[] = [
  'objectionable',
  'safety',
  'copyright',
  'low_quality',
  'other',
]

// i18n key for a rejection category's friendly label.
export function rejectionCategoryKey(category: RejectionCategory | string | null): string {
  switch (category) {
    case 'objectionable':
    case 'safety':
    case 'copyright':
    case 'low_quality':
    case 'other':
      return `moderation.category.${category}`
    default:
      return 'moderation.category.other'
  }
}

// i18n key + Tailwind chip classes per status (A2 — 4-state chip).
export function statusChipKey(status: ProjectStatus | string): string {
  switch (status) {
    case 'published':
      return 'moderation.status.published'
    case 'pending_review':
      return 'moderation.status.pending_review'
    case 'rejected':
      return 'moderation.status.rejected'
    case 'draft':
    default:
      return 'moderation.status.draft'
  }
}

export function statusChipClasses(status: ProjectStatus | string): string {
  switch (status) {
    case 'published':
      return 'bg-green-900 text-green-300'
    case 'pending_review':
      return 'bg-amber-900 text-amber-300'
    case 'rejected':
      return 'bg-red-900 text-red-300'
    case 'draft':
    default:
      return 'bg-gray-700 text-gray-400'
  }
}
