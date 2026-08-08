# Контекст проекта: Beauty Mini App

## Архитектура
- Telegram Mini App (React + Vite)
- Взаимодействует с CRM через API-роуты
- Определяет `shop_id` из `initData` или БД

## Ключевые файлы
| Файл | Что делает |
|------|------------|
| `src/lib/api.ts` | Все вызовы к API-роутам CRM |
| `src/App.tsx` | Корневой компонент. Маршрутизация |
| `src/ShopScreen.tsx` | Магазин (товары, сертификаты) |
| `src/MasterCabinet.tsx` | Кабинет мастера |

## Связь с CRM
- Вызывает API через `apiBook()`, `apiBookCart()`, etc.
- Получает данные напрямую из Supabase (через `lib/supabase/client.ts`)