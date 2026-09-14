import React from "react";

// Toast simple reutilizable entre pantallas (guardado local, guardado y sincronizado, etc.)
export function useToast(duration = 2600) {
  const [msg, setMsg] = React.useState(null);
  const timerRef = React.useRef(null);

  const showToast = React.useCallback(
    (text) => {
      setMsg(text);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setMsg(null), duration);
    },
    [duration]
  );

  React.useEffect(() => () => timerRef.current && clearTimeout(timerRef.current), []);

  const node = (
    <div className={`toast${msg ? " show" : ""}`} role="status" aria-live="polite">
      {msg}
    </div>
  );

  return { showToast, toastNode: node };
}
