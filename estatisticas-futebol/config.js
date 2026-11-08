/* ScanBall — configuração do servidor de contas e do modo ao vivo (Supabase).
 *
 * url     → "Project URL" do Supabase (Project Settings → API). Ex.: "https://abcdxyz.supabase.co"
 * anonKey → chave "anon public" (pode ficar pública: quem protege os dados são as regras RLS do banco).
 * aoVivo  → deixe false até assinar o plano pago da API-Football e ligar a função "ao-vivo".
 * aoVivo5d → endereço do servidor do ao vivo na Cloudflare (Worker), ex.: "https://scanball-aovivo.SEU-NOME.workers.dev".
 *            Vazio = o site não usa o servidor (só a chave pessoal salva no navegador, se houver).
 *
 * Com url ou anonKey vazios, o botão "Entrar" não aparece e o site funciona como antes.
 * NUNCA coloque aqui a senha do banco nem a chave "service_role".
 */
window.SB_CONFIG = {
  url: "https://gsotkmmpbdrlgxmfavoa.supabase.co",
  anonKey: "sb_publishable_uMvdvQJ_oFgb_Sw6H4kbMg_r8QB8RjG",
  aoVivo: false,
  aoVivo5d: "https://scanball-aovivo.pedroemilio-gnz.workers.dev",
};
