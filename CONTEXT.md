# Контекст проекта: Beauty Mini App

## Архитектура
- Telegram Mini App (React + Vite)
- Взаимодействует с CRM через API-роуты
- Определяет `shop_id` из `initData` или БД

## Ключевые файлы
| Файл | Что делает |
|------|------------|
| `src/App.tsx` | Корневой компонент. Маршрутизация |
| `src/lib/api.ts` | Все вызовы к API-роутам CRM |
| `src/ShopScreen.tsx` | Магазин (товары, сертификаты) |
| `src/MasterCabinet.tsx` | Кабинет мастера |
| `src/MasterLinkScreen.tsx` | Вход для сотрудников |
| `src/types.ts` | TypeScript типы |

## Связь с CRM
- Вызывает API через `apiBook()`, `apiBookCart()`, etc.
- Получает данные напрямую из Supabase (через `lib/supabase/client.ts`)
- Загружает категории, услуги, специалистов через `fetchCategories()`, `fetchPromos()`, `fetchSpecialists()`

## Важное правило
**Никогда не использовать глобальный токен в `tgSend()`** — всегда передавать `botToken` из таблицы `shops`. (это правило наследуется из CRM)

## Ссылки
- Документация архитектуры: [ссылка на Google Doc]
- Чат с обсуждением: [ссылка на этот чат]
