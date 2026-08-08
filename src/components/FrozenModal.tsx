// src/components/FrozenModal.tsx
"use client";

import { useEffect, useState } from "react";

interface FrozenModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function FrozenModal({ isOpen, onClose }: FrozenModalProps) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    setShow(isOpen);
  }, [isOpen]);

  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
        <div className="flex items-center gap-3 text-red-600">
          <div className="text-3xl">🔒</div>
          <h2 className="text-xl font-semibold">Доступ ограничен</h2>
        </div>
        
        <div className="mt-4 space-y-3">
          <p className="text-sm text-gray-600">
            Функционал приложения временно ограничен.
          </p>
          <p className="text-sm text-gray-600">
            Пожалуйста, обратитесь к администратору салона для получения помощи.
          </p>
        </div>
        
        <button
          onClick={onClose}
          className="mt-6 w-full rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-gray-700 transition"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}