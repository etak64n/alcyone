import { useEffect, useState, type FormEvent } from "react";
import { BOARD_NAME_MAX_LENGTH } from "../../shared/api.ts";
import { Button } from "./ui/button.tsx";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "./ui/dialog.tsx";
import { useToast } from "./ui/toast.tsx";

/** Asks for the name of a board, to create it or to rename it. */
export function NameDialog({
  open,
  title,
  initialName,
  submitLabel,
  onSubmit,
  onClose,
}: {
  open: boolean;
  title: string;
  initialName: string;
  submitLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (open) setName(initialName);
  }, [open, initialName]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (name.trim() === "") return;
    setBusy(true);
    try {
      await onSubmit(name.trim());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <label className="grid gap-1 text-xs font-semibold text-label">
            Name
            <input
              autoFocus
              className="field"
              value={name}
              maxLength={BOARD_NAME_MAX_LENGTH}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button>Cancel</Button>
            </DialogClose>
            <Button type="submit" variant="primary" disabled={busy || name.trim() === ""}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
