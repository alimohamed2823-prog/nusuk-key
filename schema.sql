-- نفّذ هذا الملف في Supabase SQL Editor
create extension if not exists pgcrypto;

create table if not exists public.nusuk_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  constraint nusuk_code_format check (code ~ '^NG-[A-Za-z0-9]{8}$')
);

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

insert into public.nusuk_codes(code, is_pinned)
values ('NG-moe8R4N6', true)
on conflict (code) do update set is_pinned = true;

alter table public.nusuk_codes enable row level security;
alter table public.site_admins enable row level security;

drop policy if exists "Anyone can read codes" on public.nusuk_codes;
create policy "Anyone can read codes" on public.nusuk_codes
for select to anon, authenticated using (true);

drop policy if exists "Anyone can submit codes" on public.nusuk_codes;
create policy "Anyone can submit codes" on public.nusuk_codes
for insert to anon, authenticated with check (is_pinned = false);

drop policy if exists "Admins can delete codes" on public.nusuk_codes;
create policy "Admins can delete codes" on public.nusuk_codes
for delete to authenticated using (
  exists (select 1 from public.site_admins a where a.user_id = auth.uid())
  and is_pinned = false
);

drop policy if exists "Admins can read own admin row" on public.site_admins;
create policy "Admins can read own admin row" on public.site_admins
for select to authenticated using (user_id = auth.uid());

grant select on public.nusuk_codes to anon, authenticated;
grant insert on public.nusuk_codes to anon, authenticated;
grant delete on public.nusuk_codes to authenticated;
grant select on public.site_admins to authenticated;

-- بعد إنشاء مستخدم المدير من Authentication > Users، أضف UUID الخاص به هكذا:
-- insert into public.site_admins(user_id) values ('ضع-هنا-UUID-المدير');
