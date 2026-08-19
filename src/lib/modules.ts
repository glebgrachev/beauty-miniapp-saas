// src/lib/modules.ts
export type ModuleKey =
  | "analytics"
  | "loyalty"
  | "newsletters"
  | "retention"
  | "promotions"
  | "certificates"
  | "stock"
  | "waitlist"
  | "clients"
  | "bookings"
  | "specialists";

/**
 * Проверяет, доступен ли модуль для салона
 * @param modules - объект modules из таблицы shops
 * @param key - название модуля
 * @returns true если модуль доступен
 *
 * Модуль считается доступным, если значение:
 * - -1 (бесконечность)
 * - true
 * - 1
 */
export function hasModule(
  modules: Record<string, any> | null | undefined,
  key: ModuleKey
): boolean {
  if (!modules) return false;
  const value = modules[key];
  return value === -1 || value === true || value === 1;
}