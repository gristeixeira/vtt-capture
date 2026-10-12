# Arquitetura da FHAD VTT Capture

Versão do código-fonte: **0.8.2 (desenvolvimento)**.

## Componentes

- `manifest.json`: Manifest V3, permissões, service worker e content scripts.
- `background.js`: sessão de captura Chrome DevTools Protocol (CDP), estado da extensão, persistência local, exportação e controlo do player.
- `content.js`: observação da interface da Hotmart, incluindo navegação entre aulas e título.
- `popup.html`, `popup.css`, `popup.js`: interface de controlo da captura e exportação.
- `lib/`: parsing WEBVTT, deduplicação, merge, navegação, qualidade, velocidade, supervisão e ZIP.
- `tests/`: testes JavaScript com `node --test tests/*.mjs` e testes opcionais em Python/Chromium.

## Dados e privacidade

As transcrições ficam no armazenamento local da extensão no Brave. Não colocar URLs de sessão, tokens, HARs, legendas capturadas ou exportações de cursos sob controlo de versão. O botão de download da extensão exporta os dados apenas após pedido do utilizador.

## Decisões e limitações conhecidas

A mudança de aula deve ser associada à URL e ao título do `<h1>`, sem misturar pedidos VTT entre sessões. A qualidade de vídeo é ajustada por interação com o player quando possível; em players proprietários, o comportamento só pode ser considerado confirmado quando o próprio player indica a resolução ativa. A escolha automática de 240p ainda aguarda validação de ponta a ponta na Hotmart real.

Antes de considerar uma alteração concluída, atualizar documentação, testes e o registo de decisões relevante no mesmo commit/PR.
