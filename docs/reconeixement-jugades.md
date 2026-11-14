# Reconeixement de jugades a partir del vídeo — Document de disseny

> Branca: `reconeixement-jugades` · Estat: **proposta, preguntes obertes resoltes** (encara no hi ha codi) · Data: novembre 2026

## 1. Objectiu

Ampliar Volei VidIA amb una **codificació assistida**: després del partit, el sistema analitza el vídeo i proposa les accions (equip, jugador, fonament, tipus, zones, trajectòria i, més endavant, qualificació). L'analista les confirma o les corregeix amb el teclat o la pantalla tàctil.

Principis:

- **L'analista sempre té l'última paraula.** Cap proposta entra a les estadístiques sense ser confirmada.
- **No afecta el sistema actual.** Es desenvolupa en aquesta branca. La codificació manual, les estadístiques, els informes i la importació/exportació DataVolley han de continuar funcionant igual amb el reconeixement desactivat.
- **Cost zero.** Programari lliure, entrenament i inferència a l'ordinador del club (GPU NVIDIA RTX 3070, 8 GB), sense serveis de pagament.
- **Els vídeos no surten de l'ordinador.** Només les accions codificades van al núvol, com ara.
- **Cada correcció serveix per aprendre.** Les propostes confirmades o corregides es converteixen en dades d'entrenament.

Fora d'abast (de moment): reconeixement en directe durant el partit. El disseny ho té en compte (§10), però és un projecte posterior.

## 2. Supòsits i condicions de gravació

| Condició | Valor |
|---|---|
| Càmera | Fixa, darrere d'una línia de fons, elevada, mateixa posició tot el partit. El costat de la pista (quin fons) depèn del pavelló |
| Resolució | 1080p (s'analitza reduïda segons el model) |
| Enquadrament | Pista sencera, xarxa i antenes visibles |
| Vídeo | Fitxer original en local (els de YouTube estan recomprimits i no es poden descarregar per entrenar) |
| Volum de dades | 1 partit codificat ara; 10–12 en fase de proves; màxim 25 per temporada |
| Precisió dels temps actuals | Aproximada (es reajustaran automàticament, §6.3) |
| Moment de l'anàlisi | Un cop acabat el partit |
| Ordinador d'anàlisi | Windows 11 amb NVIDIA RTX 3070 (8 GB) |

## 3. Dades prèvies del partit

Abans de començar l'anàlisi, l'analista introdueix aquestes dades **per als dos equips**.

### 3.1 Requisits

**a) Formació inicial de cada set.** Ja existeix (`lineup`, posicions I–VI, líberos, primer servei). Les substitucions i entrades del líbero es continuen registrant com ara. Amb això, el motor de partit (`src/engine/match.ts`) sap en tot moment qui és a cada posició.

**b) Sistema de joc i ordre dels jugadors**, per equip i per set (per defecte, el del set anterior):

| Sistema | Ordres habituals (posicions I→VI seguint la rotació) |
|---|---|
| 5-1 | `S-OH-MB-OPP-OH-MB` (+ L) o `S-MB-OH-OPP-MB-OH` (+ L) |
| 6-2 | `S-OH-MB-S-OH-MB` (+ L); el col·locador és el de la zaga |
| 4-2 | `S-OH-MB-S-OH-MB` (+ L); el col·locador és el de la davantera |

S'utilitzen els codis de posició que ja té l'app (`S`, `OH`, `OPP`, `MB`, `L`, `UNI`). Si l'ordre de la formació no coincideix amb el sistema declarat, l'app ho avisa però deixa continuar.

Del sistema de joc se'n dedueix, per a cada rotació:

- qui col·loca i si penetra des de la zaga,
- qui ataca per cada zona (4, 3, 2, i pipe / zona 1 des de la zaga),
- a quin central substitueix el líbero a la zaga.

**c) Calibració de la pista i la xarxa**, un cop per vídeo (o per tram, si la càmera es mou). Com que el costat des d'on es grava depèn del pavelló, la calibració és obligatòria a cada partit i no es reutilitza d'un partit a un altre:

1. Les 4 cantonades de la pista.
2. Els dos extrems de la cinta superior de la xarxa.
3. La part superior de les dues antenes.
4. Quin equip juga al costat de la càmera al primer set. Els sets següents es dedueixen (canvi de camp a cada set i, al set decisiu, a 8 punts), però es poden corregir.

Les cantonades es marquen en un ordre fix relatiu a la càmera (cantonada esquerra propera, dreta propera, dreta llunyana, esquerra llunyana), de manera que la transformació és correcta tant si es grava des d'un fons com des de l'altre.

Amb els punts 1, s'obté la transformació de la imatge a metres del camp (homografia), compatible amb el sistema de coordenades actual (`Point2`: 18 × 9 m, xarxa a x = 9). Amb els punts 2 i 3, s'obté una referència d'alçada: permet saber quan la pilota creua la xarxa, distingir atac / free ball / pilota per baix, i detectar blocs.

### 3.2 Opcional (molt recomanable)

**d) Sistema de recepció per rotació**: quins jugadors reben i on se situen en el moment del servei.

- Plantilles predefinides per a cada sistema de joc: recepció de 2, 3, 4 o 5 jugadors.
- Es poden ajustar rotació per rotació arrossegant els jugadors sobre un camp (reutilitzant `Court.tsx`).
- Es desen per equip i es poden reutilitzar en altres partits (per defecte, l'última que va fer servir aquell equip).

Si no s'introdueix, el sistema fa servir la plantilla per defecte del sistema de joc. A partir de la fase 2 podrà proposar la formació real que ha observat al vídeo (§7.3).

### 3.3 Per què són importants

Amb la càmera darrere el fons i a 1080p, llegir els dorsals no és fiable. Combinant la formació, el sistema de joc i el sistema de recepció amb la **posició detectada de cada jugador al camp**, el sistema pot saber qui és qui sense llegir dorsals (§6.4). També redueix molt les dades necessàries per entrenar.

## 4. Visió general

```
 ┌──────────────── App Volei VidIA (TypeScript) ─────────────────┐
 │                                                                │
 │  Dades prèvies (§3) ──► Fase 0: suggeriments per lògica de joc │
 │                                                                │
 │  Exporta "paquet d'anàlisi" (.json) ─────────┐                 │
 │                                              ▼                 │
 │                          ┌──── Eina local "vidia-vision" ────┐ │
 │                          │  (Python, GPU, a l'ordinador)     │ │
 │                          │  Fase 1: contactes i trajectòries │ │
 │                          │  Fase 2: classificador propi      │ │
 │                          └───────────────┬───────────────────┘ │
 │  Importa "propostes" (.json) ◄───────────┘                     │
 │        │                                                       │
 │        ▼                                                       │
 │  Cua de revisió ──► accions confirmades (match_events, núvol)  │
 │        │                                                       │
 │        └──► correccions ──► dades d'entrenament (local)        │
 └────────────────────────────────────────────────────────────────┘
```

**Per què una eina separada i no dins l'app:** l'app funciona al navegador, a Android i a l'escriptori, i cap d'aquests entorns pot fer servir la GPU per entrenar. L'eina local és un programa a part que s'executa a l'ordinador amb la RTX 3070. L'intercanvi es fa amb fitxers JSON, de manera que funciona igual amb qualsevol versió de l'app (també la web).

**Com es llança (decisió):**

- **Des de l'app d'escriptori (Windows), opció principal.** Al partit hi ha un botó *Analitzar el vídeo*. L'app genera el paquet d'anàlisi, executa `vidia-vision` en segon pla, mostra el progrés i, en acabar, importa les propostes a la cua de revisió automàticament. És l'opció més efectiva: cap fitxer a moure a mà i el vídeo local ja està seleccionat a l'app.
- **Eina instal·lada a part, un sol cop.** L'entorn amb CUDA i els models ocupa diversos GB i no es pot incloure dins l'instal·lador de l'app. Es distribueix com un instal·lador propi per a Windows 11 (entorn Python empaquetat amb PyTorch per a CUDA). L'app d'escriptori el detecta; si no hi és, mostra com instal·lar-lo.
- **Ús manual com a alternativa.** L'eina també funciona per línia d'ordres (`vidia-vision analyze paquet.json`), i la versió web i la d'Android poden exportar el paquet i importar-ne les propostes. També serveix per a l'entrenament (`vidia-vision train`), que es pot deixar fent de nit.

## 5. Fase 0 — Suggeriments per lògica de joc (sense IA entrenada)

Mòdul nou, pur i testejable: `src/recognition/suggest.ts`.

A partir de l'estat del motor de partit i les dades prèvies, proposa la **següent acció més probable**:

| Després de… | Proposa |
|---|---|
| Inici de jugada | Servei del jugador en posició I de l'equip que serveix |
| Servei | Recepció de l'altre equip; receptor segons el sistema de recepció i la zona de destinació del servei, si s'ha marcat |
| Recepció | Col·locació del col·locador de la rotació (o del líbero / un altre jugador si la recepció és `-` o `/`) |
| Col·locació | Atac; atacants possibles segons la rotació, ordenats pel tipus de col·locació |
| Atac | Bloqueig dels jugadors de davantera de l'altre equip o defensa |
| … | … |

Funcionament a la interfície:

- La línia d'ordres i el teclat tàctil es pre-omplen amb l'equip, el jugador i el fonament proposats. L'analista només afegeix la qualificació i les zones (o canvia el que calgui).
- Opció activable / desactivable a la configuració del partit. Desactivada, l'app es comporta exactament com ara.
- Funciona sense vídeo i també en directe.

Criteri d'èxit: reduir de manera apreciable el nombre de tecles per acció en un partit de prova, sense errors nous de codificació.

## 6. Fase 1 — Detecció de contactes i trajectòries (models preentrenats)

Primera versió de l'eina local `vidia-vision`. No necessita entrenament propi, però sí calibració (§3.1c).

### 6.1 Processament

1. **Lectura del vídeo** (ffmpeg / PyAV), reduït a la resolució de cada model.
2. **Detecció de jugadors**: detector de persones preentrenat + seguiment (tracking) per mantenir la identitat de cada jugador al llarg de la jugada. Les persones fora de la pista (banquetes, àrbitres, públic) es descarten amb la calibració.
3. **Detecció de la pilota**: detector especialitzat en objectes petits i ràpids, que es pot afinar amb poques imatges anotades.
4. **Àudio**: detecció dels cops de pilota i del xiulet (inici i final de jugada).
5. **Contactes**: canvis bruscos de trajectòria de la pilota, coincidents amb un cop d'àudio i amb un jugador a prop.
6. **Jugades**: segmentació en jugades (xiulet de servei → pilota a terra / xiulet).
7. **Coordenades**: cada contacte i cada punt on cau la pilota es passa a metres del camp amb l'homografia → zones 1–9 i `start` / `end` com fa l'app ara.

### 6.2 Llicències

Només models i biblioteques amb llicència permissiva (Apache-2.0, MIT, BSD), per si en el futur l'app es distribueix a altres clubs. S'eviten els models AGPL (per exemple, YOLO d'Ultralytics). Candidats: RT-DETR o YOLOX (Apache-2.0) per a persones i pilota, i un model tipus TrackNet amb llicència MIT per a la pilota. La tria definitiva es farà provant-los amb vídeos reals del club.

### 6.3 Reajust automàtic dels temps

Els temps de vídeo de les accions ja codificades són aproximats. L'eina alinea la seqüència d'accions codificades amb la seqüència de contactes detectats (alineació de seqüències, amb una finestra de ±2 s). Cada acció es mou al contacte real més proper i l'analista revisa les que no s'han pogut alinear.

Això converteix els partits ja codificats en dades d'entrenament precises sense recodificar-los.

### 6.4 Assignació del jugador sense llegir el dorsal

1. **En el moment del servei**: les posicions detectades dels 6 jugadors de cada equip s'assignen a la formació esperada (rotació actual + sistema de recepció) amb un problema d'assignació (algorisme hongarès), respectant les regles de posició (davant / darrere, esquerra / dreta).
2. **Durant la jugada**: el seguiment manté la identitat de cada jugador.
3. **A cada contacte**: es proposa el jugador més proper a la pilota, ponderat per la lògica de joc (el segon toc normalment el fa el col·locador, etc.).
4. Si hi ha dubte (dos jugadors a prop, seguiment perdut), la proposta es marca amb confiança baixa.

### 6.5 Sortida de la fase 1

Per a cada jugada: llista de contactes amb temps, equip probable, jugador probable, punt d'origen i destinació en metres, i confiança. El fonament es proposa per regles (1r contacte = servei, 2n contacte d'equip receptor = recepció…). La qualificació encara no es proposa.

Criteris d'èxit (a mesurar amb el partit codificat i els de proves):

- ≥ 90 % dels contactes reals detectats a menys de 0,3 s.
- ≥ 80 % de jugadors ben assignats en recepció i atac.
- Temps d'anàlisi d'un partit ≤ 1 hora a la RTX 3070.

## 7. Fase 2 — Classificador propi entrenat amb les correccions

### 7.1 Dades d'entrenament

Per a cada acció confirmada a la cua de revisió es desa, **només a l'ordinador**:

- un retall curt de característiques (trajectòria de la pilota, posicions dels jugadors, alçada respecte la xarxa, durant ±1 s del contacte), no el vídeo,
- l'etiqueta final (fonament, tipus, zones, jugador, qualificació),
- la proposta original, per mesurar l'error.

### 7.2 Models

Models petits que caben a 8 GB de VRAM i s'entrenen en poques hores:

- **Fonament i tipus** (S/R/E/A/B/D/F; H/M/Q/T…): model temporal lleuger sobre la seqüència de característiques.
- **Zones i punt de destinació**: a partir de la trajectòria i la calibració.
- **Qualificació** (# + ! - / =): en part es pot deduir per regles de l'acció següent (p. ex., la qualitat d'una recepció segons on col·loca el col·locador i quines opcions d'atac té; un atac seguit de punt és `#`). La resta, per model, sempre amb confiança explícita.

Entrenament: script `vidia-vision train`, pensat per deixar-lo fent de nit. Es guarden les versions dels models per poder tornar enrere si un model nou funciona pitjor.

### 7.3 Funcions addicionals

- Proposar el sistema de recepció real de cada rotació a partir de les posicions observades, perquè l'analista el confirmi.
- Detectar incoherències entre la formació declarada i el que es veu al vídeo (p. ex., un canvi no registrat).

### 7.4 Expectatives realistes

| Funció | Quan serà útil (estimació) |
|---|---|
| Fonament i zones | Amb uns 20–25 partits revisats |
| Tipus d'acció | Amb uns 20–25 partits, segons el fonament |
| Qualificació | Parcial per regles des del principi; per model, probablement la segona temporada |
| Jugador | Des de la fase 1 gràcies a §6.4; millora amb les dades |

## 8. Integració amb l'app

### 8.1 Codi nou (tot aïllat)

```
src/recognition/          Lògica de suggeriments i revisió (TypeScript)
  gameSystems.ts          Sistemes de joc, ordres i rols per rotació
  receptionTemplates.ts   Plantilles de recepció per sistema i rotació
  suggest.ts              Fase 0
  proposals.ts            Lectura de propostes i conversió a accions
  ReviewQueue.tsx         Cua de revisió
  SetupForm.tsx           Dades prèvies (§3)
  CalibrationTool.tsx     Calibració de pista i xarxa sobre un fotograma
src-tauri/                Ordre nova per llançar vidia-vision i seguir-ne el progrés
vision/                   Eina local "vidia-vision" (Python)
  README.md               Instal·lació a Windows 11 i ús
  vidia_vision/           Detecció, seguiment, contactes, entrenament
```

Canvis mínims al codi existent: un punt d'entrada a la pàgina del partit (`MatchPage.tsx`) i el pre-omplert opcional a `ActionPad.tsx` / `LiveScoring.tsx`. Amb el reconeixement desactivat, aquests canvis no s'activen.

### 8.2 Base de dades (migració nova `0014_recognition.sql`)

- `match_team_setup`: sistema de joc, ordre i sistema de recepció per partit, equip i set.
- `team_reception_systems`: sistemes de recepció guardats per equip, per reutilitzar.
- `video_calibrations`: punts de calibració per partit / tram de vídeo i costat de cada equip per set.
- `action_proposals`: propostes pendents de revisar (partit, jugada, temps, acció proposada, confiança, estat: pendent / acceptada / corregida / rebutjada, versió del model).

Les accions confirmades es desen a `match_events` exactament com les manuals, de manera que estadístiques, informes, vídeos filtrats i exportació DataVolley no canvien. Totes les taules noves tenen la mateixa seguretat a nivell de fila per club que la resta.

Les propostes es desen al núvol perquè es puguin revisar des de la tauleta. Les característiques d'entrenament i els vídeos es queden a l'ordinador.

### 8.3 Formats d'intercanvi

- **Paquet d'anàlisi** (app → eina): partit, convocatòries, formacions, sistemes de joc i recepció, calibració, accions ja codificades amb temps, nom del fitxer de vídeo.
- **Propostes** (eina → app): llista d'accions proposades amb temps, confiança per camp i, opcionalment, temps reajustats d'accions existents.

Tots dos en JSON amb número de versió del format.

### 8.4 Cua de revisió

- Llista de jugades amb les propostes de cada una; el vídeo salta a cada contacte.
- Colors segons la confiança (verd / groc / vermell) i filtre "només les de confiança baixa".
- Teclat: `Retorn` acceptar · editar amb la línia d'ordres actual · `Supr` rebutjar · `Tab` següent · afegir acció no detectada.
- Tàctil: botons grans equivalents.
- Barra de progrés i estadística de quantes propostes s'han corregit (per veure si el model millora).

## 9. Protecció de dades

- Els vídeos, els fotogrames i les característiques d'entrenament **no surten de l'ordinador**. Al núvol només hi van accions i propostes (com ara).
- L'eina comprova que el partit té el consentiment d'imatge dels jugadors propis (marca que ja existeix a l'app) abans d'utilitzar-lo per entrenar.
- Als vídeos també hi surten jugadors rivals, àrbitres i públic. El club ha confirmat que el consentiment cobreix aquest ús intern per entrenar (sense publicació).
- Els models entrenats no contenen imatges, però s'han de tractar com a dades internes del club.

## 10. Directe en el futur

- La fase 0 ja funciona en directe.
- Per a les fases 1 i 2 en directe caldria: càmera connectada a l'ordinador, models més lleugers (optimitzats amb TensorRT o ONNX), i processar jugada a jugada amb uns segons de retard.
- El disseny ho permet perquè l'eina treballa per jugades i l'app ja rep accions en temps real d'altres dispositius.

## 11. Pla per etapes

| Etapa | Contingut | Resultat |
|---|---|---|
| 0.1 | Sistemes de joc, plantilles de recepció i formulari de dades prèvies | Dades del §3 introduïbles i desades |
| 0.2 | Suggeriments per lògica de joc | Codificació manual més ràpida |
| 1.1 | Eina de calibració de pista i xarxa | Homografia i alçada de xarxa per vídeo |
| 1.2 | `vidia-vision`: detecció de jugadors, pilota i àudio | Contactes i jugades detectats |
| 1.3 | Reajust automàtic dels temps del partit ja codificat | Primeres dades d'entrenament precises |
| 1.4 | Assignació de jugadors i cua de revisió | Primer partit analitzat de punta a punta |
| 2.1 | Recollida de dades i primer entrenament (≈ 10 partits) | Primeres propostes de fonament i zones |
| 2.2 | Reentrenament periòdic (≈ 20–25 partits) | Propostes útils de fonament, tipus i zones |
| 2.3 | Qualificació per regles i per model | Proposta de qualificació amb confiança |

Cada etapa es fusiona a `main` només quan està provada i no afecta el funcionament actual.

## 12. Riscos i limitacions

- **Poques dades**: amb 10–25 partits per temporada, el classificador propi tardarà a ser fiable. Per això les fases 0 i 1 han d'aportar valor per elles mateixes.
- **Il·luminació i pavellons diferents**: els partits a fora poden tenir pitjor detecció; cal provar-ho aviat.
- **Oclusions**: jugadors que se superposen des de la càmera de fons (sobretot a la xarxa) poden confondre el seguiment.
- **Pilota en camp llunyà**: a 1080p, la pilota al camp contrari és petita; pot caldre analitzar a resolució completa aquella zona.
- **Moviments de càmera**: si la càmera es mou, cal recalibrar aquell tram.
- **Instal·lació de l'eina local**: requereix controladors NVIDIA actualitzats. L'instal·lador de Windows 11 inclou l'entorn Python i les biblioteques de CUDA necessàries, perquè no calgui instal·lar-les a mà.
- **Costat de gravació variable**: cada pavelló canvia la perspectiva; els models s'han d'entrenar amb partits gravats des de tots dos fons (s'aplica també una inversió horitzontal de les dades per duplicar exemples).

## 13. Decisions preses

| Pregunta | Resposta | Conseqüència al disseny |
|---|---|---|
| El consentiment cobreix també els rivals? | Sí | Es poden fer servir tots els partits gravats per entrenar (§9) |
| Sistema operatiu de l'ordinador amb la GPU | Windows 11 | L'eina local i el seu instal·lador s'orienten a Windows 11 (§4, §12) |
| Es grava sempre des del mateix costat? | Depèn del pavelló | Calibració obligatòria a cada partit i dades d'entrenament dels dos costats (§3.1c, §12) |
| Llançar l'eina des de l'app d'escriptori o a part? | El que sigui més efectiu | Botó a l'app d'escriptori que la llança i importa les propostes; ús manual com a alternativa (§4) |
