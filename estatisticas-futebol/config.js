/* ScanBall — configuração das contas (Supabase) e do servidor do ao vivo (Cloudflare).
 *
 * url      → "Project URL" do Supabase (Project Settings → API).
 * anonKey  → chave "anon public" (pode ficar pública: quem protege os dados são as regras RLS do banco).
 * aoVivo5d → endereço do servidor do ao vivo na Cloudflare (Worker), que busca a 5DollarFootballAPI para todos.
 *
 * Com url ou anonKey vazios, o botão "Entrar" não aparece e o site funciona sem contas.
 * NUNCA coloque aqui a senha do banco, a chave "service_role" ou a chave da 5Dollar.
 */
window.SB_CONFIG = {
  url: "https://gsotkmmpbdrlgxmfavoa.supabase.co",
  anonKey: "sb_publishable_uMvdvQJ_oFgb_Sw6H4kbMg_r8QB8RjG",
  aoVivo5d: "https://scanball-aovivo.pedroemilio-gnz.workers.dev",
};
