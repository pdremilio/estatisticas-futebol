-- ScanBall · PASSO 2 (modo ao vivo). Rode SÓ depois de assinar o plano pago da API-Football
-- e publicar a função "ao-vivo" (veja CONFIGURAR-V4.txt).
-- Antes de rodar, troque:
--   SEU-PROJETO      → o código do seu projeto (o pedaço antes de .supabase.co no Project URL)
--   SEGREDO-DO-CRON  → o mesmo texto que você guardou no segredo CRON_SEGREDO da função
-- Este SQL fica só no seu Supabase. Não envie a versão preenchida para ninguém.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('scanball-ao-vivo') where exists (select 1 from cron.job where jobname = 'scanball-ao-vivo');

-- A cada minuto o banco chama a função; ela faz 4 rodadas de 15 s (só quando há jogo na janela).
select cron.schedule(
  'scanball-ao-vivo',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://SEU-PROJETO.supabase.co/functions/v1/ao-vivo',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-segredo', 'SEGREDO-DO-CRON'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);

-- Para DESLIGAR o modo ao vivo depois:  select cron.unschedule('scanball-ao-vivo');
