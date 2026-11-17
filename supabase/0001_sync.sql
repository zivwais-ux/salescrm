-- ============================================================================
--  סנכרון BENY — סכימה אחת, שתי פונקציות, בלי דלת צדדית.
--
--  המצב של המערכת הוא מסמך אחד (מכירות, יעדים, פעילות, הגדרות). הוא נשמר
--  כאן בשורה אחת, וכל מכשיר מושך ודוחף את אותה שורה. זה מספיק כי יש מנהל
--  אחד ושני מכשירים — לא צוות שעורך במקביל.
--
--  אבטחה: לטבלה אין אף מדיניות RLS, ולכן המפתח הציבורי שבדפדפן אינו יכול
--  לקרוא ממנה או לכתוב אליה כלל. הדרך היחידה פנימה היא שתי הפונקציות
--  למטה, ושתיהן דורשות את קוד הסנכרון. הקוד הוא הסיסמה, והוא לעולם אינו
--  נשמר בשרת: נשמר רק ה-sha256 שלו, ולכן גם מי שרואה את מסד הנתונים אינו
--  יכול להתחזות למכשיר.
--
--  התנגשות: לכל שמירה יש מספר גרסה. מכשיר שדוחף מצהיר על הגרסה שראה; אם
--  בינתיים מכשיר אחר שמר, הדחיפה נדחית ומוחזר מה שיש בשרת. המכשיר מראה
--  את זה למשתמש במקום לדרוס בשקט.
-- ============================================================================

-- הודעות השגיאה כאן באנגלית בכוונה: הן נוסעות דרך שכבות שאינן שלנו,
-- והלקוח ממילא בודק את הקוד לפני השליחה ואומר את הדברים בעברית בעצמו.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.beny_state (
  room        text primary key,
  payload     jsonb       not null,
  version     bigint      not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

alter table public.beny_state enable row level security;
-- במכוון: אין כאן אף policy. המפתח הציבורי אינו מגיע לטבלה.

revoke all on public.beny_state from anon, authenticated;

/* החדר נגזר מהקוד ולא נשמר לצידו. */
create or replace function public.beny_room(p_code text)
returns text
language sql
immutable
set search_path = extensions, public
as $$
  select encode(digest(coalesce(p_code, ''), 'sha256'), 'hex');
$$;

/* משיכה: מה שיש בשרת לחדר הזה, או שום דבר אם הקוד אינו מוכר. */
create or replace function public.beny_pull(p_code text)
returns table (payload jsonb, version bigint, updated_at timestamptz, updated_by text)
language sql
security definer
set search_path = public, extensions
as $$
  select s.payload, s.version, s.updated_at, s.updated_by
  from public.beny_state s
  where s.room = public.beny_room(p_code)
    and length(coalesce(p_code, '')) >= 16;
$$;

/*
 * דחיפה עם שמירה על הגרסה.
 *   p_base = הגרסה שהמכשיר ראה לאחרונה; 0 למכשיר שעוד לא סונכרן,
 *            ו-null כשהמשתמש בחר במפורש לדרוס את מה שבענן.
 * מחזירה ok=false ואת העותק שבשרת כשהגרסה כבר התקדמה.
 */
create or replace function public.beny_push(
  p_code text, p_payload jsonb, p_base bigint default null, p_by text default null)
returns table (ok boolean, version bigint, payload jsonb,
               updated_at timestamptz, updated_by text)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_room    text;
  v_current public.beny_state%rowtype;
begin
  if length(coalesce(p_code, '')) < 16 then
    raise exception 'code too short';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid state';
  end if;
  -- גבול שפוי: המצב כולו הוא מסמך אחד, ואין סיבה שיעבור כמה מגהבייטים.
  if pg_column_size(p_payload) > 8 * 1024 * 1024 then
    raise exception 'state too large';
  end if;

  v_room := public.beny_room(p_code);
  select * into v_current from public.beny_state s where s.room = v_room for update;

  if not found then
    insert into public.beny_state (room, payload, version, updated_by)
    values (v_room, p_payload, 1, left(coalesce(p_by, ''), 60))
    returning beny_state.version, beny_state.payload,
              beny_state.updated_at, beny_state.updated_by
      into version, payload, updated_at, updated_by;
    ok := true;
    return next;
    return;
  end if;

  -- null = המשתמש הכריע בהתנגשות ובחר להעלות את המכשיר הזה.
  if p_base is not null and p_base is distinct from v_current.version then
    ok := false;
    version := v_current.version;
    payload := v_current.payload;
    updated_at := v_current.updated_at;
    updated_by := v_current.updated_by;
    return next;
    return;
  end if;

  update public.beny_state s
     set payload = p_payload,
         version = s.version + 1,
         updated_at = now(),
         updated_by = left(coalesce(p_by, ''), 60)
   where s.room = v_room
  returning s.version, s.payload, s.updated_at, s.updated_by
    into version, payload, updated_at, updated_by;
  ok := true;
  return next;
end;
$$;

revoke all on function public.beny_pull(text) from public;
revoke all on function public.beny_push(text, jsonb, bigint, text) from public;
grant execute on function public.beny_pull(text) to anon, authenticated;
grant execute on function public.beny_push(text, jsonb, bigint, text) to anon, authenticated;
