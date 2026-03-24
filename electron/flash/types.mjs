/**
 * Flash service shared constants and error codes.
 *
 * All adapters and the service layer share these definitions to ensure
 * consistent IPC result shapes across platforms.
 */

export const FlashErrorCode = Object.freeze({
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  TOOL_MISSING: 'TOOL_MISSING',
  DEVICE_NOT_FOUND: 'DEVICE_NOT_FOUND',
  DEVICE_NOT_REMOVABLE: 'DEVICE_NOT_REMOVABLE',
  IMAGE_TOO_LARGE: 'IMAGE_TOO_LARGE',
  DECOMPRESS_FAILED: 'DECOMPRESS_FAILED',
  WRITE_FAILED: 'WRITE_FAILED',
  VERIFY_FAILED: 'VERIFY_FAILED',
  BACKUP_FAILED: 'BACKUP_FAILED',
  USER_CANCELLED: 'USER_CANCELLED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  INVALID_PARAMS: 'INVALID_PARAMS',
});

export const FlashStage = Object.freeze({
  IDLE: 'idle',
  PREPARE: 'prepare',
  DOWNLOADING: 'downloading',
  DECOMPRESSING: 'decompressing',
  BACKUP: 'backup',
  FLASHING: 'flashing',
  VERIFYING: 'verifying',
  DONE: 'done',
  ERROR: 'error',
});
