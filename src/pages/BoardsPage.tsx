import { Ellipsis, LogOut, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { BoardSummary } from "../../shared/api.ts";
import { peerColor } from "../../shared/protocol.ts";
import { api } from "../api.ts";
import { Avatar } from "../components/Avatar.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Logo } from "../components/Logo.tsx";
import { NameDialog } from "../components/NameDialog.tsx";
import { Button } from "../components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu.tsx";
import { useToast } from "../components/ui/toast.tsx";
import { formatDate } from "../lib/format.ts";
import { Link, navigate } from "../router.tsx";
import { useMe } from "../session.tsx";

/** Every board, the one that changed last first. */
export function BoardsPage() {
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<BoardSummary | null>(null);
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const toast = useToast();

  useEffect(() => {
    document.title = "alcyone";
    api
      .listBoards()
      .then(({ boards: loaded }) => setBoards(loaded))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  async function create(name: string) {
    const { board } = await api.createBoard(name);
    setCreating(false);
    navigate(`/boards/${board.id}`);
  }

  async function rename(board: BoardSummary, name: string) {
    const { board: renamed } = await api.renameBoard(board.id, name);
    setBoards((current) => current?.map((each) => (each.id === renamed.id ? renamed : each)) ?? null);
    setRenaming(null);
  }

  async function remove(board: BoardSummary) {
    await api.deleteBoard(board.id);
    setBoards((current) => current?.filter((each) => each.id !== board.id) ?? null);
    setDeleting(null);
    toast.success(`Deleted ${board.name}.`);
  }

  return (
    <div className="min-h-screen bg-surface-subdued">
      <Header />
      <main className="mx-auto grid max-w-content gap-5 px-6 py-6 max-sm:px-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-figure font-bold text-heading">Boards</h1>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            New board
          </Button>
        </div>
        {error !== "" && <p className="error-box">{error}</p>}
        {boards !== null && (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
            {boards.map((board) => (
              <li key={board.id}>
                <BoardCard board={board} onRename={() => setRenaming(board)} onDelete={() => setDeleting(board)} />
              </li>
            ))}
          </ul>
        )}
      </main>

      <NameDialog
        open={creating}
        title="New board"
        initialName=""
        submitLabel="Create"
        onSubmit={create}
        onClose={() => setCreating(false)}
      />
      <NameDialog
        open={renaming !== null}
        title="Rename board"
        initialName={renaming?.name ?? ""}
        submitLabel="Rename"
        onSubmit={(name) => (renaming === null ? Promise.resolve() : rename(renaming, name))}
        onClose={() => setRenaming(null)}
      />
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.name ?? ""}?`}
        confirmLabel="Delete"
        onConfirm={() => (deleting === null ? Promise.resolve() : remove(deleting))}
        onClose={() => setDeleting(null)}
      >
        <p className="text-sm">The board and its images leave the bucket for everyone. This cannot be undone.</p>
      </ConfirmDialog>
    </div>
  );
}

function BoardCard({ board, onRename, onDelete }: { board: BoardSummary; onRename: () => void; onDelete: () => void }) {
  return (
    <div className="relative grid h-full gap-1 rounded-lg bg-surface p-4 shadow-[0_0_0_1px_var(--theme-border)] transition-shadow duration-150 hover:shadow-[0_0_0_1px_var(--theme-accent)]">
      <Link to={`/boards/${board.id}`} className="min-w-0 pr-8 font-semibold break-words text-strong after:absolute after:inset-0 after:rounded-lg">
        {board.name}
      </Link>
      <p className="text-xs text-subdued">
        {formatDate(board.updatedAt)} · {board.createdBy}
      </p>
      {board.canManage && (
        <div className="absolute top-2 right-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${board.name}`}>
                <Ellipsis aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onRename}>
                <Pencil aria-hidden="true" />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onDelete} className="text-critical [&_svg]:text-critical">
                <Trash2 aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

function Header() {
  const me = useMe();
  return (
    <header className="flex h-14 items-center justify-between border-b border-hairline bg-surface px-6 max-sm:px-4">
      <Link to="/" className="flex items-center gap-2 font-bold text-strong" ariaLabel="All boards">
        <Logo className="size-6 text-accent" />
        alcyone
      </Link>
      <AccountMenu email={me.email} name={me.name} logoutUrl={me.logoutUrl} />
    </header>
  );
}

export function AccountMenu({ email, name, logoutUrl }: { email: string; name: string; logoutUrl: string | null }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="cursor-pointer rounded-full" aria-label="Account">
          <Avatar name={name} color={peerColor(email)} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>
          <span className="block text-sm font-semibold text-strong">{name}</span>
          <span className="block text-xs text-subdued">{email}</span>
        </DropdownMenuLabel>
        {logoutUrl !== null && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => window.location.assign(logoutUrl)}>
              <LogOut aria-hidden="true" />
              Sign out
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
