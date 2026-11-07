import { CloudOff, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BoardSummary } from "../../shared/api.ts";
import { api, ApiError, socketUrl } from "../api.ts";
import { Canvas } from "../board/Canvas.tsx";
import { Editor } from "../board/editor.ts";
import { Cursors, People, TextEditor } from "../board/Overlays.tsx";
import { StyleBar } from "../board/StyleBar.tsx";
import type { SocketLike } from "../board/sync.ts";
import { canvasMeasure, type Measure } from "../board/text.ts";
import { HistoryControls, Toolbar, ZoomControls } from "../board/Toolbar.tsx";
import { Logo } from "../components/Logo.tsx";
import { NameDialog } from "../components/NameDialog.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { Link } from "../router.tsx";
import { useMe } from "../session.tsx";
import { AccountMenu } from "./BoardsPage.tsx";

// One canvas measures text for every board of the page.
let measure: Measure | null = null;
function sharedMeasure(): Measure {
  measure ??= canvasMeasure();
  return measure;
}

/** A board, which everyone on it edits together. */
export function BoardPage({ id }: { id: string }) {
  const toast = useToast();
  const me = useMe();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [summary, setSummary] = useState<BoardSummary | null>(null);
  const [missing, setMissing] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editor] = useState(
    () =>
      new Editor({
        boardId: id,
        socketUrl: socketUrl(id),
        createSocket: (url) => new WebSocket(url) as unknown as SocketLike,
        measure: sharedMeasure(),
        events: {
          error: (message) => toastRef.current.error(message),
          uploadImage: async (file) => (await api.uploadAsset(id, file)).asset.id,
        },
      }),
  );
  useSyncExternalStore(editor.subscribe, editor.getVersion);

  useEffect(() => {
    editor.start();
    return () => editor.stop();
  }, [editor]);

  useEffect(() => {
    api
      .getBoard(id)
      .then(({ board }) => setSummary(board))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.status === 404) setMissing(true);
        else toastRef.current.error(err instanceof Error ? err.message : String(err));
      });
  }, [id]);

  // The keys, the clipboard, and leaving the page, while the focus is on the board.
  useEffect(() => {
    const isField = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT");
    const inMenu = (target: EventTarget | null) => target instanceof Element && target.closest("[role=dialog],[role=menu]") !== null;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isField(event.target) || inMenu(event.target)) return;
      if (editor.keyDown(event)) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => editor.keyUp(event);
    const onCopy = (event: ClipboardEvent) => {
      if (isField(event.target)) return;
      const text = editor.copySelection();
      if (text === null) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onCut = (event: ClipboardEvent) => {
      if (isField(event.target)) return;
      const text = editor.cutSelection();
      if (text === null) return;
      event.clipboardData?.setData("text/plain", text);
      event.preventDefault();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (isField(event.target) || inMenu(event.target)) return;
      const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"));
      if (files.length > 0) {
        event.preventDefault();
        void editor.addImages(files);
        return;
      }
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (text === "") return;
      event.preventDefault();
      editor.pasteText(text);
    };
    // The browser asks before it leaves a board whose last edits have not reached the room.
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (editor.connection?.pending === true) event.preventDefault();
    };
    // A window that loses the focus never hears the space bar go up.
    const onBlur = () => editor.keyUp({ code: "Space" });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  }, [editor]);

  const connection = editor.connection;
  const name = connection?.board?.name ?? summary?.name ?? "";
  useEffect(() => {
    document.title = name === "" ? "alcyone" : `${name} · alcyone`;
  }, [name]);

  if (missing || connection?.status === "deleted") {
    return (
      <main className="grid min-h-screen place-items-center p-6">
        <div className="grid justify-items-center gap-3 text-center">
          <h1 className="text-figure font-bold text-heading">{missing ? "This board does not exist" : "This board was deleted"}</h1>
          <Link to="/" className="font-semibold text-accent hover:underline">
            All boards
          </Link>
        </div>
      </main>
    );
  }

  const status = connection?.status ?? "connecting";
  return (
    <div className="fixed inset-0 overflow-hidden" data-connection={status}>
      <Canvas editor={editor} />
      <TextEditor editor={editor} />
      <Cursors editor={editor} />

      <div className="board-panel absolute top-3 left-3 flex h-11 max-w-[calc(50vw-2rem)] items-center gap-1 pr-2 pl-1">
        <Link to="/" className="grid size-9 shrink-0 place-items-center rounded-sm hover:bg-surface-hover" ariaLabel="All boards">
          <Logo className="size-6 text-accent" />
        </Link>
        {summary?.canManage === true ? (
          <button type="button" className="min-w-0 cursor-pointer truncate rounded-sm px-1.5 py-1 font-semibold text-strong hover:bg-surface-hover" onClick={() => setRenaming(true)}>
            {name}
          </button>
        ) : (
          <span className="min-w-0 truncate px-1.5 font-semibold text-strong">{name}</span>
        )}
        {status !== "open" && (
          <span className="flex shrink-0 items-center gap-1 text-xs text-subdued" role="status">
            {status === "reconnecting" ? <CloudOff aria-hidden="true" className="size-4" /> : <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
            {status === "reconnecting" ? "Reconnecting" : "Connecting"}
          </span>
        )}
      </div>

      <div className="board-panel absolute top-3 right-3 flex h-11 items-center gap-2 px-2">
        <People editor={editor} />
        <AccountMenu email={me.email} name={me.name} logoutUrl={me.logoutUrl} />
      </div>

      <StyleBar editor={editor} />
      <Toolbar editor={editor} />
      <HistoryControls editor={editor} />
      <ZoomControls editor={editor} />

      <NameDialog
        open={renaming}
        title="Rename board"
        initialName={name}
        submitLabel="Rename"
        onSubmit={async (next) => {
          const { board } = await api.renameBoard(id, next);
          setSummary(board);
          setRenaming(false);
        }}
        onClose={() => setRenaming(false)}
      />
    </div>
  );
}
