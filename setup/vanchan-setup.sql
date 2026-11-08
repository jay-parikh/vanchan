-- Vanchan sync: run once in the Supabase SQL editor of the Vanchan project.
-- Safe to run again.
--
-- Every row and every stored file belongs to the signed-in Google user who
-- wrote it; the rules below let each user see and change only their own.

-- ---------- books (one row per book, known by the SHA-256 of its file) ----------
create table if not exists public.vanchan_books (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_key   text not null check (book_key ~ '^[0-9a-f]{64}$'),
  title      text not null default '',
  title_at   bigint not null default 0,          -- when the title was last set (ms)
  kind       text not null default 'pdf' check (kind in ('pdf', 'epub', 'md')),
  size       bigint not null default 0,
  file_name  text not null default '',
  added      bigint not null default 0,
  deleted    boolean not null default false,     -- deleted on all devices
  deleted_at bigint,
  updated_at timestamptz not null default now(),
  primary key (user_id, book_key)
);

-- ---------- reading progress (one row per book) ----------
create table if not exists public.vanchan_progress (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  book_key   text not null check (book_key ~ '^[0-9a-f]{64}$'),
  parser     int not null default 1,              -- card numbers below are for this parser version
  read       jsonb not null default '{}'::jsonb,  -- { card number: time read }
  read_reset bigint not null default 0,           -- "mark all unread" time
  marks      jsonb not null default '{}'::jsonb,  -- { card number: +time saved / -time unsaved }
  hidden     jsonb not null default '{}'::jsonb,  -- same, for hidden cards
  pos        jsonb,                               -- last card read: { n, at, device, name }
  updated_at timestamptz not null default now(),
  primary key (user_id, book_key)
);

create or replace function public.vanchan_touch() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists vanchan_books_touch on public.vanchan_books;
create trigger vanchan_books_touch before update on public.vanchan_books
  for each row execute function public.vanchan_touch();
drop trigger if exists vanchan_progress_touch on public.vanchan_progress;
create trigger vanchan_progress_touch before update on public.vanchan_progress
  for each row execute function public.vanchan_touch();

-- ---------- owner-only access ----------
alter table public.vanchan_books enable row level security;
alter table public.vanchan_progress enable row level security;

revoke all on public.vanchan_books, public.vanchan_progress from anon;
grant select, insert, update, delete on public.vanchan_books, public.vanchan_progress to authenticated;

do $$
declare t text;
begin
  foreach t in array array['vanchan_books', 'vanchan_progress'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
  end loop;
end $$;

-- ---------- book files: private bucket, one folder per user ----------
insert into storage.buckets (id, name, public, file_size_limit)
values ('vanchan-books', 'vanchan-books', false, 52428800)   -- 50 MB per book
on conflict (id) do nothing;

drop policy if exists vanchan_files_select on storage.objects;
drop policy if exists vanchan_files_insert on storage.objects;
drop policy if exists vanchan_files_update on storage.objects;
drop policy if exists vanchan_files_delete on storage.objects;

create policy vanchan_files_select on storage.objects for select to authenticated
  using (bucket_id = 'vanchan-books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy vanchan_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vanchan-books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy vanchan_files_update on storage.objects for update to authenticated
  using (bucket_id = 'vanchan-books' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy vanchan_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'vanchan-books' and (storage.foldername(name))[1] = (select auth.uid())::text);
