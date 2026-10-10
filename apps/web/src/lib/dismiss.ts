import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react";

type Listeners = Pick<Document, "addEventListener" | "removeEventListener">;

/**
 * Closes a small open box on a click or tap outside `box` and on Escape anywhere on the page.
 * The button that opened it sits inside `box`, so its own click toggles it shut without a
 * second close from here. Returns the function that removes the listeners.
 */
export function bindDismiss(
  doc: Listeners,
  box: () => Pick<Node, "contains"> | null,
  close: () => void,
): () => void {
  const onPointer = (event: Event) => {
    if (!box()?.contains(event.target as Node | null)) close();
  };
  const onKey = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") close();
  };
  doc.addEventListener("pointerdown", onPointer);
  doc.addEventListener("keydown", onKey);
  return () => {
    doc.removeEventListener("pointerdown", onPointer);
    doc.removeEventListener("keydown", onKey);
  };
}

/** `bindDismiss` while `open`; the account menu. */
export function useDismiss(
  open: boolean,
  box: RefObject<Element | null>,
  setOpen: Dispatch<SetStateAction<boolean>>,
) {
  useEffect(() => {
    if (!open) return;
    return bindDismiss(
      document,
      () => box.current,
      () => {
        setOpen(false);
      },
    );
  }, [open, box, setOpen]);
}
