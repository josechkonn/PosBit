"use client";
import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Modal } from "./modal";
import { Button } from "./button";
import { AlertTriangle, Info } from "lucide-react";

type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive" | "warning";
};

type ConfirmContextType = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmContextType>(() => Promise.resolve(false));

export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<{ resolve: (value: boolean) => void } | null>(null);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setOptions(opts);
    setOpen(true);
    return new Promise<boolean>((resolve) => {
      setResolver({ resolve });
    });
  }, []);

  const handleConfirm = () => {
    resolver?.resolve(true);
    setOpen(false);
  };

  const handleCancel = () => {
    resolver?.resolve(false);
    setOpen(false);
  };

  const getIcon = () => {
    if (options?.variant === "destructive") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500 mb-4 mx-auto">
          <AlertTriangle size={20} />
        </div>
      );
    }
    if (options?.variant === "warning") {
      return (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-500 mb-4 mx-auto">
          <AlertTriangle size={20} />
        </div>
      );
    }
    return (
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-500/10 text-blue-500 mb-4 mx-auto">
        <Info size={20} />
      </div>
    );
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={open}
        onClose={handleCancel}
        title=""
        className="max-w-sm w-[90vw]"
        hideCloseButton
      >
        <div className="text-center pt-2 pb-4">
          {getIcon()}
          <h3 className="mb-2 text-lg font-bold text-foreground">{options?.title}</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed px-2">
            {options?.message}
          </p>
        </div>
        
        <div className="flex items-center gap-3 mt-4">
          <Button variant="outline" onClick={handleCancel} className="flex-1 font-medium">
            {options?.cancelText || "Cancelar"}
          </Button>
          <Button 
            variant={options?.variant === "destructive" ? "destructive" : "primary"} 
            onClick={handleConfirm} 
            className="flex-1 font-medium"
          >
            {options?.confirmText || "Confirmar"}
          </Button>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}
