-- ScanBall · PASSO 1 (contas). Cole tudo no Supabase → SQL Editor → New query → Run.
-- Cria a tabela onde cada conta guarda favoritos, filtros e preferências.
-- As regras (RLS) garantem que cada pessoa só lê e altera a própria linha.

create table if not exists public.preferencias (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  dados        jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);

alter table public.preferencias enable row level security;

drop policy if exists "ler as proprias preferencias" on public.preferencias;
create policy "ler as proprias preferencias" on public.preferencias
  for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "criar as proprias preferencias" on public.preferencias;
create policy "criar as proprias preferencias" on public.preferencias
  for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "alterar as proprias preferencias" on public.preferencias;
create policy "alterar as proprias preferencias" on public.preferencias
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

grant select, insert, update on public.preferencias to authenticated;
revoke all on public.preferencias from anon;

-- Tabela do modo ao vivo (uma linha só, id = 1). Qualquer visitante pode LER; só a função "ao-vivo" escreve.
create table if not exists public.ao_vivo (
  id            int primary key default 1 check (id = 1),
  dados         jsonb not null default '{"jogos":[]}'::jsonb,
  atualizado_em timestamptz not null default now()
);
insert into public.ao_vivo (id) values (1) on conflict (id) do nothing;

alter table public.ao_vivo enable row level security;
drop policy if exists "todos leem o ao vivo" on public.ao_vivo;
create policy "todos leem o ao vivo" on public.ao_vivo for select to anon, authenticated using (true);
grant select on public.ao_vivo to anon, authenticated;
