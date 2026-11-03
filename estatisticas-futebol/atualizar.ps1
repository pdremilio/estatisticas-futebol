# Estatísticas de Futebol - atualizador de dados (PowerShell, já vem no Windows)
# Baixa partidas, classificação e artilharia da football-data.org e grava "dados.js".
# Uso: dois cliques em atualizar.bat  (ou: powershell -ExecutionPolicy Bypass -File atualizar.ps1 BSA PL)

$ErrorActionPreference = 'Stop'

# Copa do Mundo (WC) e Eurocopa (EC) ficaram de fora porque já acabaram.
# Competições baixadas por padrão. Tire as que não quiser para ficar mais rápido.
$COMPETICOES = @('BSA', 'PL', 'PD', 'SA', 'BL1', 'FL1', 'PPL', 'DED', 'ELC', 'CL')
$ARTILHEIROS = 30

# Odds das casas (opcional): chave da The Odds API em chave_odds.txt (plano grátis: 500 créditos/mês).
# Cada liga buscada gasta 1 crédito. Só busca ligas com jogo nos próximos 3 dias e no máximo a cada 12 horas.
$ODDS_HORAS = 12
$ODDS_DIAS = 3
$ODDS_LIGAS = @{
    BSA = 'soccer_brazil_campeonato'; PL = 'soccer_epl'; PD = 'soccer_spain_la_liga'; SA = 'soccer_italy_serie_a'
    BL1 = 'soccer_germany_bundesliga'; FL1 = 'soccer_france_ligue_one'; PPL = 'soccer_portugal_primeira_liga'
    DED = 'soccer_netherlands_eredivisie'; ELC = 'soccer_efl_champ'; CL = 'soccer_uefa_champs_league'
}
$INTERVALO = 6.5   # segundos entre chamadas (plano grátis: 10 por minuto)

$BASE = 'https://api.football-data.org/v4'
if ($env:FD_BASE) { $BASE = $env:FD_BASE }
if ($env:FD_INTERVALO) { $INTERVALO = [double]$env:FD_INTERVALO }

$PASTA = Split-Path -Parent $MyInvocation.MyCommand.Path
$ARQ_CHAVE = Join-Path $PASTA 'chave_api.txt'
$ARQ_SAIDA = Join-Path $PASTA 'dados.js'
$ARQ_CHAVE_ODDS = Join-Path $PASTA 'chave_odds.txt'
$ODDS_BASE = 'https://api.the-odds-api.com'
if ($env:ODDS_BASE) { $ODDS_BASE = $env:ODDS_BASE }
$UTF8 = New-Object System.Text.UTF8Encoding($false)

try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

# ------------------------------------------------------------------ chave
function Obter-Chave {
    if ($env:FOOTBALL_DATA_KEY) { return $env:FOOTBALL_DATA_KEY.Trim() }
    if (Test-Path $ARQ_CHAVE) {
        $c = ([IO.File]::ReadAllText($ARQ_CHAVE)).Trim()
        if ($c) { return $c }
    }
    Write-Host 'Cole sua chave da football-data.org (fica salva em chave_api.txt):'
    $c = (Read-Host '>').Trim()
    if (-not $c) { throw 'Sem chave não dá para baixar os dados.' }
    [IO.File]::WriteAllText($ARQ_CHAVE, $c, $UTF8)
    return $c
}

# ------------------------------------------------------------------ chamada à API
$script:ultima = [DateTime]::MinValue

function Chamar([string]$caminho, [string]$chave) {
    for ($tentativa = 1; $tentativa -le 3; $tentativa++) {
        $passou = ([DateTime]::Now - $script:ultima).TotalSeconds
        if ($passou -lt $INTERVALO) { Start-Sleep -Milliseconds ([int](($INTERVALO - $passou) * 1000)) }
        $script:ultima = [DateTime]::Now
        try {
            $resp = Invoke-WebRequest -Uri ($BASE + $caminho) -Headers @{ 'X-Auth-Token' = $chave } -UseBasicParsing -TimeoutSec 40
            $ms = New-Object IO.MemoryStream
            $resp.RawContentStream.Position = 0
            $resp.RawContentStream.CopyTo($ms)
            $texto = [Text.Encoding]::UTF8.GetString($ms.ToArray())
            return ($texto | ConvertFrom-Json)
        } catch {
            $codigo = $null
            $r = $_.Exception.Response
            if ($r) { try { $codigo = [int]$r.StatusCode } catch {} }
            if ($codigo -eq 429) {
                $espera = 62
                try { $h = $r.Headers['X-RequestCounter-Reset']; if ($h) { $espera = [int]$h + 2 } } catch {}
                Write-Host "   limite de chamadas atingido, aguardando $espera s..."
                Start-Sleep -Seconds $espera
                continue
            }
            if ($codigo -in 400, 403, 404) { throw "HTTP $codigo" }
            if ($tentativa -eq 3) {
                if ($codigo) { throw "HTTP $codigo" } else { throw "sem conexão ($($_.Exception.Message))" }
            }
            Start-Sleep -Seconds 5
        }
    }
    throw 'falhou após várias tentativas'
}

# ------------------------------------------------------------------ conversão
function Registrar-Time($times, $t) {
    if (-not $t -or $null -eq $t.id) { return $null }
    $id = [string]$t.id
    $atual = $times[$id]
    $nome = $t.name; if (-not $nome -and $atual) { $nome = $atual.n }; if (-not $nome) { $nome = '?' }
    $curto = $t.shortName; if (-not $curto -and $atual) { $curto = $atual.c }; if (-not $curto) { $curto = $nome }
    $sigla = $t.tla; if (-not $sigla -and $atual) { $sigla = $atual.t }; if (-not $sigla) { $sigla = '' }
    $esc = $t.crest; if (-not $esc -and $atual) { $esc = $atual.e }; if (-not $esc) { $esc = '' }
    $times[$id] = [ordered]@{ n = $nome; c = $curto; t = $sigla; e = $esc }
    return $id
}

function Baixar-Competicao([string]$code, [string]$chave, $times) {
    $comp = [ordered]@{ code = $code }

    # 1) partidas
    $dados = Chamar "/competitions/$code/matches" $chave
    $c = $dados.competition
    $comp.nome = if ($c -and $c.name) { $c.name } else { $code }
    $comp.emblema = if ($c -and $c.emblem) { $c.emblem } else { '' }
    $comp.tipo = if ($c -and $c.type) { $c.type } else { 'LEAGUE' }
    $partidas = New-Object System.Collections.Generic.List[object]
    $temporada = $null
    foreach ($m in @($dados.matches)) {
        if (-not $m) { continue }
        if (-not $temporada -and $m.season) { $temporada = $m.season }
        $h = Registrar-Time $times $m.homeTeam
        $a = Registrar-Time $times $m.awayTeam
        $s = $m.score
        $ft = $null; $ht = $null
        if ($s) { $ft = $s.regularTime; if (-not $ft) { $ft = $s.fullTime }; $ht = $s.halfTime }
        $partidas.Add([ordered]@{
            i = $m.id; d = $m.utcDate; s = $m.status; r = $m.matchday; f = $m.stage; g = $m.group
            h = $h; a = $a
            fh = $(if ($ft) { $ft.home } else { $null }); fa = $(if ($ft) { $ft.away } else { $null })
            hh = $(if ($ht) { $ht.home } else { $null }); ha = $(if ($ht) { $ht.away } else { $null })
            du = $(if ($s) { $s.duration } else { $null }); w = $(if ($s) { $s.winner } else { $null })
        })
    }
    $comp.partidas = $partidas
    if ($temporada) {
        $comp.temporada = [ordered]@{ inicio = $temporada.startDate; fim = $temporada.endDate; rodada = $temporada.currentMatchday }
    }

    # 2) classificação
    $tabelas = New-Object System.Collections.Generic.List[object]
    try {
        $dados = Chamar "/competitions/$code/standings" $chave
        foreach ($st in @($dados.standings)) {
            if (-not $st) { continue }
            $linhas = New-Object System.Collections.Generic.List[object]
            foreach ($l in @($st.table)) {
                if (-not $l) { continue }
                $tid = Registrar-Time $times $l.team
                $linhas.Add([ordered]@{
                    p = $l.position; t = $tid; j = $l.playedGames; v = $l.won; e = $l.draw; d = $l.lost
                    gp = $l.goalsFor; gc = $l.goalsAgainst; sg = $l.goalDifference; pts = $l.points; forma = $l.form
                })
            }
            $tabelas.Add([ordered]@{ fase = $st.stage; tipo = $st.type; grupo = $st.group; tabela = $linhas })
        }
    } catch { Write-Host "   classificação indisponível: $($_.Exception.Message)" }
    $comp.classificacao = $tabelas

    # 3) artilharia
    $art = New-Object System.Collections.Generic.List[object]
    try {
        $dados = Chamar "/competitions/$code/scorers?limit=$ARTILHEIROS" $chave
        foreach ($sc in @($dados.scorers)) {
            if (-not $sc) { continue }
            $p = $sc.player
            $art.Add([ordered]@{
                nome = $p.name; nac = $p.nationality; pos = $(if ($p.section) { $p.section } else { $p.position })
                t = (Registrar-Time $times $sc.team); jogos = $sc.playedMatches; gols = $sc.goals
                ass = $sc.assists; pen = $sc.penalties
            })
        }
    } catch { Write-Host "   artilharia indisponível: $($_.Exception.Message)" }
    $comp.artilharia = $art

    $comp.atualizado_em = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss+00:00')
    return $comp
}


# ------------------------------------------------------------------ odds das casas
$GENERICOS = @('fc','afc','cf','sc','ec','ac','as','ss','club','clube','de','da','do','del','futebol','football','calcio','cd','ud','fk','sv','sad','the','and','esporte')

function Obter-ChaveOdds {
    if ($env:ODDS_API_KEY) { return $env:ODDS_API_KEY.Trim() }
    if (Test-Path $ARQ_CHAVE_ODDS) { $c = ([IO.File]::ReadAllText($ARQ_CHAVE_ODDS)).Trim(); if ($c) { return $c } }
    return $null
}

function Tokens([string]$nome) {
    if (-not $nome) { return @() }
    $n = $nome.Normalize([Text.NormalizationForm]::FormD)
    $sb = New-Object Text.StringBuilder
    foreach ($ch in $n.ToCharArray()) {
        if ([Globalization.CharUnicodeInfo]::GetUnicodeCategory($ch) -ne [Globalization.UnicodeCategory]::NonSpacingMark) { [void]$sb.Append($ch) }
    }
    $lista = New-Object System.Collections.Generic.List[string]
    foreach ($t in ($sb.ToString().ToLower() -split '[^a-z0-9]+')) {
        if ($t.Length -ge 2 -and $GENERICOS -notcontains $t -and -not $lista.Contains($t)) { $lista.Add($t) }
    }
    return $lista.ToArray()
}

function Parecido($a, $b) {
    if (-not $a -or -not $b -or $a.Count -eq 0 -or $b.Count -eq 0) { return 0.0 }
    $hits = 0
    foreach ($x in $a) {
        foreach ($y in $b) {
            if ($x -eq $y -or ([math]::Min($x.Length, $y.Length) -ge 4 -and ($x.StartsWith($y) -or $y.StartsWith($x)))) { $hits++; break }
        }
    }
    return $hits / [math]::Min($a.Count, $b.Count)
}

function Para-Data($v) {
    if ($v -is [DateTime]) { return $v.ToUniversalTime() }
    return [DateTime]::Parse([string]$v, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal -bor [Globalization.DateTimeStyles]::AssumeUniversal)
}

function Casar-Evento($ev, $comp, $times) {
    try { $quando = Para-Data $ev.commence_time } catch { return $null }
    $th = @(Tokens $ev.home_team); $ta = @(Tokens $ev.away_team)
    $melhor = $null; $nota = 0.0
    foreach ($p in $comp.partidas) {
        if (@('SCHEDULED','TIMED','IN_PLAY','PAUSED') -notcontains $p.s -or -not $p.h -or -not $p.a) { continue }
        $dif = [math]::Abs(((Para-Data $p.d) - $quando).TotalSeconds)
        if ($dif -gt 3 * 3600) { continue }
        $h = $times[[string]$p.h]; $a = $times[[string]$p.a]
        if (-not $h -or -not $a) { continue }
        $sh = Parecido $th (@(Tokens $h.n) + @(Tokens $h.c))
        $sa = Parecido $ta (@(Tokens $a.n) + @(Tokens $a.c))
        if ($sh -eq 0 -or $sa -eq 0) { continue }
        $n = $sh + $sa - $dif / 86400
        if ($n -gt $nota) { $melhor = $p; $nota = $n }
    }
    return $melhor
}

function Resumir-Odds($ev) {
    $c = New-Object System.Collections.Generic.List[double]; $e = New-Object System.Collections.Generic.List[double]; $f = New-Object System.Collections.Generic.List[double]
    foreach ($bk in @($ev.bookmakers)) {
        foreach ($mk in @($bk.markets)) {
            if ($mk.key -ne 'h2h') { continue }
            foreach ($o in @($mk.outcomes)) {
                if (-not $o.price) { continue }
                if ($o.name -eq $ev.home_team) { $c.Add([double]$o.price) }
                elseif ($o.name -eq $ev.away_team) { $f.Add([double]$o.price) }
                elseif ([string]$o.name -eq 'Draw') { $e.Add([double]$o.price) }
            }
        }
    }
    if ($c.Count -eq 0 -or $f.Count -eq 0) { return $null }
    $r = [ordered]@{ n = $c.Count }
    foreach ($par in @(@('c', $c), @('e', $e), @('f', $f))) {
        $l = $par[1]
        if ($l.Count) {
            $r[$par[0]] = [math]::Round(($l | Measure-Object -Average).Average, 2)
            $r['m' + $par[0]] = [math]::Round(($l | Measure-Object -Maximum).Maximum, 2)
        }
    }
    return $r
}

function Precisa-Odds($code, $comp, $agora) {
    if (-not $ODDS_LIGAS.ContainsKey($code)) { return $false }
    if ($comp.odds_em) {
        try { if (($agora - (Para-Data $comp.odds_em)).TotalHours -lt $ODDS_HORAS) { return $false } } catch {}
    }
    $limite = $agora.AddDays($ODDS_DIAS)
    foreach ($p in $comp.partidas) {
        if (@('SCHEDULED','TIMED') -contains $p.s) {
            $d = Para-Data $p.d
            if ($d -ge $agora -and $d -le $limite) { return $true }
        }
    }
    return $false
}

function Atualizar-Odds($competicoes, $times, [string]$chaveOdds) {
    $agora = [DateTime]::UtcNow
    Write-Host ''
    Write-Host 'Odds das casas (The Odds API):'
    foreach ($code in @($competicoes.Keys)) {
        $comp = $competicoes[$code]
        if (-not (Precisa-Odds $code $comp $agora)) { continue }
        $url = "$ODDS_BASE/v4/sports/$($ODDS_LIGAS[$code])/odds/?apiKey=$chaveOdds&regions=eu&markets=h2h&oddsFormat=decimal&dateFormat=iso"
        try {
            $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 40
            $ms = New-Object IO.MemoryStream; $resp.RawContentStream.Position = 0; $resp.RawContentStream.CopyTo($ms)
            $eventos = @([Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json)
            $restantes = $resp.Headers['x-requests-remaining']
        } catch {
            $cod = $null; try { $cod = [int]$_.Exception.Response.StatusCode } catch {}
            if ($cod -eq 401 -or $cod -eq 429) { Write-Host "   ${code}: créditos do mês acabaram ou chave inválida (HTTP $cod)"; return }
            Write-Host "   ${code}: erro ($($_.Exception.Message))"; continue
        }
        $odds = [ordered]@{}
        foreach ($ev in $eventos) {
            if (-not $ev) { continue }
            $p = Casar-Evento $ev $comp $times
            if ($p) { $r = Resumir-Odds $ev; if ($r) { $odds[[string]$p.i] = $r } }
        }
        if ($comp -is [System.Collections.IDictionary]) { $comp['odds'] = $odds; $comp['odds_em'] = $agora.ToString('yyyy-MM-ddTHH:mm:ss+00:00') }
        else {
            $comp | Add-Member -NotePropertyName odds -NotePropertyValue $odds -Force
            $comp | Add-Member -NotePropertyName odds_em -NotePropertyValue $agora.ToString('yyyy-MM-ddTHH:mm:ss+00:00') -Force
        }
        $txt = "   ${code}: odds de $($odds.Count) de $($eventos.Count) jogos"
        if ($restantes) { $txt += " · créditos restantes: $restantes" }
        Write-Host $txt
    }
}

function Ler-Anterior {
    if (-not (Test-Path $ARQ_SAIDA)) { return $null }
    try {
        $txt = [IO.File]::ReadAllText($ARQ_SAIDA, $UTF8)
        $ini = $txt.IndexOf('{'); $fim = $txt.LastIndexOf('}')
        return ($txt.Substring($ini, $fim - $ini + 1) | ConvertFrom-Json)
    } catch { return $null }
}

# ------------------------------------------------------------------ principal
$pedidas = @($args | ForEach-Object { ([string]$_).ToUpper() })
if ($pedidas.Count -eq 0) { $pedidas = $COMPETICOES }
$chave = Obter-Chave

$times = @{}
$competicoes = [ordered]@{}
$anterior = Ler-Anterior
if ($anterior) {
    foreach ($p in $anterior.times.PSObject.Properties) { $times[$p.Name] = $p.Value }
    foreach ($p in $anterior.competicoes.PSObject.Properties) { if (@('WC','EC') -notcontains $p.Name) { $competicoes[$p.Name] = $p.Value } }
}

$total = $pedidas.Count
$minutos = [math]::Round($total * 3 * $INTERVALO / 60)
Write-Host "Atualizando $total competição(ões). Leva cerca de $minutos min por causa do limite da API."
Write-Host ''

$falhas = New-Object System.Collections.Generic.List[string]
$n = 0
foreach ($code in $pedidas) {
    $n++
    Write-Host "[$n/$total] $code..."
    try {
        $comp = Baixar-Competicao $code $chave $times
        $velho = $competicoes[$code]
        if ($velho -and $velho.odds) { $comp.odds = $velho.odds; $comp.odds_em = $velho.odds_em }
        $competicoes[$code] = $comp
        $fin = @($comp.partidas | Where-Object { $_.s -eq 'FINISHED' }).Count
        Write-Host "   ok: $($comp.partidas.Count) partidas ($fin encerradas)"
    } catch {
        $falhas.Add($code)
        Write-Host "   erro: $($_.Exception.Message)"
        if ($_.Exception.Message -match 'HTTP 40[03]') {
            Write-Host '   (confira se a chave em chave_api.txt está certa)'
        }
    }
}

$chaveOdds = Obter-ChaveOdds
if ($chaveOdds) { Atualizar-Odds $competicoes $times $chaveOdds }
else { Write-Host ''; Write-Host '(Odds das casas desligadas: para ligar, coloque a chave da The Odds API em chave_odds.txt.)' }

$saida = [ordered]@{
    versao = 1
    fonte = 'football-data.org'
    gerado_em = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss+00:00')
    times = $times
    competicoes = $competicoes
}
$json = $saida | ConvertTo-Json -Depth 12 -Compress
[IO.File]::WriteAllText($ARQ_SAIDA, "window.DADOS = $json;`n", $UTF8)

$kb = [math]::Round((Get-Item $ARQ_SAIDA).Length / 1024)
Write-Host ''
Write-Host "Pronto: dados.js gravado ($kb KB)."
if ($falhas.Count) { Write-Host ('Não atualizadas (ficaram com os dados anteriores, se havia): ' + ($falhas -join ', ')) }
