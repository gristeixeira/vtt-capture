# FHAD VTT Capture

Extensão para Brave/Chromium (Manifest V3) destinada à captura e organização de legendas WEBVTT por aula em plataformas compatíveis, incluindo a Hotmart.

**Versão atual do código-fonte: 0.8.6.** Corresponde ao pacote de instalação FHAD-VTT-Capture-v0.8.6-install.zip. A aplicação de qualidade mínima e a navegação automática ainda exigem validação na Hotmart real.

## Instalação

1. Descarregar o código deste repositório e descompactar, mantendo a estrutura de ficheiros.
2. Abrir `brave://extensions` e ativar **Modo de programador**.
3. Selecionar **Carregar sem compactação** e escolher a pasta que contém `manifest.json`.
4. Abrir a aula na Hotmart, clicar no ícone da extensão e escolher **Iniciar captura**.
5. Para atualizar uma instalação existente, substituir os ficheiros na **mesma pasta** e clicar em **Recarregar**, sem desinstalar a extensão (para preservar o armazenamento local).

## Funcionalidades

- Captura de blocos WEBVTT e identificação da aula por URL/título.
- Retenção das transcrições no armazenamento local até exportação manual.
- Exportação VTT, TXT, Markdown e metadados JSON, por aula ou por seleção.
- Merge de capturas da mesma aula e deduplicação por tempo/texto.
- Contador de segmentos e indicador visual de captura.
- Tentativa de velocidade 6× e de redução da resolução quando o player permite.
- Supervisor de reprodução e ações manuais de recuperação.
- Início seguro com verificação do posicionamento do vídeo em `00:00`.
- Ao encontrar capturas anteriores da mesma URL: continuar (com recuo de 8 segundos), iniciar nova ou cancelar; nenhuma captura anterior é apagada.

## Testes

Requer Node.js 22+ para execução da suíte JS:

```bash
node --test tests/*.mjs
```

A suíte contém testes de compatibilidade do novo arranque, incluindo decisão sobre retoma e isolamento de URL.

Os testes em `tests/*.py` são opcionais e podem exigir Chromium/Playwright e dependências adicionais. O workflow CI executa os testes JavaScript. O sucesso de testes simulados **não** garante controlo de qualidade no player real da Hotmart.

## Documentação

- [Arquitetura e segurança](docs/architecture.md)
- [Histórico técnico detalhado](docs/history.md)

## Aviso

Utilizar apenas em conteúdos para os quais existe autorização de acesso e exportação. Este projeto não contorna DRM. Não adicionar ao repositório legendas capturadas, cookies, tokens ou URLs de sessão com credenciais.
