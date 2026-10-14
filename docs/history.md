# v0.8.6 — início seguro e continuação de aulas (2026-10-13)

- Captura nova exige confirmar que o player regressou a `00:00` antes de criar uma aula; falha no `seek` interrompe a operação sem gerar captura parcial.
- Capturas da mesma URL solicitam decisão explícita: continuar, iniciar nova ou cancelar. A opção continuar reutiliza a captura e retrocede 8 segundos face à última legenda.
- Preserva todas as transcrições pré-existentes; escolhas e verificações são efetuadas no service worker e no popup.
- Novos testes `test-capture-start.mjs` cobrem começo, duplicações por URL, retoma e seleção inválida.

# v0.8.5 — qualidade mínima no início da reprodução (2026-10-13)

- Reage a `playing`, `canplay` e `loadeddata` para tentar qualidade mínima sem esperar alarmes periódicos.
- Uma tentativa automática por aula para evitar que menus se abram em ciclo; tentativa manual continua disponível.

# v0.8.4 — proteção contra reabertura repetida do menu (2026-10-12)

- Supervisor não repete tentativas de qualidade após uma primeira tentativa automática, mesmo quando não confirmada.

# v0.8.3 — opção HTML da Hotmart (2026-10-12)

- Identifica botões `button[role="menuitem"][aria-label="240p"]` e confirma o estado visual selecionado; validação real ainda pendente.

## v0.8.1 — Exportação simplificada e correção de clique em qualidade (iframe)

- **Qualidade mínima:** corrigida a conversão de coordenadas em players montados dentro de um iframe do mesmo separador. O cálculo agora utiliza a janela do próprio elemento `240p`, não a janela em que o script começou a correr.
- Antes de enviar o clique, confirma que a opção não está tapada por outra camada; evita cliques sobre controlos não relacionados.
- Após selecionar, reabre a lista de qualidade para verificar se o player mostra efetivamente o nível selecionado. Se o clique de rato não for aceite, tenta `Enter` apenas quando consegue focar especificamente um elemento de resolução semanticamente interativo.
- Se não houver confirmação, informa que a qualidade continua por confirmar; **não anuncia sucesso com base no simples envio de um clique.**
- Teste de integração: clique via Chrome DevTools Protocol em opção 240p dentro de iframe real simulado, com evento `isTrusted=true`. **Ainda não foi validado na Hotmart real.**


- Botão único de download: exporta apenas as aulas assinaladas; quando nenhuma está selecionada, exporta todas as aulas disponíveis.
- Checkbox «Selecionar todos» imediatamente acima da lista; seleção parcial apresentada com estado indeterminado.
- Painel «Aula atual» recolhido por defeito, com o título sempre visível.
- «Supervisor de reprodução» recolhido e colocado no final, depois da velocidade e qualidade.
- Sem alterações no motor WEBVTT, no armazenamento nem na exportação de ZIPs.

# FHAD VTT Capture v0.8.0 — clique real na qualidade mínima

**Problema corrigido:** o menu de Qualidade abria, mostrava 240p, mas a opção `Auto` continuava selecionada. O método anterior usava `element.click()` (evento não fiável) e alguns players ignoram-no.

**Alteração:** a extensão identifica o retângulo visível da resolução mais baixa listada e envia `Input.dispatchMouseEvent` (movimento, pressionar, soltar) pelo Chrome DevTools Protocol ao player correspondente. Quando o player vive num iframe do mesmo target, ajusta as coordenadas à janela principal. Depois tenta confirmar a seleção pelo texto de Qualidade ou estado explícito da opção. Não confunde Legendas e Configurações.

**Verificação no Brave (obrigatória):** atualiza a extensão na mesma pasta, faz Recarregar em `brave://extensions`, atualiza a aula, inicia captura, aguarda alguns segundos e abre **Configurações → Qualidade**. Se o item `240p` estiver com o visto, a redução funcionou. Se `Auto` continuar selecionado, clica em **Verificar qualidade agora** no popup e consulta a mensagem; o player real poderá requerer um seletor específico ou impedir eventos de automação.

A captura WEBVTT, o progresso, a divisão das aulas e os downloads manuais não são modificados. **Os testes são automatizados com o player simulado; ainda é necessária validação na Hotmart real.**

---

# FHAD VTT Capture v0.7.8 — segurança do menu de qualidade

## Corrigido

- Não confunde o botão **Legendas** com a engrenagem de **Configurações** quando classes CSS contêm `settings`.
- Só abre a lista de resoluções após verificar que o menu tem **Qualidade** e **Velocidade**.
- Se o controlo não for reconhecido com segurança, **não clica em botões ambíguos**, suspende a tentativa automática para a aula em curso e mantém a captura VTT ativa.
- Se o menu de Legendas já estiver aberto, não tenta mudar qualidade; fecha-o manualmente.
- Depois de uma falha, pode abrir manualmente **Configurações → Qualidade** e carregar em **Verificar qualidade agora**; se as resoluções forem visíveis a extensão tenta escolher a menor.
- Mantém todas as funcionalidades e o armazenamento da v0.7.7.

**Limite real:** o player da Hotmart poderá não expor nomes/seletores de configuração fiáveis. Esta versão prioriza não perturbar a aula e não garante 240p ou menor nesses casos. Os testes são simulados, não substituem validação com Hotmart real.

---

# FHAD VTT Capture v0.7.6

## Atualização — Estado correto ao reabrir o popup

- O popup volta a consultar o estado persistido **e** procura uma sessão de depuração CDP pertencente à própria extensão, antes de concluir que a captura parou. O indicador do Brave isoladamente não é prova suficiente.
- Recupera uma sessão CDP ainda ativa sem voltar a anexar o debugger e sem criar uma nova aula quando a URL e a aula guardada coincidem.
- Consulta a URL atual do Brave antes de retomar, evitando atribuir legendas a uma aula anterior se a URL mudou.
- O comando `STATE` deixou de gravar toda a base de transcrições no `chrome.storage.local` a cada atualização do popup; só grava quando é necessário recuperar uma sessão.
- O popup evita pedidos de leitura concorrentes que podiam mostrar respostas antigas depois de uma atualização.
- Se a sessão CDP pertence a outra extensão ou ao DevTools, **não a recupera**.

**Teste recomendado:** inicia a captura, espera o contador aumentar, fecha e reabre o popup, confirma «A GRAVAR» e que o número de blocos não volta a zero; repete durante a mudança de aula. Não desinstales a extensão, para manter o armazenamento local.

**Limite de validação:** testado com simulação das APIs do Brave; não existe confirmação de funcionamento no player real desta conta Hotmart.

# FHAD VTT Capture v0.7.6 — estado da captura e qualidade do vídeo

**Correções e diagnósticos**

- O número que ficou no ícone após a extensão parar é limpo quando o painel é aberto, mesmo que o separador continue a reproduzir o vídeo. O indicador de blocos VTT só significa captura ativa se o painel mostrar **A GRAVAR**.
- Em iframes, a consulta do player tenta usar o **contexto JavaScript principal** do frame, em vez de apenas um contexto isolado (que consegue ler o `<video>` mas frequentemente não vê as APIs do fornecedor). A implementação anterior podia falhar mesmo quando a página disponibilizava um controlador.
- O controlo opcional de qualidade reconhece **hls.js, video.js + qualityLevels e JW Player**, quando expõem APIs acessíveis. Não tenta contornar a proteção do fornecedor nem limita artificialmente a rede.
- Novo botão **«Verificar qualidade agora»**. Mostra se a qualidade foi *solicitada*, a altura do vídeo observada (`videoHeight`) quando disponível, e se o player não dispõe de uma API compatível. Uma solicitação à API **não é garantia de confirmação visual** da resolução durante a adaptação do stream.
- Com a captura parada, o painel informa expressamente que a extensão não está a controlar a qualidade. Para reduzir o vídeo durante a captura, clica **Iniciar captura** primeiro.
- Persistência de aulas, merge, deduplicação e downloads exclusivamente manuais continuam inalterados.

**Limitação:** se o player Hotmart utilizar uma API não disponibilizada à página, a redução automática continuará indisponível. Nesse caso, muda a qualidade manualmente no menu do player, se a opção existir. Não existe uma API universal do Brave que obrigue qualquer player a usar 144p/240p. A compatibilidade real da Hotmart ainda não foi validada.

**Atualização:** extrai o ZIP sobre a pasta original da extensão, sem a desinstalar. Abre `brave://extensions` → **Recarregar** e atualiza a aula com `Ctrl+R`. A atualização interrompe a captura anterior: **clica em Iniciar captura novamente**. As transcrições já recolhidas são preservadas.

**Validação local:** 53 testes automatizados passaram, incluindo acesso ao mundo principal de um iframe simulado, limpeza de badge antigo e redução de qualidade por controladores simulados.

---

# FHAD VTT Capture v0.7.2 — correção de associação de aulas

**Problema corrigido:** numa mudança automática de aula na Hotmart, o player já podia apresentar o vídeo seguinte enquanto os segmentos VTT continuavam a ser associados à aula anterior.

- A extensão agora observa `webNavigation.onHistoryStateUpdated` (navegação SPA) e `onCommitted` (navegação normal). **A alteração da URL do vídeo fecha de imediato o registo anterior**, mesmo que o `<h1>` ainda mostre o título antigo.
- A nova aula recebe provisoriamente o título **«Aula sem título»**, com contador próprio. Quando o `<h1>` da nova aula estabilizar, o título correto será aplicado **mesmo que já tenham chegado segmentos**. Se o título continuar idêntico ao anterior, requer confirmação manual para evitar associações incorretas.
- Antes de vincular um pedido WEBVTT, o processo de captura verifica a URL real do separador como proteção adicional quando os eventos de navegação forem perdidos.
- Pedidos VTT iniciados antes da mudança de aula são vinculados à captura original, mesmo que terminem de descarregar depois da transição. Um pedido cuja aula já não exista não é atribuído à aula atual por aproximação.
- O monitor de metadados usa *throttle* e inspeção periódica de 1,2 s, para que mudanças de aula não fiquem indefinidamente adiadas pelas atualizações constantes do DOM.
- O contador do ícone reinicia quando a nova aula é identificada. Todos os downloads continuam a ser **exclusivamente manuais** e as capturas anteriores permanecem armazenadas.

**Atenção a transcrições antigas:** se uma aula já contém legendas de outra, esta atualização **não consegue separá-las automaticamente**, porque a versão anterior não guardava uma fronteira fiável entre esses segmentos. Verifica a captura afetada e, se necessário, volta a capturar os vídeos. Não uses merge entre duas aulas diferentes para tentar corrigir a mistura.

**Instalação:** substitui os ficheiros na mesma pasta carregada como extensão no Brave, sem desinstalar. Em `brave://extensions`, clica em **Recarregar**. Atualiza também o separador da Hotmart e volta a iniciar a captura; uma atualização interrompe a sessão anterior. A chave local de dados mantém-se, sem limpeza automática.

**Testes locais:** 49 testes automatizados, incluindo mudança SPA com `<h1>` antigo, falha de evento de navegação, metadados atrasados e pedido VTT iniciado antes da transição. A execução no player real da Hotmart ainda deve ser validada com duas aulas seguidas.

---

# FHAD VTT Capture v0.7.1

## Novidade — qualidade mínima durante a captura

- Nova opção **«Tentar usar a qualidade mínima do vídeo»**, ligada por omissão na captura.
- Se o player disponibilizar uma instância compatível **hls.js** ou **video.js + qualityLevels**, a extensão tenta fixar a resolução mais baixa disponível (por exemplo 144p ou 240p).
- O painel apresenta a resolução pedida/confirmada, ou uma indicação explícita quando o player **não disponibiliza controlo compatível**. Não garante que o fornecedor aceite a definição.
- Ao parar ou desativar a opção, tenta restaurar a configuração anterior. Se o player ou o iframe já tiver sido destruído, a restauração pode não ser possível.
- **Não altera a velocidade escolhida, o conteúdo WEBVTT ou os downloads; não reduz artificialmente a largura de banda**, pois fazê-lo poderia atrasar também as legendas.
- A mudança de qualidade pode provocar uma breve interrupção no stream. Verifica os timestamps e o número de segmentos se estiveres a capturar a 4× ou 6×.
- A nova função não está validada no player real da Hotmart; a API do fornecedor pode ser incompatível. Em tal caso, seleciona manualmente 144p/240p no menu do vídeo, se disponível.

## Atualização

Descompacta o ZIP **na mesma pasta da extensão**, sem a desinstalar, para preservar o armazenamento local. Em `brave://extensions`, clica em **Recarregar** e volta a carregar a página Hotmart.

---

## Velocidade do vídeo (v0.7.1)

No painel **Velocidade do vídeo**, clica num botão **1×, 2×, 3×, 4× ou 6×** enquanto a captura estiver ativa. A extensão tenta aplicar a taxa ao elemento HTML5 `<video>` encontrado no separador Hotmart, incluindo iframes acessíveis ao depurador. O estado mostra a velocidade **realmente aceite pelo player**, não apenas a selecionada; caso o vídeo não seja acessível, mostra **pendente** e volta a tentar posteriormente. A preferência é reaplicada ao mudar de aula. **Parar captura** tenta repor 1× quando o player continuar acessível.

Este controlo não acelera nem descarrega ficheiros de legendas diretamente. Velocidades de 4× e 6× podem fazer com que o fornecedor de vídeo não carregue todos os segmentos WEBVTT: confirma o contador de blocos e revê a transcrição antes de a exportares. Alguns players limitam `playbackRate` a 2× ou repõem a velocidade automaticamente; nestes casos não é possível garantir velocidades maiores.

# FHAD VTT Capture — Hotmart (v0.6.1)

Extensão experimental para Brave (Chromium / Manifest V3). Recolhe as legendas **WEBVTT que o player fornece durante a reprodução de conteúdos autorizados**, sem descarregar os vídeos ou contornar mecanismos de proteção.

## Novidade v0.6.1 — descarregar aulas selecionadas

- Seleciona uma ou mais aulas com as **caixas de seleção**. Clica em **«↓ Descarregar aulas selecionadas (N)»** para gerar **um único ZIP** contendo apenas as aulas selecionadas, organizadas em pastas por curso e aula. **«Selecionar todas»** e **«Desmarcar seleção»** aceleram a gestão da lista. «Descarregar todas as aulas» continua disponível separadamente.
- Os mesmos checkboxes continuam a servir para **juntar capturas**: o botão de merge só fica ativo se escolheres pelo menos duas aulas terminadas. O merge mantém a validação de **mesmo título e URL** e a remoção das duplicações. A exportação de aulas selecionadas **não faz merge nem remove legendas**; as aulas ficam separadas dentro do ZIP.
- Capturas vazias e fontes já integradas num merge não podem ser selecionadas nem exportadas, para evitar entradas duplicadas. Podes incluir a aula em reprodução, mas aparece uma confirmação de que a transcrição estará possivelmente incompleta.
- O download inicia **apenas após clicar no botão**. O estado de exportação de cada aula é atualizado quando o Brave confirma que o ZIP terminou; só depois a limpeza de aulas descarregadas pode removê-las. As aulas não escolhidas não são marcadas como descarregadas.
- Mantida a mesma instalação e a chave `fhad_vtt_capture_v1`: não é necessário migrar as transcrições. Substitui os ficheiros na pasta atual e recarrega a extensão, sem desinstalá-la.

## Novidades da v0.6.0 — contador de blocos e consolidação de aulas

1. **Número no ícone da extensão:** substituímos `REC` por um contador acumulado de **blocos WEBVTT recebidos e processados da aula em captura**. Começa em `0`, sobe com cada segmento válido, reinicia quando começa uma nova aula e desaparece ao parar. `1.2k` representa cerca de 1 200 blocos; não é uma contagem de downloads simultâneos. No popup, a aula atual apresenta **blocos e falas**.
2. **Merge manual antes do download:** cada aula **não ativa** com legendas pode ser selecionada através de uma caixa junto do título. Marca duas ou mais capturas do **mesmo título e URL de aula**, clica **«Juntar capturas selecionadas»** e confirma. É produzido um novo registo consolidado, sem iniciar downloads. A URL é verificada sem query string, evitando confundir vídeos diferentes que têm o mesmo nome.
3. **Remoção de duplicações:** a consolidação ordena falas pelos tempos, elimina a mesma fala repetida no mesmo instante (incluindo pontuação final diferente e variação até 180 ms na marcação inicial/final), preserva frases iguais em momentos diferentes e mantém os timestamps VTT. O número de duplicações removidas aparece no painel, no `.md` e no `metadata.json`. Deduplicação de *cues*, não de segmentos de rede: `segmentos` contabiliza todos os blocos recebidos e pode incluir blocos repetidos.
4. **Fontes preservadas:** o merge não elimina as capturas antigas. Passam a estar identificadas como **«Fonte de merge · cópia de segurança»** e deixam de entrar em **«Descarregar todas as aulas»**, para que a mesma legenda não apareça três vezes. **«↓ ZIP»** no registo consolidado exporta um único VTT/TXT/MD/JSON. Podes clicar no botão **↶** para desfazer o merge antes de eliminar as fontes.
5. **Limpeza posterior opcional:** após o ZIP consolidado ter descarregado com sucesso, o botão **«Limpar fontes de merges descarregados»** permite apagar as cópias antigas com confirmação. Se eliminadas, deixam de poder ser recuperadas para desfazer esse merge. Os ficheiros já descarregados no computador não são tocados.
6. **Compatibilidade:** conserva a chave de armazenamento `fhad_vtt_capture_v1` e todos os dados das versões anteriores. Não há exportações nem eliminações automáticas. A atualização da extensão interrompe a captura corrente; reinicia a captura após atualizar a página Hotmart.

**Exemplo de utilização:** se começaste «Módulo 02 - Termômetro de aquecimento de público» e paraste a meio, inicia novamente a captura na mesma aula. Quando as duas capturas estiverem terminadas, seleciona ambas, faz o merge, verifica o número de falas únicas e só então clica em **↓ ZIP** do novo registo.

**Limites:** capturas com títulos/URLs diferentes não são juntadas por segurança. Títulos iguais não significam, por si só, o mesmo vídeo. A deduplicação compara texto e tempos dos segmentos disponíveis, não garante que uma transcrição incompleta passe a estar completa. É essencial rever a transcrição final. O supervisor de reprodução continua sujeito às limitações da Hotmart e dos respetivos iframes. 

**Validação:** 29 testes locais automatizados passaram, incluindo continuação de aula depois de interrupção, deduplicação temporal, contador, exportação sem duplicar as fontes, limpeza segura e desfazer merge. Ainda sem teste direto de integração numa sessão real do player Hotmart.

## Correções v0.5.2 — player em iframe e capturas vazias

1. **Supervisor do player:** antes, a leitura do relógio HTML5 ficava normalmente no documento principal do site. Agora a extensão também procura contextos dos frames do player por meio de `Page.getFrameTree` e `Page.createIsolatedWorld` do Chrome DevTools Protocol, além dos targets de iframe acompanhados pelo depurador. Quando identifica um vídeo num desses contextos, a recuperação `pause/play` usa **esse mesmo contexto**.
2. **Estado mais preciso:** se nenhuma sonda HTML5 encontrar o relógio do player, mostra **«tempo do player indisponível — captura VTT continua ativa»**, com número de contextos observados. Isso **não é um erro de captura de legendas**: a recolha dos ficheiros WEBVTT continua independente do supervisor. Se o iframe for protegido, o avanço automático baseado no tempo do vídeo pode continuar indisponível.
3. **Novo botão «♻ Limpar capturas vazias (N)»**: remove, após confirmação, os registos que têm **0 segmentos e 0 falas**, **desde que não sejam a aula ativa nem tenham um pedido WEBVTT pendente**. Não precisa de descarregar um ZIP vazio. Não afeta aulas com qualquer conteúdo ou ZIPs guardados no disco.
4. O botão **«Limpar aulas descarregadas»** mantém as proteções anteriores e é independente da limpeza das capturas vazias.
5. A alteração não modifica a chave dos dados persistentes `fhad_vtt_capture_v1`. **Ao atualizar a mesma instalação, os dados existentes são preservados**. Não há downloads automáticos.

**Verificação:** 24 testes locais automatizados passaram, incluindo limpeza seletiva e inspeção/retoma num iframe simulado. Esta versão **ainda não foi testada num player Hotmart real**. O DevTools Protocol permite inspecionar muitos iframes, mas não garante acesso a todos os fornecedores nem a players personalizados.

## Correção 0.5.1 — erros no Brave

- Corrigido `tabs.get(...): No matching signature`: o identificador do separador é verificado antes da chamada. Se o popup do Brave não o conseguir determinar, o serviço tenta identificar a aba Hotmart ativa; se não a encontrar, mostra um erro legível.
- Corrigido o tratamento de `Extension context invalidated`: os scripts antigos suspendem temporizadores e observadores quando perdem acesso ao runtime após uma atualização. **É sempre necessário atualizar a página Hotmart após recarregar a extensão**, para carregar o novo content script.
- Erros de validação comunicados pelo popup já não são registados desnecessariamente como exceções internas do background.
- Não altera o formato dos dados nem a chave de armazenamento; mantém transcrições anteriores e downloads exclusivamente manuais.

**Este patch não demonstra que o avanço automático funciona no player real da Hotmart.** É necessário testar com duas aulas, verificar o painel Supervisor e, se necessário, inspecionar os controlos específicos do player.

## Novidade: supervisor de reprodução

A v0.4.0 não observava o estado real do vídeo: detetava apenas alterações no título ou URL. Desde a v0.5.0 está incluído um **supervisor**, visível no popup da extensão.

- Consulta o estado de reprodução de vídeo HTML5 na página e, quando suportado, nos iframes associados ao player, utilizando a sessão de depuração já aberta pela extensão.
- Reavalia o progresso aproximadamente a cada **30 segundos** e apresenta o tempo atual/duração, estado e número de tentativas.
- Se um vídeo estiver a **reproduzir mas sem progresso durante mais de 60 segundos**, tenta `pause/play` até **2 vezes**. **Não interfere com vídeos pausados pelo utilizador.**
- Se o vídeo **chegar ao fim**, aguarda a transição normal da Hotmart. Se a aula continuar igual, tenta clicar em **Próxima aula** até **2 vezes**, com intervalo. Em vídeos cujo evento `ended` chega ao content script, a primeira tentativa pode acontecer após cerca de **13 segundos**; nos restantes casos depende das sondagens periódicas.
- Se o botão não tiver rótulo, tenta identificá-lo como o botão da direita num **par de controlos de navegação acima do título**. Se não houver evidência suficiente, **não clica** e apresenta um aviso.
- Novos botões: **Verificar agora**, **Próxima aula** (tentativa manual) e opção **Retomar vídeos bloqueados e tentar próxima aula no fim**.
- Numa transição SPA, a nova URL cria imediatamente uma aula provisória **«Aula sem título»**; não aceita o `<h1>` antigo como identidade. O título correto é aplicado quando identificado.

**Limitações importantes:** a Hotmart pode utilizar players cujo HTML5 não seja observável pelo depurador e interfaces de navegação diferentes. Nesses casos, a extensão não consegue garantir recuperação nem avanço; usa o controlo da Hotmart e verifica os eventos no popup. Não deve avançar uma aula a meio por simplesmente deixar de receber segmentos WEBVTT. O funcionamento de recuperação ainda **não foi confirmado numa sessão real da Hotmart**; os testes locais usam simulações do comportamento do player e da navegação.

## Atualização sem perder transcrições

1. **Não desinstales nem removas a versão instalada (0.5.1 ou anterior).** Os dados já capturados ficam no armazenamento local da identidade da extensão.
2. Guarda cópia da pasta de código atual; descompacta este ZIP e **substitui os ficheiros na mesma pasta carregada no Brave**, sem alterar o caminho da extensão.
3. Abre `brave://extensions` e clica em **Recarregar** na FHAD VTT Capture.
4. Atualiza a página da Hotmart; clica em **Iniciar captura** e mantém as legendas ativas. Confirma o estado em **Supervisor de reprodução**.
5. Testa com **duas aulas** antes de deixar uma série inteira reproduzir.

Ao recarregar a extensão, a captura ativa é interrompida. As aulas guardadas continuam disponíveis, mas deves iniciar uma nova captura. **Não elimines instalações antigas enquanto houver transcrições por exportar.**

## Captura e downloads

- Captura e separa automaticamente os segmentos WEBVTT por aula (título lido do `<h1>` da Hotmart, incluindo Shadow DOM aberto).
- Os ficheiros ficam em `chrome.storage.local` enquanto não fores descarregá-los; **a mudança de aula, a paragem e o supervisor não iniciam downloads**.
- **↓ ZIP**: exporta uma aula em VTT, TXT, MD e JSON. **Descarregar selecionadas**: um ZIP contendo apenas as aulas assinaladas, com subpastas por curso/aula. **Descarregar todas**: um ZIP com todas as aulas disponíveis. Apenas estes botões iniciam downloads e podem abrir «Guardar como».
- **Limpar aulas descarregadas (N)**: remove do armazenamento interno apenas aulas não ativas, com exportação comprovadamente concluída e sem conteúdo novo desde então. **Não apaga os ZIPs do disco.**
- **Limpar capturas vazias (N)**: remove registos de aulas não ativas com exatamente 0 segmentos e 0 falas, desde que não haja segmentos em processamento. **Não depende de download anterior.**
- Evita incluir URLs assinadas e cookies nos metadados. A URL da aula é guardada sem parâmetros de query.
- As versões antigas guardadas, incluindo duplicações de títulos, **não são eliminadas nem fundidas automaticamente** nesta atualização, para não haver perda de transcrições.

## Testes

```bash
cd fhad-vtt-capture
node --test tests/*.mjs
```

Testes de captura segmentada, metadata e Shadow DOM, persistência, exportação e limpeza manual, ausência de downloads automáticos, política de recuperação, fim de vídeo e identificação de controlos de navegação. Testar com duas aulas reais da Hotmart é indispensável antes de confiar numa recolha longa.


## v0.7.6 — Correção de arranque

- Recuperação de uma ligação de depuração órfã da própria extensão quando a interface indica **PARADO**.
- Se a ligação for de outro depurador, não a desliga: apresenta um erro claro junto ao botão Iniciar.
- Arranque com limpeza transacional: um erro após `chrome.debugger.attach` liberta a ligação e permite tentar novamente.
- Erros de arranque guardados no histórico e mostrados no topo do painel; limpar automaticamente após sucesso.
- A leitura periódica do estado deixa de percorrer todos os separadores enquanto a captura está ativa.
- A falha do alarme de supervisão não bloqueia a captura de legendas.
- As legendas anteriormente guardadas e o download exclusivamente manual são preservados.


## v0.7.6 — Seleção de qualidade pelo menu Hotmart

- Ao ativar **Tentar usar a qualidade mínima**, a extensão continua a tentar primeiro as APIs dos controladores HLS/video.js/JW Player.
- Quando essas APIs não estão acessíveis, tenta interagir com o menu de **Configurações → Qualidade** do próprio player no frame identificado.
- Escolhe a menor resolução realmente listada pelo menu, como 144p ou 240p; se o mínimo disponível for 360p ou superior, informa essa limitação.
- O painel distingue a **seleção solicitada** da **seleção confirmada**. A altura de vídeo do HTMLVideoElement pode refletir segmentos já em buffer.
- Ao desativar a preferência ou parar a captura, tenta repor a qualidade anterior (normalmente Auto).
- Se não conseguir localizar o botão de configurações, abre manualmente o menu do vídeo e usa **Verificar qualidade agora**. Não são feitos cliques aleatórios, pedidos HLS extras nem alterações de rede.
- Não é possível garantir o funcionamento com todos os players/versões da Hotmart sem testar no player real.

### Teste recomendado

1. Abre uma aula e inicia a captura.
2. Ativa **Tentar usar a qualidade mínima do vídeo** e clica em **Verificar qualidade agora**.
3. Espera alguns segundos e abre as configurações do próprio vídeo. Confirma se a seleção deixou de estar em Auto e passou para 144p ou 240p, quando essas opções existirem.
4. Se permanecer em Auto, abre manualmente **Configurações → Qualidade**, clica de novo em **Verificar qualidade agora** e comunica a mensagem apresentada.


## v0.7.7 — Preferências e fiabilidade

- Apresenta a versão da extensão no cabeçalho, diretamente de `chrome.runtime.getManifest().version`.
- Ícone **azul** quando a captura está parada, **vermelho** durante a captura (contagem de segmentos em badge separado). A aparência acompanha o estado do background, não a abertura do popup.
- Captura nova: **6×** por defeito, com tentativa de qualidade mais baixa desde o início. Ao parar, o player é reposto em 1×; ao voltar a iniciar, aplica-se novamente 6×.
- As definições de velocidade e qualidade estão em painéis `<details>` colapsados no final do popup; as secções de captura, aulas e exportação permanecem acima.
- Existe **um único botão Limpar tudo o que for seguro**, que junta capturas vazias, aulas cujo ZIP foi totalmente descarregado sem alterações e fontes de merges descarregados. Protege a aula ativa, pedidos VTT pendentes e as legendas sem backup exportado. Pede confirmação e não toca nos ZIPs locais.
- Identificação do título: leitura pelo script Hotmart, consulta direta CDP e fallback `chrome.scripting.executeScript` para procurar `h1.text-2xl` dentro de Shadow DOM aberto, com reavaliação enquanto estiver sem título.
- Fim do vídeo: observa o evento `ended` quando o player HTML5 está acessível (incluindo contextos CDP), verifica URL e título da aula e só depois tenta o botão **Concluir**. Guarda o estado de confirmação; não assinala como concluído se a Hotmart não confirmar.
- Qualidade: seleção através de controlador público de player ou menu Hotmart quando acessível. Repete a tentativa se o menu ignorar a seleção; nunca assume que 240p existe nem altera a largura de banda da rede, preservando os pedidos VTT.

### Limitações e validação real

O ícone/versão, a lógica de limpeza, os padrões e os guardas de conclusão são testáveis localmente. **Ainda não foi comprovado que o botão Concluir ou a qualidade mínima funcionem no player real desta conta Hotmart.** Se o menu não expuser controlos DOM acessíveis, a seleção automática pode continuar indisponível. A marcação como vista depende da confirmação da Hotmart: não se salta conteúdo nem se inventam estados de conclusão. É recomendável testar uma única aula terminada e confirmar o visto no painel e na lista da Hotmart antes de utilizar numa sequência.

## v0.7.9 — Recuperação do estado da captura ao reabrir o popup

- O popup identifica primeiro o separador Hotmart e envia o `tabId` ao serviço de captura com a consulta `STATE`.
- O background deixa de concluir que não há sessão ativa apenas por `chrome.debugger.getTargets()` não devolver alvos `attached`: consulta diretamente o debugger **da própria extensão**, apenas para um separador Hotmart conhecido/ativo.
- A verificação da ligação usa `Runtime.enable`, sem depender de `Runtime.evaluate` e de um contexto JavaScript que pode ser destruído durante a navegação SPA entre aulas.
- Exibe **A GRAVAR** apenas com sessão de depuração confirmada; se o estado persistido indicar captura mas o debugger não responder, apresenta **A VERIFICAR** e um aviso, sem eliminar nem fechar capturas automaticamente.
- Mostra a hora do último segmento VTT guardado, para distinguir captura ativa de um contador antigo que ficou no ícone.
- Não liga a sessão de outra extensão, não exporta automaticamente e não apaga transcrições existentes.

### Instalação correta e diagnóstico de versões

1. **Não desinstalar** a extensão com legendas armazenadas. Não apagar a pasta original.
2. Extrair o ZIP, copiar os ficheiros da subpasta `fhad-vtt-capture` para a pasta **exata** da instalação já existente e substituir os antigos.
3. Em `brave://extensions`, verificar se aparece só **uma** FHAD VTT Capture e se o campo da versão é **0.7.9**; usar `Detalhes` para identificar a pasta/ID quando necessário. Recarregar a extensão.
4. Atualizar a aba Hotmart (Ctrl+R), iniciar a captura, fechar e voltar a abrir o popup. O cabeçalho deve mostrar `v0.7.9`.
5. Verificar se o painel mostra ligação confirmada e a hora do último bloco capturado. O badge com um número não prova, por si só, que a captura ainda esteja ativa.

Nota: esta correção foi testada com a API Chrome simulada e ainda requer validação numa sessão real do Brave/Hotmart.
