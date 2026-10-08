"use client";

import { createContext, useContext, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X, AlertTriangle, Info } from "lucide-react";

type ToastType = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

const icons: Record<ToastType, React.ReactNode> = {
  success: <Check size={16} />,
  error: <X size={16} />,
  warning: <AlertTriangle size={16} />,
  info: <Info size={16} />,
};

const styles: Record<ToastType, string> = {
  success: "border-emerald-500/50 bg-slate-900 text-emerald-300 shadow-2xl",
  error: "border-red-500/50 bg-slate-900 text-red-300 shadow-2xl",
  warning: "border-amber-500/50 bg-slate-900 text-amber-300 shadow-2xl",
  info: "border-blue-500/50 bg-slate-900 text-blue-300 shadow-2xl",
};

const iconBg: Record<ToastType, string> = {
  success: "bg-emerald-500/20 text-emerald-400",
  error: "bg-red-500/20 text-red-400",
  warning: "bg-amber-500/20 text-amber-400",
  info: "bg-blue-500/20 text-blue-400",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = "success") => {
      const id = `toast-${++counterRef.current}`;
      setToasts((prev) => [...prev, { id, type, message }]);
      setTimeout(() => removeToast(id), 4000);
    },
    [removeToast]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}

      {/* Toast container */}
      <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
        <AnimatePresence mode="popLayout">
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.95 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-md ${styles[t.type]}`}
            >
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${iconBg[t.type]}`}>
                {icons[t.type]}
              </div>
              <p className="text-sm font-medium flex-1">{t.message}</p>
              <button
                onClick={() => removeToast(t.id)}
                className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100 transition-opacity"
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}
