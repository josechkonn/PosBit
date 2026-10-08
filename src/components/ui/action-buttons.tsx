"use client";

import { Edit2, Eye, Trash2 } from "lucide-react";
import { Button } from "./button";

interface ActionButtonsProps {
  onView?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

export function ActionButtons({ onView, onEdit, onDelete }: ActionButtonsProps) {
  return (
    <div className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon" onClick={onView} aria-label="Ver">
        <Eye size={13} />
      </Button>
      <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Editar">
        <Edit2 size={13} />
      </Button>
      <Button variant="destructive" size="icon" onClick={onDelete} aria-label="Eliminar">
        <Trash2 size={13} />
      </Button>
    </div>
  );
}
