// What the Worker asks of the Durable Objects, and what a BoardRoom asks of the
// BoardDirectory. The Worker talks to them through these interfaces, so the tests give it
// stand-ins that keep everything in memory.

/** A board in the list of boards. */
export interface BoardEntry {
  id: string;
  name: string;
  createdAt: string;
  /** The email of the person who created the board. */
  createdBy: string;
  updatedAt: string;
}

/** The one BoardDirectory, which keeps the list of boards in the bucket. */
export interface DirectoryRpc {
  list(): Promise<BoardEntry[]>;
  get(id: string): Promise<BoardEntry | null>;
  create(entry: BoardEntry): Promise<void>;
  /** Renames a board, and returns it, or null when it does not exist. */
  rename(id: string, name: string): Promise<BoardEntry | null>;
  /** Removes a board from the list, and answers whether it was there. */
  remove(id: string): Promise<boolean>;
  /** Notes that someone changed a board at the given time. */
  touch(id: string, updatedAt: string): Promise<void>;
}

/** The BoardRoom of one board, which holds the board while people edit it. */
export interface RoomRpc {
  /** Accepts the WebSocket of a request that the Worker checked, with the headers of ROOM_HEADERS. */
  fetch(request: Request): Promise<Response>;
  /** Tells the people on the board its new name. */
  rename(boardId: string, name: string): Promise<void>;
  /** Closes the board for everyone, and deletes its files from the bucket. */
  destroy(boardId: string): Promise<void>;
}

/** Headers with which the Worker tells a BoardRoom who connects to which board. */
export const ROOM_HEADERS = {
  board: "x-alcyone-board",
  boardName: "x-alcyone-board-name",
  email: "x-alcyone-email",
} as const;

/** The name of the one BoardDirectory. */
export const DIRECTORY_NAME = "directory";
