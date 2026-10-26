-- Категории по умолчанию: общие для всех (user_id is null).
-- Повторный запуск ничего не дублирует.
insert into public.categories (kind, name, sort)
values
  ('expense', 'Продукты', 10),
  ('expense', 'Кафе и рестораны', 20),
  ('expense', 'Транспорт', 30),
  ('expense', 'Такси', 40),
  ('expense', 'Дом и ЖКХ', 50),
  ('expense', 'Связь и интернет', 60),
  ('expense', 'Здоровье', 70),
  ('expense', 'Красота', 80),
  ('expense', 'Одежда и обувь', 90),
  ('expense', 'Развлечения', 100),
  ('expense', 'Подписки', 110),
  ('expense', 'Подарки', 120),
  ('expense', 'Образование', 130),
  ('expense', 'Животные', 140),
  ('expense', 'Другое', 150),
  ('income', 'Зарплата', 10),
  ('income', 'Подработка', 20),
  ('income', 'Переводы', 30),
  ('income', 'Кэшбэк', 40),
  ('income', 'Другое', 50)
on conflict (kind, name) where user_id is null do nothing;
