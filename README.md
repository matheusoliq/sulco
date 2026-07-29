# Sulco 🎵 — player de músicas locais

Um player de música **100% local**, instalável como PWA, com visual inspirado no Spotify mas com identidade própria: um disco de vinil que gira atrás da capa do álbum na tela "Tocando agora", gradientes extraídos das cores da própria capa, e um sistema completo de temas.

Não existe backend, não existe streaming, nenhuma música sai do seu aparelho. Tudo — biblioteca, favoritos, playlists, tema — é lido e salvo localmente no navegador.

---

## Índice

1. [Como o projeto funciona](#como-o-projeto-funciona)
2. [Estrutura de pastas](#estrutura-de-pastas)
3. [Instalar e executar](#instalar-e-executar)
4. [Transformar em PWA / instalar no celular](#transformar-em-pwa--instalar-no-celular)
5. [Publicar no GitHub Pages](#publicar-no-github-pages)
6. [Como funciona a leitura de metadados (ID3)](#como-funciona-a-leitura-de-metadados-id3)
7. [Como funciona a Media Session API](#como-funciona-a-media-session-api)
8. [Como funciona o Service Worker](#como-funciona-o-service-worker)
9. [Limitações do navegador (leitura importante)](#limitações-do-navegador-leitura-importante)
10. [Personalizar o app](#personalizar-o-app)
    - [Trocar cores / temas](#trocar-cores--temas)
    - [Trocar fontes](#trocar-fontes)
    - [Editar animações](#editar-animações)
    - [Alterar o layout](#alterar-o-layout)
    - [Adicionar novos módulos](#adicionar-novos-módulos)
11. [Decisões técnicas e por quê](#decisões-técnicas-e-por-quê)
12. [Como estudar este código](#como-estudar-este-código)
13. [Dependências externas](#dependências-externas)
14. [Ideias de melhorias futuras](#ideias-de-melhorias-futuras)

---

## Como o projeto funciona

Em uma frase: você aponta o app para pastas específicas do seu armazenamento, ele lê os arquivos de áudio e as tags ID3 de cada um, monta uma biblioteca local (guardada no IndexedDB do navegador), e toca tudo através de um player com equalizador, crossfade, fila, playlists e uma tela "Tocando agora" com disco de vinil giratório.

Fluxo de dados, em alto nível:

```
Você escolhe uma pasta (Ajustes)
        │
        ▼
library.js varre a pasta, lê tags ID3 com jsmediatags
        │
        ▼
Cada faixa vira um registro { título, artista, álbum, capa, duração, ... }
        │
        ▼
storage.js salva tudo no IndexedDB (não salva o áudio em si, só metadados + capa)
        │
        ▼
script.js renderiza Início / Buscar / Biblioteca / Playlists a partir dessa lista
        │
        ▼
Ao tocar uma faixa, player.js pega o arquivo real (File) e cria um Blob URL
        │
        ▼
Web Audio API (equalizador, crossfade) + Media Session API (notificação/bloqueio)
```

Nenhum arquivo de áudio é copiado, comprimido ou enviado a lugar nenhum — o app sempre toca diretamente o arquivo original que está no seu armazenamento.

---

## Estrutura de pastas

```
sulco/
├── index.html          # Toda a estrutura HTML: telas, mini player, "Tocando agora", sheets
├── style.css            # Todo o CSS: variáveis de tema, layout, animações, responsividade
├── script.js             # Ponto de entrada: inicialização, navegação, renderização das listas
├── player.js              # Motor de áudio: fila, Web Audio, equalizador, crossfade, Media Session
├── library.js              # Pastas, varredura de arquivos, leitura de tags ID3, busca/ordenação
├── settings.js              # Lógica da tela de Ajustes (pastas, tema, aparência, reprodução)
├── theme.js                  # Aplica temas (escuro/claro/AMOLED/personalizado) via CSS variables
├── storage.js                  # Camada IndexedDB + localStorage usada por todo o resto
├── utils.js                     # Funções auxiliares (formatação de tempo, paleta de cores, busca)
├── service-worker.js             # Cache do "app shell" para funcionamento 100% offline
├── manifest.json                  # Manifesto da PWA (ícones, cores, atalhos)
├── generate_assets.py              # Script auxiliar (não faz parte do app) usado para gerar os PNGs abaixo
└── assets/
    ├── icons/     # Ícones do app em vários tamanhos + versões "maskable" para Android
    ├── vinyl/     # Textura do disco de vinil usado na tela "Tocando agora"
    ├── images/    # Capa padrão usada quando uma faixa não tem capa incorporada
    └── fonts/     # (vazio por padrão - as fontes são carregadas do Google Fonts, veja abaixo)
```

Cada arquivo `.js` é um [módulo ES nativo](https://developer.mozilla.org/pt-BR/docs/Web/JavaScript/Guide/Modules) (`import`/`export`) — não há bundler, não há build step. `index.html` carrega apenas `script.js` como `<script type="module">`, e o próprio navegador resolve os `import` dos outros arquivos.

---

## Instalar e executar

Este projeto não tem dependências para instalar e não precisa de `npm install`. Como usa ES Modules, ele **precisa ser servido por um servidor HTTP** (abrir o `index.html` direto com `file://` não funciona - é uma restrição de segurança do navegador para módulos).

Qualquer servidor estático simples resolve:

```bash
# Opção 1: Python (já vem em praticamente qualquer sistema)
cd sulco
python3 -m http.server 8080
# abra http://localhost:8080

# Opção 2: Node, sem instalar nada globalmente
cd sulco
npx serve .

# Opção 3: extensão "Live Server" do VS Code
```

Depois é só abrir o endereço no navegador, ir em **Ajustes → Adicionar pasta** e escolher onde suas músicas estão.

---

## Transformar em PWA / instalar no celular

O projeto já é uma PWA completa (`manifest.json` + `service-worker.js` + ícones prontos). Para instalar:

- **Android (Chrome):** abra o site, toque no menu (⋮) → "Adicionar à tela inicial" ou "Instalar app". O botão "Instalar aplicativo" em Ajustes → Sobre também aparece automaticamente quando o navegador permite instalar direto.
- **iOS (Safari):** toque em Compartilhar → "Adicionar à Tela de Início". O Safari não dispara o evento `beforeinstallprompt`, então nesse caso o botão em Ajustes não aparece — o caminho manual pelo menu Compartilhar é o único disponível (limitação do próprio iOS, não do app).
- **Desktop (Chrome/Edge):** ícone de instalação na barra de endereço, ou o mesmo botão em Ajustes.

Depois de instalado, o app abre em tela cheia, sem a barra de endereço do navegador, com seu próprio ícone.

---

## Publicar no GitHub Pages

1. Crie um repositório no GitHub e suba a pasta `sulco/` inteira (com todos os arquivos e subpastas de `assets/`).
2. No repositório, vá em **Settings → Pages**.
3. Em "Source", selecione a branch principal (ex: `main`) e a pasta `/ (root)` — ou `/docs` se você preferir mover o conteúdo para lá.
4. Salve. Em alguns minutos o GitHub Pages publica em `https://SEU-USUARIO.github.io/SEU-REPOSITORIO/`.
5. **Importante:** se o repositório não estiver na raiz do domínio (ou seja, a URL tem um `/nome-do-repo/` no meio), os caminhos relativos usados no projeto (`assets/...`, `./index.html` no manifest, etc.) continuam funcionando normalmente porque são todos relativos — não é necessário editar nada.

O HTTPS que o GitHub Pages fornece automaticamente é obrigatório para a Service Worker e para o File System Access API funcionarem (essas APIs exigem "contexto seguro").

---

## Como funciona a leitura de metadados (ID3)

`library.js` usa a biblioteca [`jsmediatags`](https://github.com/aadsm/jsmediatags) (carregada via CDN, veja [Dependências externas](#dependências-externas)) para ler tags ID3v1/ID3v2 (MP3), tags MP4/M4A e, com suporte parcial, FLAC.

Para cada arquivo de áudio encontrado nas pastas escolhidas, a função `readTags()` em `library.js`:

1. Chama `jsmediatags.read(file, ...)` e espera o resultado.
2. Se a leitura falhar (arquivo corrompido, formato não suportado, tag ausente), cai de volta para um "chute" baseado no nome do arquivo (formato `Artista - Título.mp3`) — muito comum em músicas baixadas por apps como Snaptube.
3. Se a tag tiver uma capa embutida (`tagResult.picture`), ela é convertida em um `Blob` e guardada junto com a faixa; senão, a capa padrão em `assets/images/default-cover.png` é usada.
4. A duração é obtida tocando o arquivo silenciosamente em um `<audio>` temporário e lendo `loadedmetadata` (mais confiável entre formatos do que confiar só na tag).

Tudo isso roda **inteiramente no navegador** - nenhum arquivo é enviado para qualquer servidor para ser analisado.

---

## Como funciona a Media Session API

`player.js` usa a [Media Session API](https://developer.mozilla.org/pt-BR/docs/Web/API/Media_Session_API) (`navigator.mediaSession`) para que a faixa atual apareça na notificação do Android, na tela de bloqueio, em controles Bluetooth/headset e no Android Auto quando suportado.

A cada troca de faixa, `updateMediaSession()`:

- Define `navigator.mediaSession.metadata` com título, artista, álbum e a capa em 3 tamanhos (96/256/512px).
- Registra os `setActionHandler` para play, pause, faixa anterior/próxima e "seek" (arrastar a barra de progresso direto na notificação, quando o sistema oferece essa opção).
- Chama `setPositionState()` periodicamente para que a barra de progresso da notificação fique sincronizada com o áudio.

Esses handlers chamam de volta os mesmos métodos públicos de `Player` (`play()`, `pause()`, `next()`, `prev()`, `seek()`) - ou seja, tocar pausar pela notificação e tocar/pausar pelo próprio app são exatamente o mesmo caminho de código.

---

## Como funciona o Service Worker

`service-worker.js` guarda em cache os arquivos do próprio app (HTML/CSS/JS/ícones) na instalação (`install`), e responde a requisições `fetch` com estratégias diferentes dependendo do tipo de recurso (veja os comentários no topo do arquivo para o detalhe de cada estratégia: cache-first para o app shell, network-first para navegação, stale-while-revalidate para fontes/CDN).

Ele **não** armazena nenhum arquivo de música - áudio nunca passa por uma requisição de rede nesta arquitetura (é lido do disco via File System Access API / `<input webkitdirectory>` e tocado via Blob URL), então não há nada de música para o Service Worker interceptar.

Ao alterar qualquer arquivo do "app shell", lembre de subir o número em `CACHE_VERSION` no topo do arquivo, senão usuários que já instalaram o app continuam vendo a versão antiga em cache.

---

## Limitações do navegador (leitura importante)

Estas são restrições impostas pelas próprias plataformas/navegadores, não decisões de design deste projeto. Elas foram documentadas e uma alternativa moderna foi implementada para cada uma:

### 1. Pastas persistentes entre sessões

A [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API) (`showDirectoryPicker()`) permite guardar um "handle" para uma pasta e reabri-la automaticamente depois, sem o usuário escolher de novo. **Só existe em navegadores baseados em Chromium no desktop** (Chrome, Edge, Opera) — não existe no Chrome para Android, nem no Firefox ou Safari em nenhuma plataforma.

- **Onde funciona (desktop Chromium):** `library.js` guarda o handle no IndexedDB e, a cada abertura do app, verifica a permissão (`queryPermission`) e re-varre a pasta automaticamente.
- **Onde não funciona (Android, Firefox, Safari):** o app usa `<input type="file" webkitdirectory multiple>` como alternativa. Essa API só devolve uma lista de arquivos daquele instante - o navegador não permite guardar isso para a próxima sessão. **O usuário precisa tocar em "Reconectar" em Ajustes ao reabrir o app antes de conseguir tocar músicas daquela pasta.** Para minimizar o impacto: todos os metadados (título, artista, capa, favoritos, playlists) continuam funcionando instantaneamente a partir do cache local - só a reprodução em si exige a reconexão.

### 2. Cor da notificação/tela de bloqueio

No Android 13+, o próprio sistema extrai uma cor de destaque da capa do álbum para colorir a notificação de mídia - isso é feito pelo Android/Chrome internamente (algo parecido com a `Palette` API nativa do Android) e **uma página web não tem nenhuma API para sobrescrever essa cor diretamente**. O que o app pode controlar - e controla - é a cor da barra de status/navegador (`<meta name="theme-color">`, atualizada pelo `theme.js`) e o gradiente de fundo dentro da própria tela "Tocando agora" (calculado em `utils.js` via `extractPalette()`, lendo os pixels da capa em um `<canvas>` local).

### 3. Reprodução em segundo plano

Um PWA instalado via navegador não tem um "serviço em primeiro plano" nativo como um app Android de verdade. Se o sistema operacional decidir encerrar a aba/processo por economia de bateria enquanto o app está em segundo plano, a reprodução para. Isso é uma limitação de qualquer PWA (não é específico deste projeto) - a única forma de contornar totalmente seria empacotar o app com algo como Capacitor/Trusted Web Activity, o que sairia do escopo "apenas HTML/CSS/JS" pedido para este projeto.

### 4. Gapless playback "perfeito"

O app tenta reprodução sem intervalo (`crossfadeSeconds = 0` nas configurações) usando dois elementos `<audio>` alternados: o próximo é pré-carregado e trocado no instante em que o atual termina. Isso funciona bem na prática, mas **não é garantidamente preciso à amostra** como seria decodificando o áudio inteiro antecipadamente com `decodeAudioData` + `AudioBufferSourceNode`. Optamos por manter o `<audio>` element (que faz streaming direto do disco) em vez de decodificar tudo antes de tocar, porque isso escalaria mal para arquivos grandes (sets longos, audiobooks) — ver [Ideias de melhorias futuras](#ideias-de-melhorias-futuras).

---

## Personalizar o app

### Trocar cores / temas

Tudo passa por variáveis CSS definidas em `theme.js` (dicionário `PRESETS`) e aplicadas em `document.documentElement`. Para mudar a paleta padrão do tema escuro, por exemplo, edite os valores em `PRESETS.dark` em `theme.js`:

```js
dark: {
  '--bg': '#0b0b0e',
  '--accent': '#e3a857',   // troque aqui para mudar a cor principal
  '--accent-2': '#7c6fcb', // e aqui para a cor secundária
  // ...
}
```

O tema "Personalizado" já expõe essas mesmas variáveis como seletores de cor dentro do próprio app (Ajustes → Aparência), sem precisar editar código.

### Trocar fontes

As fontes disponíveis são carregadas de uma vez no `<head>` de `index.html` (uma única requisição ao Google Fonts com todas as famílias). Para adicionar uma nova opção:

1. Adicione a família na URL do Google Fonts em `index.html`.
2. Adicione uma `<option>` correspondente no `<select id="select-font">` (também em `index.html`).
3. Pronto - `theme.js` já aplica qualquer valor escolhido em `--font-display` automaticamente.

### Editar animações

A maioria das transições usa a variável `--anim-speed` (controlada pelo slider "Velocidade das animações" em Ajustes), assim: `transition: transform calc(300ms / var(--anim-speed)) ease;`. Para mudar a curva de uma animação específica (por exemplo, a rotação do vinil), procure por `@keyframes spin` em `style.css`.

### Alterar o layout

O layout inteiro é feito com CSS normal (flexbox/grid), sem framework. As seções mais prováveis de mexer:

- `.bottom-nav` / `.nav-btn` — a barra de navegação inferior.
- `.now-playing-content`, `.vinyl-stage` — a tela "Tocando agora".
- `.home-row`, `.hcard` — os carrosséis horizontais da tela inicial.

### Adicionar novos módulos

Como cada arquivo é um módulo ES normal, adicionar um novo é só criar `meu-modulo.js` com `export function ...`, e importar de onde for usado: `import { minhaFuncao } from './meu-modulo.js';`. Não é preciso registrar nada em nenhum lugar central - o próprio navegador resolve a árvore de imports a partir de `script.js`.

---

## Decisões técnicas e por quê

- **Sem framework/bundler:** o pedido original era "apenas HTML, CSS e JavaScript puro". ES Modules nativos dão organização em arquivos separados sem precisar de Webpack/Vite - o único custo é precisar de um servidor HTTP mesmo em desenvolvimento (ver [Instalar e executar](#instalar-e-executar)).
- **IndexedDB em vez de localStorage para a biblioteca:** localStorage é síncrono, só guarda strings, e tem um limite baixo (~5MB) - inviável para uma biblioteca com capas de álbum embutidas. IndexedDB é assíncrono, aceita Blobs nativamente e tem uma cota de armazenamento muito maior.
- **Duplo `<audio>` element em vez de decodificar tudo em Web Audio:** garante que arquivos grandes tocam via streaming direto do disco (baixo uso de memória), ao custo de gapless não ser 100% sample-accurate - ver limitação #4 acima.
- **jsmediatags como única dependência externa:** é a única peça que exigiria reimplementar um parser binário de ID3/MP4 do zero para ganhar pouco - todo o resto do app é JavaScript sem dependências.

---

## Como estudar este código

Ordem sugerida de leitura, da peça mais isolada para a mais "conectada":

1. `utils.js` — funções puras, sem estado, mais fáceis de entender isoladas.
2. `storage.js` — como os dados são salvos (IndexedDB + localStorage).
3. `theme.js` — como uma configuração vira estilo visual.
4. `library.js` — o coração da biblioteca: pastas, arquivos, tags.
5. `player.js` — o motor de áudio e a Media Session API.
6. `settings.js` e `script.js` — como tudo isso vira interface.

Todas as funções têm comentários no formato "o que faz / como funciona / parâmetros / retorno / cuidados", então dá para entender uma função sem precisar ler o arquivo inteiro.

---

## Dependências externas

| Dependência | Por quê | Como é carregada |
|---|---|---|
| [jsmediatags](https://github.com/aadsm/jsmediatags) | Ler tags ID3/MP4 no navegador | `<script defer src="https://cdn.jsdelivr.net/...">` em `index.html`, expõe `window.jsmediatags` |
| Google Fonts (Sora, Inter, Poppins, Playfair Display, JetBrains Mono) | Opções de fonte em Ajustes | `<link>` no `<head>` de `index.html` |

Nenhuma outra biblioteca é usada - todo o resto (equalizador, crossfade, temas, playlists, busca) é JavaScript puro.

---

## Ideias de melhorias futuras

- Gapless playback sample-accurate via pré-decodificação em `AudioBuffer`, com um limite de tamanho/duração que volta ao método atual para arquivos muito longos.
- Mover a varredura de pastas + leitura de tags para um Web Worker, para não tocar a thread principal nem um pouco em bibliotecas enormes.
- Reordenar a fila por arrastar-e-soltar.
- Exportar/importar um tema personalizado como JSON.
- Suporte à (ainda experimental) FileSystemObserver API para detectar mudanças numa pasta sem precisar de um "atualizar" manual.
