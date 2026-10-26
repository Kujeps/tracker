# Трекер — AI-планер и трекер финансов в Telegram

Бот [@AI_Tracker_everything_bot](https://t.me/AI_Tracker_everything_bot): одной фразой записывает траты, доходы, встречи и напоминания. Полное ТЗ — в [SPEC.md](SPEC.md), правила разработки — в [CLAUDE.md](CLAUDE.md).

Бэкенд целиком в Supabase: Postgres и Edge Functions на Deno и TypeScript. Разработка идёт сразу на облачном проекте `vsoyzznzbwaedomvjcfe` (регион eu-west-1), без Docker и локального Supabase.

## Структура

```
deno.json                  зависимости (import map), задачи lint/check/test/set-webhook
.env.example               список переменных окружения
supabase/
  config.toml              настройки CLI; у функций verify_jwt = false
  migrations/              SQL-миграции (старые не правим, только новые)
  functions/
    _shared/               общий код: клиент БД, проверка секрета, пользователи
    telegram-webhook/      вебхук бота на grammY
scripts/
  set-webhook.ts           регистрация вебхука и списка команд
```

## Что нужно на машине

- [Deno](https://deno.com) 2.x — у нас лежит в `~/.deno/bin/deno`.
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) 2.x — у нас лежит в `~/.local/bin/supabase`.

Если их нет в `PATH`, добавь на время сессии терминала:

```bash
export PATH="$HOME/.deno/bin:$HOME/.local/bin:$PATH"
```

Docker и Node не нужны.

## Первый запуск

Все команды выполняются из корня репозитория.

1. Скопируй `.env.example` в `.env` и заполни значения. Откуда что брать, написано в комментариях.

2. Загрузи переменные из `.env` в текущий терминал. CLI берёт из окружения `SUPABASE_ACCESS_TOKEN`:

   ```bash
   set -a; source .env; set +a
   ```

3. Привяжи CLI к облачному проекту:

   ```bash
   supabase link --project-ref vsoyzznzbwaedomvjcfe -p "$SUPABASE_DB_PASSWORD"
   ```

4. Примени миграции к облачной базе. Прямой хост базы доступен только по IPv6, поэтому CLI ходит через pooler, строка подключения лежит в `SUPABASE_DB_URL`:

   ```bash
   supabase migration list --db-url "$SUPABASE_DB_URL"
   supabase db push --db-url "$SUPABASE_DB_URL"
   ```

5. Загрузи секреты функций: все непустые переменные из `.env`, кроме `SUPABASE_*`. Имена с префиксом `SUPABASE_` Supabase зарезервировал: `SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` функции получают автоматически.

   ```bash
   supabase secrets set --project-ref vsoyzznzbwaedomvjcfe --env-file <(grep -E '^[A-Z_]+=.+' .env | grep -v '^SUPABASE_')
   ```

   Проверить, что загрузилось (видны только имена и хэши):

   ```bash
   supabase secrets list --project-ref vsoyzznzbwaedomvjcfe
   ```

6. Выложи функцию. Сборка идёт на стороне Supabase, Docker не нужен:

   ```bash
   supabase functions deploy telegram-webhook --use-api --project-ref vsoyzznzbwaedomvjcfe
   ```

7. Зарегистрируй вебхук и список команд в Telegram:

   ```bash
   deno task set-webhook
   ```

   Скрипт печатает адрес вебхука, число апдейтов в очереди и последнюю ошибку доставки, если она была.

## Проверки перед сдачей этапа

```bash
deno task lint
deno task check
deno task test
```

Юнит-тесты не ходят ни в базу, ни в Telegram, ни в нейросеть.

## Как устроен вебхук

`telegram-webhook` принимает POST от Telegram и обрабатывает его так:

1. Сверяет заголовок `X-Telegram-Bot-Api-Secret-Token` с `TELEGRAM_WEBHOOK_SECRET` за постоянное время. Нет заголовка или он неверный — ответ `401`.
2. Пишет `update_id` в `processed_updates`. Если такой номер уже есть, отвечает `200` и ничего не делает: так Telegram не сможет доставить один апдейт дважды.
3. Передаёт апдейт в grammY. Если обработка упала, снимает отметку и отвечает `500`, чтобы Telegram прислал апдейт ещё раз.

`/start` создаёт строку в `users` по `telegram_id` (или обновляет имя и username) и отвечает приветствием.

## Зависимости

Версии закреплены в `imports` корневого `deno.json`. Этот же файл указан как `import_map` у функций в `supabase/config.toml` и уходит вместе с ними при деплое.
