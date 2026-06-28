/**
 * Cross-feature core types. Both Income and Expense attach files and track the
 * same sync lifecycle, so these live in `shared` rather than inside one
 * feature's domain (avoids feature-to-feature coupling).
 */

/** A file selected by the user to attach to an entry. */
export interface Attachment {
  /** Local file URI (file://...) or remote URL once uploaded. */
  uri: string;
  fileName: string;
  /** MIME type, e.g. image/jpeg. */
  type: string;
}

/** Sync state of a locally-created entry relative to the backend. */
export type SyncStatus = 'synced' | 'pending' | 'failed';
