# Трекер — AI-планер и трекер финансов в Telegram

Бот [@AI_Tracker_everything_bot](https://t.me/AI_Tracker_everything_bot): одной фразой записывает траты, доходы, встречи и напоминания. Полное ТЗ — в [SPEC.md](SPEC.md), правила разработки — в [CLAUDE.md](CLAUDE.md).

Бэкенд целиком в Supabase: Postgres и Edge Functions на Deno и TypeScript. Разработка идёт сразу на облачном проекте `vsoyzznzbwaedomvjcfe` (регион eu-west-1), без Docker и локального Supabase.

## Структура

```
deno.json                  зависимости (import map), задачи lint/check/test/set-webhook/golden
.env.example               список переменных окружения
supabase/
  config.toml              настройки CLI; у функций verify_jwt = false
  migrations/              SQL-миграции (старые не правим, только новые)
  seed.sql                 категории по умолчанию
  functions/
    _shared/
      ingest.ts            фраза → записи → подтверждение (общий вход для всех источников)
      parser/              промпт, схема zod, цепочка вызовов, проверки смысла
      llm/                 LlmProvider и OpenRouter
      store.ts             интерфейс доступа к данным; store-supabase.ts — реализация
      confirmation.ts      текст подтверждения; query.ts — ответы на вопросы
      telegram.ts          кнопки и callback_data
      time.ts, timezones.ts, recurrence.ts, money.ts — даты, пояса, повторы, деньги
      testing/             база в памяти и заготовки для юнит-тестов
    telegram-webhook/      вебхук бота на grammY: bot.ts — обработчики, views.ts — тексты команд
scripts/
  set-webhook.ts           регистрация вебхука и списка команд
  parser-golden.ts         эталонный прогон парсера через настоящую нейросеть
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

4. Примени миграции к облачной базе. Прямой хост базы доступен только по IPv6, поэтому CLI ходит через pooler, строка подключения лежит в `SUPABASE_DB_URL`. Флаг `--include-seed` заодно загружает категории по умолчанию из `supabase/seed.sql` (повторный запуск ничего не дублирует):

   ```bash
   supabase migration list --db-url "$SUPABASE_DB_URL"
   supabase db push --db-url "$SUPABASE_DB_URL" --include-seed
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

Юнит-тесты не ходят ни в базу, ни в Telegram, ни в нейросеть: вместо базы — `_shared/testing/memory-store.ts`, вместо нейросети — ответы по сценарию.

## Эталонный прогон парсера

Перед сменой промпта или модели прогони 37 эталонных фраз через настоящую нейросеть. Момент проверки зафиксирован: 2026-10-26 15:51, понедельник, Europe/Samara.

```bash
deno task golden
```

Скрипт печатает ✓ или ✗ по каждой фразе, точность и сколько раз отвечала запасная модель. Прогон пройден, если точность не ниже 90% и все 11 фраз из таблицы в SPEC.md разобраны верно. Флаги: `--spec` — только 11 фраз из SPEC.md, `--only=3,7` — выбранные номера, `--delay=3000` — пауза между фразами в мс.

Полный прогон — около 40–75 вызовов нейросети: на бесплатном тарифе OpenRouter это заметная часть дневного лимита в 50 запросов.

## Как устроен вебхук

`telegram-webhook` принимает POST от Telegram и обрабатывает его так:

1. Сверяет заголовок `X-Telegram-Bot-Api-Secret-Token` с `TELEGRAM_WEBHOOK_SECRET` за постоянное время. Нет заголовка или он неверный — ответ `401`.
2. Пишет `update_id` в `processed_updates`. Если такой номер уже есть, отвечает `200` и ничего не делает: так Telegram не сможет доставить один апдейт дважды.
3. Передаёт апдейт в grammY. Если обработка упала, снимает отметку и отвечает `500`, чтобы Telegram прислал апдейт ещё раз.

`/start` создаёт строку в `users` по `telegram_id` (или обновляет имя и username), здоровается и предлагает выбрать часовой пояс кнопками. «Другой» — пояс текстом ответом на сообщение бота: `Europe/Berlin` или `UTC+4`.

## Как бот разбирает фразы

Любой текст, кроме команды, идёт в `ingest`:

1. Лимиты: не больше 20 фраз в минуту на человека и `LLM_DAILY_CAP` фраз через нейросеть в сутки на весь сервис (сутки по UTC). На потолке бот отвечает отказом и шлёт алерт админам из `ADMIN_TELEGRAM_IDS`.
2. Если 10 минут назад бот задал уточняющий вопрос, ответ склеивается с исходной фразой.
3. Парсер: основная модель в JSON-режиме → один повтор с текстом ошибки → запасная модель со structured output → «Не понял, перефразируй». Таймаут, 429 и прочие сбои сети основной модели сразу ведут к запасной.
4. Код проверяет смысл (сумма до 100 млн, трата не позже чем через сутки, встреча не в прошлом) и при нарушении задаёт вопрос, ничего не сохраняя. Копейки, моменты в UTC и ближайшее срабатывание повтора считает код.
5. Записи фразы сохраняются, в `entries` пишутся модель, токены и время ответа. Бот отвечает подтверждением с кнопками «Отменить» (48 часов, убирает все записи фразы) и «Категория» (для трат).

Вопросы вроде «сколько я потратил на кафе в октябре» модель только распознаёт, суммы считает SQL-функция `transaction_totals`.

Важно про модели: бесплатная `google/gemma-4-26b-a4b-it:free` часто отвечает 429 из-за общей очереди у Google, поэтому на деле большинство фраз разбирает платная запасная модель. У двух провайдеров платной модели structured output сломан, они исключены в `_shared/llm/openrouter.ts`.

## Зависимости

Версии закреплены в `imports` корневого `deno.json`. Этот же файл указан как `import_map` у функций в `supabase/config.toml` и уходит вместе с ними при деплое.
