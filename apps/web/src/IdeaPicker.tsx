import { useEffect, useRef, useState } from "react";

export function IdeaPicker(props: {
  label: string;
  empty: string;
  items: Array<{ id: string; title: string; detail: string; status: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  embedded?: boolean;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const selected = props.items.find((item) => item.id === props.selectedId) ?? null;

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <section
      className={props.embedded ? "idea-picker idea-picker-embedded" : "idea-picker"}
      aria-label={props.label}
      ref={rootRef}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      {props.embedded ? null : (
        <p className="delivery-kicker">
          {props.label}
          {props.items.length ? ` · ${props.items.length}` : ""}
        </p>
      )}
      {props.items.length === 0 ? (
        <p className="muted">{props.empty}</p>
      ) : (
        <>
          <button
            type="button"
            className="idea-picker-current"
            aria-expanded={open}
            aria-haspopup="listbox"
            onClick={() => setOpen((value) => !value)}
          >
            <strong>{selected?.title || "Choose an idea"}</strong>
            {selected ? <span>{selected.detail}</span> : null}
            {selected ? <em>{selected.status}</em> : null}
          </button>
          {open ? (
            <ul className="idea-picker-menu" role="listbox">
              {props.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === props.selectedId}
                    className={item.id === props.selectedId ? "active" : ""}
                    onClick={() => {
                      props.onSelect(item.id);
                      setOpen(false);
                    }}
                  >
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <em>{item.status}</em>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      )}
    </section>
  );
}
