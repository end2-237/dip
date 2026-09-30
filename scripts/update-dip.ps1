# Met DIP à jour (extension + outils) avec la dernière version publiée sur GitHub.
#   irm https://raw.githubusercontent.com/end2-237/dip/main/scripts/update-dip.ps1 | iex
# Dossier par défaut : D:\DIP  (Chrome doit charger l'extension depuis D:\DIP\extension).
# Pour un autre dossier : $env:DIP_HOME = "E:\Outils\DIP" avant la commande.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'end2-237/dip'
$dest = if ($env:DIP_HOME) { $env:DIP_HOME } else { 'D:\DIP' }

$rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'dip-updater' }
$tag = $rel.tag_name
$current = $null
$manifest = Join-Path $dest 'extension\manifest.json'
if (Test-Path $manifest) { $current = 'v' + (Get-Content $manifest -Raw | ConvertFrom-Json).version }
Write-Host "DIP installé : $(if ($current) { $current } else { 'aucun' }) · dernière version : $tag"
if ($current -eq $tag -and -not $env:DIP_FORCE) { Write-Host 'Déjà à jour.'; return }

$tmp = Join-Path $env:TEMP "dip-$tag"
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
New-Item -ItemType Directory $tmp | Out-Null
$zip = Join-Path $tmp 'dip.zip'
Write-Host "Téléchargement de $tag…"
Invoke-WebRequest "https://github.com/$repo/archive/refs/tags/$tag.zip" -OutFile $zip -UseBasicParsing
Expand-Archive $zip -DestinationPath $tmp -Force
$src = Get-ChildItem $tmp -Directory | Select-Object -First 1

New-Item -ItemType Directory $dest -Force | Out-Null
# copie en gardant node_modules, dist et les fichiers personnels
robocopy $src.FullName $dest /E /XD node_modules dist .git /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Copie impossible (robocopy $LASTEXITCODE)" }

Push-Location $dest
try {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host 'Mise à jour des outils (npm install)…'
    npm install --no-audit --no-fund --loglevel=error | Out-Null
    # navigateur des outils (dip-review, dip-focus, dip-verify) ; ne retélécharge rien s'il est déjà là
    npx --yes playwright install chromium | Out-Null
  } else { Write-Host 'npm introuvable : installe Node.js pour les outils en ligne de commande (dip-review, dip-focus…).' }
} finally { Pop-Location }
Remove-Item $tmp -Recurse -Force

# Claude Code trouve les outils grâce à DIP_HOME (les commandes /dip-* écrivent node <DIP_HOME>\cli\…)
if ([Environment]::GetEnvironmentVariable('DIP_HOME', 'User') -ne $dest) {
  [Environment]::SetEnvironmentVariable('DIP_HOME', $dest, 'User')
  Write-Host "DIP_HOME = $dest (ouvre un nouveau terminal pour Claude Code)"
}

Write-Host ''
Write-Host "✓ DIP $tag installé dans $dest"
Write-Host "  Chrome : l'extension se recharge toute seule au prochain démarrage, ou tout de suite avec le bouton"
Write-Host "  « Recharger DIP » du tableau de bord (ou ↻ dans chrome://extensions)."
Write-Host "  Ta bibliothèque (scans, effets, sites) n'est jamais touchée ; ses commandes /dip-* se mettent à jour"
Write-Host "  toutes seules à la prochaine ouverture du tableau de bord."
Write-Host "  Si c'est la première fois : chrome://extensions → Mode développeur → Charger l'extension non empaquetée → $dest\extension"
