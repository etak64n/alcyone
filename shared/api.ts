// The HTTP API of alcyone under /api, which the browser app and the Worker share. The
// contents of a board travel over its WebSocket (shared/protocol.ts) instead.

/** The signed-in person. */
export interface Me {
  email: string;
  name: string;
  /** Admins rename and delete every board. */
  isAdmin: boolean;
  /** Where the browser goes to sign out, or null under cf dev, where Access does not run. */
  logoutUrl: string | null;
}

export interface MeResponse {
  me: Me;
}

export interface BoardSummary {
  id: string;
  name: string;
  createdAt: string;
  /** The email of the person who created the board. */
  createdBy: string;
  /** When someone last changed the board, or created it. */
  updatedAt: string;
  /** Whether the signed-in person may rename and delete the board: its creator and admins. */
  canManage: boolean;
}

export interface ListBoardsResponse {
  boards: BoardSummary[];
}

export interface BoardResponse {
  board: BoardSummary;
}

export interface AssetResponse {
  asset: { id: string; contentType: string; size: number };
}

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export const BOARD_NAME_MAX_LENGTH = 100;

/** The largest image that a board takes, in bytes. */
export const ASSET_MAX_BYTES = 20 * 1024 * 1024;

/**
 * The kinds of images that a board takes. SVG is not among them: a picture that can carry
 * a script should not open from the origin of the app.
 */
export const ASSET_CONTENT_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"] as const;
