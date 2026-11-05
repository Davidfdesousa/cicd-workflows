# cicd-workflows

Workflows reutilizáveis do GitHub Actions para a **esteira de design tokens**: um repositório publica os tokens e cada plataforma (CDN/Web, Android, iOS) recebe a nova versão automaticamente por PR, valida e promove por ambiente (dev → hom → prod).

Este repositório guarda **toda a lógica**. Os projetos só têm arquivos pequenos que chamam os workflows daqui (modelos prontos em [`templates/`](templates)).

> Implementação de referência, testada de ponta a ponta com a v1.0.0:
> [cicd-create-tokens](https://github.com/Davidfdesousa/cicd-create-tokens) (tokens) ·
> [cicd-bucket-cdn](https://github.com/Davidfdesousa/cicd-bucket-cdn) ·
> [cicd-bucket-android](https://github.com/Davidfdesousa/cicd-bucket-android) ·
> [cicd-bucket-ios](https://github.com/Davidfdesousa/cicd-bucket-ios)

## Sumário

- [Como funciona](#como-funciona)
- [O que tem aqui](#o-que-tem-aqui)
- [Pré-requisitos](#pré-requisitos)
- [Passo 1 · Token de acesso (PAT)](#passo-1--token-de-acesso-pat)
- [Passo 2 · Repositório de tokens](#passo-2--repositório-de-tokens)
- [Passo 3 · Repositórios consumidores](#passo-3--repositórios-consumidores)
- [Passo 4 · Testar a esteira](#passo-4--testar-a-esteira)
- [Operação do dia a dia](#operação-do-dia-a-dia)
- [Referência dos workflows](#referência-dos-workflows)
- [Solução de problemas](#solução-de-problemas)
- [Versionamento deste repositório](#versionamento-deste-repositório)

## Como funciona

```
 Repositório de TOKENS                                     Repositórios CONSUMIDORES
 ─────────────────────                                     (cdn · android · ios)
 PR com mudança nos tokens                                 ─────────────────────────
   └─ merge na main
        └─ Release (semantic-release)
             ├─ gera os arquivos com a versão nova
             ├─ publica a GitHub Release vX.Y.Z
             │    com tokens-web.zip, tokens-android.zip, tokens-ios.zip
             └─ Distribute ── repository_dispatch ──────►  Sync design tokens
                (DISPATCH_TOKEN)   design-tokens-released     ├─ baixa o zip da sua plataforma
                                   { version, source }        ├─ substitui design-tokens/
                                                              └─ abre/atualiza PR
                                                                 feat/design-tokens → develop
                                                                 (SYNC_TOKEN, para o CI rodar)
                                                                      │
                                                                CI valida os tokens
                                                                      │ merge
                                                                Deploy develop     → dev
                                                                       release/**  → hom
                                                                       main        → prod
```

Pontos de projeto:

- **A GitHub Release é a fonte da verdade.** Os consumidores baixam o zip da release; nada é copiado à mão.
- **Uma branch por consumidor** (`feat/design-tokens`), mantida pela automação. Uma versão nova sobrescreve o PR aberto em vez de criar outro.
- **Só releases estáveis (`main`) são distribuídas.** Pré-releases (`rc`) e rollbacks são instalados sob demanda pelo workflow manual de cada consumidor.
- **O commit do PR é `feat(tokens): …`**, então, ao chegar na `main` do consumidor, o semantic-release dele gera uma versão _minor_.

## O que tem aqui

| Arquivo | Usado por | O que faz |
|---|---|---|
| [`.github/workflows/tokens-distribute.yml`](.github/workflows/tokens-distribute.yml) | repositório de tokens | Confirma que a release existe e envia `repository_dispatch` para cada consumidor |
| [`.github/workflows/tokens-sync.yml`](.github/workflows/tokens-sync.yml) | consumidores | Baixa o zip da release, atualiza `design-tokens/` e abre/atualiza o PR para `develop` |
| [`.github/workflows/tokens-validate.yml`](.github/workflows/tokens-validate.yml) | consumidores | Gate de qualidade dos tokens (`web`, `android`, `ios` ou `custom`) |
| [`.github/workflows/deploy-environments.yml`](.github/workflows/deploy-environments.yml) | consumidores | Promoção por branch para os ambientes `dev`, `hom` e `prod` |
| [`templates/tokens-repo/`](templates/tokens-repo) | copiar para o repositório de tokens | `release.yml`, `distribute.yml`, `release.config.ts` |
| [`templates/consumer/`](templates/consumer) | copiar para cada consumidor | `sync-design-tokens.yml`, `ci.yml`, `deploy.yml` |

## Pré-requisitos

- Todos os repositórios no **mesmo dono** (usuário ou organização). Funciona com donos diferentes, mas o PAT precisa alcançar todos.
- Este repositório (`cicd-workflows`) **público**, ou, se for privado, em **Settings → Actions → General → Access** marque _"Accessible from repositories owned by the user/organization"_.
- No repositório de tokens: Node + [semantic-release](https://semantic-release.gitbook.io/) e **Conventional Commits** (é o tipo do commit que decide a versão).
- Nos consumidores: branches `main` (padrão) e `develop`.

## Passo 1 · Token de acesso (PAT)

O `GITHUB_TOKEN` padrão de um workflow não consegue disparar eventos em outro repositório, e PRs abertos por ele **não disparam o CI**. Por isso a esteira usa um PAT fine-grained.

1. Acesse **GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token** ([atalho](https://github.com/settings/personal-access-tokens/new)).
2. Preencha:
   - **Token name:** `cicd-design-tokens`
   - **Expiration:** o que a sua política permitir. Anote a data: quando vencer, a esteira para (veja [Solução de problemas](#solução-de-problemas)).
   - **Repository access:** _Only select repositories_ → o repositório de tokens **e** todos os consumidores.
   - **Permissions → Repositories:**
     | Permissão | Acesso |
     |---|---|
     | Contents | Read and write |
     | Pull requests | Read and write |
     | Metadata | Read-only (obrigatória, já vem marcada) |
3. **Generate token** e copie o valor.
4. Cadastre o mesmo valor como secret (com o token na área de transferência, sem colar o valor no terminal):

   ```bash
   # Git Bash / Linux / macOS (no macOS troque o powershell por `pbpaste`)
   t=$(powershell -NoProfile -c Get-Clipboard | tr -d '\r\n')
   printf %s "$t" | gh secret set DISPATCH_TOKEN -R <dono>/<repo-tokens>
   for r in <repo-cdn> <repo-android> <repo-ios>; do
     printf %s "$t" | gh secret set SYNC_TOKEN -R "<dono>/$r"
   done
   unset t
   ```

   | Repositório | Secret | Uso |
   |---|---|---|
   | tokens | `DISPATCH_TOKEN` | enviar o `repository_dispatch` aos consumidores |
   | cada consumidor | `SYNC_TOKEN` | fazer push da branch e abrir o PR (para o CI rodar) |

> Prefere tokens separados? Funciona: o `DISPATCH_TOKEN` precisa de _Contents: read & write_ nos consumidores, e cada `SYNC_TOKEN` precisa de _Contents_ + _Pull requests: read & write_ no próprio consumidor.

## Passo 2 · Repositório de tokens

### 2.1 Contrato de saída

Cada release precisa ter **um zip por plataforma**, chamado `tokens-<plataforma>.zip`. O conteúdo do zip é copiado como está para a pasta `design-tokens/` do consumidor:

| Asset | Conteúdo esperado (validado em `tokens-validate.yml`) |
|---|---|
| `tokens-web.zip` | `tokens.json` (`{ "version", "tokens": { nome: "#RRGGBB" } }`) e `tokens.css` (`--nome: …;` para cada token) |
| `tokens-android.zip` | `values/colors.xml` (`<resources>` com `<color name="snake_case">#RRGGBB[AA]</color>`) |
| `tokens-ios.zip` | `DesignTokens.swift` com `public enum DesignTokens` |

Formato diferente? Use `platform: custom` na validação (veja o [Passo 3](#33-ci-validação-dos-tokens)).

### 2.2 Arquivos

Copie de [`templates/tokens-repo/`](templates/tokens-repo):

| Arquivo | Ajuste |
|---|---|
| `.github/workflows/release.yml` | Os comandos de verificação (`npm test`…) do seu projeto |
| `.github/workflows/distribute.yml` | Nada |
| `release.config.ts` | O `prepareCmd` que gera `dist/tokens/<plataforma>/` e os `assets` da release |

Dependências de desenvolvimento:

```bash
npm i -D semantic-release @semantic-release/changelog @semantic-release/exec @semantic-release/git conventional-changelog-conventionalcommits
```

O script que gera os arquivos (`npm run tokens:build -- --version X.Y.Z`) é do seu projeto. Ele precisa aceitar a versão que está sendo publicada, para que os arquivos já saiam com ela. Veja o [`scripts/build-tokens.ts`](https://github.com/Davidfdesousa/cicd-create-tokens/blob/main/scripts/build-tokens.ts) da referência.

### 2.3 Configurações no GitHub

| Onde | O quê |
|---|---|
| **Settings → Secrets and variables → Actions → Secrets** | `DISPATCH_TOKEN` (Passo 1) |
| **Settings → Secrets and variables → Actions → Variables** | `TOKENS_CONSUMERS` = JSON com os consumidores, ex.: `["cicd-bucket-cdn","cicd-bucket-android","cicd-bucket-ios"]`. Use `dono/repo` para outro dono. |
| **Settings → General → Pull Requests** | Ative só _Allow squash merging_ e escolha _Default to pull request title_: o título do PR vira o commit que o semantic-release lê. |
| **Rulesets / branch protection da `main`** (opcional) | Se bloquear push direto, crie o secret `RELEASE_TOKEN` (GitHub App ou PAT com bypass) para o commit `chore(release)` passar. |

```bash
gh variable set TOKENS_CONSUMERS -R <dono>/<repo-tokens> --body '["<repo-cdn>","<repo-android>","<repo-ios>"]'
```

## Passo 3 · Repositórios consumidores

Repita para cada plataforma. Copie de [`templates/consumer/`](templates/consumer) e ajuste **a plataforma** em cada arquivo:

| Plataforma | `asset` (sync) | `platform` (validate) |
|---|---|---|
| CDN / Web | `tokens-web.zip` | `web` |
| Android | `tokens-android.zip` | `android` |
| iOS | `tokens-ios.zip` | `ios` (roda em `macos-latest` para usar o `swiftc`) |

### 3.1 Branches

```bash
git switch main && git switch -c develop && git push -u origin develop
```

A `main` precisa continuar sendo a branch padrão: **o `repository_dispatch` só dispara workflows que estão na branch padrão.** Faça merge dos arquivos abaixo na `main`, não só na `develop`.

### 3.2 Sync: `.github/workflows/sync-design-tokens.yml`

Ajuste `asset:`. A origem vem no próprio evento (`client_payload.source`). Para a execução manual, cadastre a variável `TOKENS_SOURCE_REPOSITORY`:

```bash
gh variable set TOKENS_SOURCE_REPOSITORY -R <dono>/<repo-consumidor> --body '<dono>/<repo-tokens>'
```

Entradas opcionais do `tokens-sync.yml`: `target-dir` (padrão `design-tokens`), `base-branch` (`develop`), `head-branch` (`feat/design-tokens`), `commit-type` (`feat(tokens)`; use `fix(tokens)` se preferir _patch_).

### 3.3 CI: validação dos tokens

No `ci.yml` que você já tem, adicione o job:

```yaml
  design-tokens:
    uses: Davidfdesousa/cicd-workflows/.github/workflows/tokens-validate.yml@v1
    with:
      platform: android # web | android | ios | custom
```

Formato próprio:

```yaml
    with:
      platform: custom
      command: bash scripts/validate-design-tokens.sh
```

Antes do primeiro sync a pasta não existe e o job passa sem validar.

### 3.4 Deploy: `.github/workflows/deploy.yml`

| Entrada | Padrão | Para que serve |
|---|---|---|
| `verify-command` | `npm ci && npm run lint && npm run typecheck && npm test && npm run build` | Gates + build. Android, por exemplo: `./gradlew lint test assembleRelease` com `setup-node: false` |
| `package-paths` | `dist design-tokens` | O que entra no artefato `bundle-<ambiente>-<sha>` |
| `deploy-command` | vazio (deploy simulado) | O deploy real. Recebe `ENVIRONMENT`, `BUNDLE_DIR`, `DEPLOY_TARGET` e `DEPLOY_TOKEN` |
| `setup-node` / `node-version-file` | `true` / `.nvmrc` | Instala o Node antes dos comandos |
| `dev-branch` / `hom-branch-prefix` / `prod-branch` | `develop` / `release/` / `main` | Mapeamento branch → ambiente |

Passe `secrets: inherit` para o `DEPLOY_TOKEN` chegar ao job. Precisa de credenciais na nuvem via OIDC (AWS/GCP/Azure)? Copie o `deploy-environments.yml` para o projeto e acrescente o passo de login: credenciais assim não cabem num comando genérico.

### 3.5 Configurações no GitHub

| Onde | O quê |
|---|---|
| **Settings → Secrets and variables → Actions → Secrets** | `SYNC_TOKEN` (Passo 1) |
| **Settings → Secrets and variables → Actions → Variables** | `TOKENS_SOURCE_REPOSITORY` = `<dono>/<repo-tokens>` |
| **Settings → Environments** | Crie `dev`, `hom` e `prod`. Em cada um: variável `DEPLOY_TARGET` e secret `DEPLOY_TOKEN` (se o deploy real usar). Em `prod`: _Required reviewers_ e _Deployment branches_ = `main`. Em `hom`: `release/**`. |
| **Rulesets da `develop`** | Exija PR e o status check `design-tokens / Validate design tokens (<plataforma>)`. Assim nenhum token inválido chega a `dev`. |
| **Settings → General → Pull Requests** | _Squash merging_ com título do PR, como no repositório de tokens |
| **Settings → Actions → General** (só se não usar `SYNC_TOKEN`) | _Allow GitHub Actions to create and approve pull requests_ |

```bash
for env in dev hom prod; do gh api -X PUT "repos/<dono>/<repo-consumidor>/environments/$env" >/dev/null; done
```

### Checklist por consumidor

- [ ] Branch `develop` criada; `main` continua a padrão
- [ ] `sync-design-tokens.yml` na **`main`**, com o `asset` certo
- [ ] Job `design-tokens` no CI, com a `platform` certa
- [ ] `deploy.yml` com o `verify-command` do projeto
- [ ] Secret `SYNC_TOKEN` e variável `TOKENS_SOURCE_REPOSITORY`
- [ ] Environments `dev`, `hom`, `prod`
- [ ] Consumidor incluído no `TOKENS_CONSUMERS` do repositório de tokens **e** no acesso do PAT

## Passo 4 · Testar a esteira

1. **Só o consumidor (sem release nova):** _Actions → Sync design tokens → Run workflow_ com uma versão já publicada. Deve abrir o PR `feat/design-tokens → develop`, **com autor = dono do PAT** e o CI rodando. Se o autor for `github-actions` e o CI não rodar, o `SYNC_TOKEN` não está sendo usado.
2. **Só o dispatch:** no repositório de tokens, _Actions → Distribute design tokens → Run workflow_ com `target` = um consumidor.
3. **Ponta a ponta:** merge de um PR `feat:` ou `fix:` na `main` do repositório de tokens e acompanhe:
   ```bash
   gh run list -R <dono>/<repo-tokens> -L 3            # Release → Distribute
   gh run list -R <dono>/<repo-consumidor> -w "Sync design tokens" -L 1
   gh pr list  -R <dono>/<repo-consumidor> --head feat/design-tokens
   ```

## Operação do dia a dia

| Quero… | Como |
|---|---|
| Publicar tokens novos | PR no repositório de tokens com `feat:`/`fix:` → merge na `main` |
| Testar uma pré-release num consumidor | Merge na `rc` do repositório de tokens (gera `X.Y.Z-rc.N`) → no consumidor, _Sync design tokens → Run workflow_ com a versão `rc` |
| Rollback de um consumidor | _Sync design tokens → Run workflow_ com a versão antiga (ou _Distribute_ no repositório de tokens com `target`) |
| Reenviar para quem estava fora do ar | _Distribute design tokens → Run workflow_ com `target` = consumidor |
| Adicionar uma plataforma nova | Gere `tokens-<nova>.zip` na release, inclua o repositório em `TOKENS_CONSUMERS` e no acesso do PAT, e siga o Passo 3 |
| Levar para homologação | Crie `release/x.y` a partir da `develop` → deploy em `hom` |
| Levar para produção | Merge da `release/x.y` na `main` → deploy em `prod` (com aprovação, se configurada) |

## Referência dos workflows

### `tokens-distribute.yml`

| Entrada | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `version` | sim | | Versão publicada, sem `v` |
| `consumers` | sim | | JSON array de repositórios (`repo` ou `dono/repo`) |
| `target` | | `all` | `all` ou um item de `consumers` |
| `event-type` | | `design-tokens-released` | Nome do evento enviado |
| secret `DISPATCH_TOKEN` | sim | | PAT com _Contents: read & write_ nos consumidores |

Envia `client_payload: { version, source }`, em que `source` é o repositório de tokens.

### `tokens-sync.yml`

| Entrada | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `version` | sim | | Versão a instalar, sem `v` |
| `source-repository` | sim | | `dono/repo` dos tokens |
| `asset` | sim | | Ex.: `tokens-android.zip` |
| `target-dir` | | `design-tokens` | Pasta que recebe o conteúdo do zip |
| `base-branch` | | `develop` | Base do PR |
| `head-branch` | | `feat/design-tokens` | Branch da automação (recebe force-push) |
| `commit-type` | | `feat(tokens)` | Prefixo do commit e do título do PR |
| secret `SYNC_TOKEN` | | | Sem ele o PR abre, mas o CI não dispara |

O caller precisa de `permissions: contents: write, pull-requests: write`.

### `tokens-validate.yml`

| Entrada | Obrigatória | Padrão | Descrição |
|---|---|---|---|
| `platform` | sim | | `web`, `android`, `ios` ou `custom` |
| `target-dir` | | `design-tokens` | Pasta validada |
| `command` | com `custom` | | Comando de validação, rodado na raiz do repositório |

### `deploy-environments.yml`

Veja a tabela no [Passo 3.4](#34-deploy-githubworkflowsdeployyml). Branches fora do mapeamento são puladas (o job aparece como _skipped_).

## Solução de problemas

| Sintoma | Causa provável | Correção |
|---|---|---|
| Distribute: `HTTP 404` / `Resource not accessible` no dispatch | PAT sem acesso ao consumidor, sem _Contents: write_, ou vencido | Edite o PAT (_Repository access_ / _Permissions_) ou gere outro e atualize os secrets |
| Distribute: `release not found` | Versão errada ou release ainda não publicada | Confira com `gh release list -R <repo-tokens>` |
| Dispatch enviado, mas o consumidor não reage | `sync-design-tokens.yml` não está na **branch padrão**, ou `types:` diferente de `event-type` | Merge do arquivo na `main`; confira o nome do evento |
| PR aberto por `github-actions` e sem CI | `SYNC_TOKEN` ausente, vazio ou não repassado | Cadastre o secret e confira o bloco `secrets:` no caller |
| Sync: `GitHub Actions is not permitted to create or approve pull requests` | Sem `SYNC_TOKEN` e a opção do repositório está desligada | Cadastre o `SYNC_TOKEN` (recomendado) ou ative a opção em _Settings → Actions_ |
| Sync: `no assets match the file pattern` | A release não tem o zip com esse nome | Confira `asset:` e os `assets` do `release.config.ts` |
| Sync: "Nada a fazer" | A `develop` já tem essa versão | Comportamento esperado |
| `workflow was not found` / `not allowed to use reusable workflow` | `cicd-workflows` privado sem acesso liberado, ou tag `@v1` inexistente | Ver [Pré-requisitos](#pré-requisitos) e [Versionamento](#versionamento-deste-repositório) |
| Release não roda o `distribute` | Push na `rc` (só `main` distribui), ou nenhum commit `feat`/`fix` desde a última versão | Esperado; use o Distribute manual se precisar |
| Release falha ao fazer push do `chore(release)` | Ruleset bloqueia push direto na `main` | Secret `RELEASE_TOKEN` com bypass |

## Versionamento deste repositório

Os projetos referenciam os workflows por tag: `@v1`. Mudanças compatíveis atualizam a tag `v1`; mudanças que quebram os callers (entrada removida ou renomeada, comportamento padrão diferente) vão para `v2`.

```bash
git tag -a v1.0.0 -m "v1.0.0" && git push origin v1.0.0
git tag -f v1 v1.0.0 && git push -f origin v1      # move a tag maior
```

Para testar uma mudança antes de mover a tag, aponte um caller para a branch: `…/tokens-sync.yml@minha-branch`.
