# Volei VidIA

Aplicació per generar estadístiques de partits de voleibol a partir de vídeo (local o de YouTube), amb codificació compatible amb DataVolley / Click&Scout. Funcionarà al navegador, en tauletes Android i com a aplicació d'escriptori de Windows i Linux.

## Estat

**Fase 1 — Fonaments** (aquesta versió)

- Comptes d'usuari (correu i contrasenya).
- Diversos clubs amb les dades completament separades.
- Rols per club: *Administrador*, *Analista* i *Consulta*.
- Configuració del club: nom, colors (s'apliquen a tota la interfície), logotip, idioma per defecte i regles (canvis i temps morts per set; per defecte, RFEVB).
- Invitació d'usuaris per correu.
- Temporades, equips propis i rivals, jugadors i plantilles (dorsal, posició, capità, actiu).
- Interfície en català, castellà i anglès.

**Fase 2 — Motor de partit**

- Creació de partits (local, visitant, data, competició, jornada, pavelló, al millor de 3 o 5 sets).
- Convocatòria a partir de les plantilles, amb dorsals i líberos.
- Alineació inicial de cada set (posicions I–VI) i primer servei.
- Marcador automàtic: rotació en recuperar el servei, final de set (25 / 15 al set decisiu, amb 2 punts de diferència) i final de partit.
- Canvis amb les regles reglamentàries (titular ↔ suplent, límit per set configurable; RFEVB: 8).
- Líberos: entrada només per la zaga, no poden servir, sortida automàtica quan arribarien a la davantera, canvi entre líberos.
- Temps morts amb límit per set.
- Pantalla tàctil amb botons grans, i línia d'ordres per teclat amb codis DataVolley (`*p`, `ap`, `*T`, `*c3:13`…).
- Desfer (Ctrl+Z), registre d'accions i seguiment en directe des d'altres dispositius.
- Un sol codificador per partit; la resta del club el pot seguir en directe.

**Fase 2b — Millores i inici de la codificació d'accions**

- Cada jugador pertany a un sol equip; només es poden convocar i alinear jugadors de la plantilla de l'equip.
- Posició *Universal* per a jugadors que ocupen més d'una posició.
- Plantilles inventades (Nom1 Cognom1, dorsal 1…) per a rivals dels quals no es coneixen els noms.
- Importació i exportació CSV d'equips amb jugadors, i de la plantilla d'un equip (compatible amb Excel).
- Convocar o desconvocar tota la plantilla d'un cop.
- Canvi automàtic del líbero pels centrals de la zaga quan l'equip perd el servei, amb líbero per defecte.
- Codificació d'accions de joc (S, R, E, A, B, D, F) amb qualificació, tipus, zones i trajectòria, per teclat (`*12SH#16`) o tàctil, i llegenda de codis.
- Icona de l'aplicació.

**Fase 4 — Vídeo**

- Vídeo del partit des d'un enllaç de YouTube o d'un fitxer local (el fitxer no es puja; cada dispositiu el tria del seu disc).
- Cada acció codificada desa l'instant del vídeo; des del registre es pot saltar a la jugada o corregir-ne l'instant.
- Sincronització d'un partit codificat en directe sense vídeo, a partir d'una sola acció.
- Vídeos filtrats per equip, jugador, set, fonament, qualificació o accions de punt, amb marge abans i després configurable i reproducció seguida.
- Controls tàctils i dreceres de teclat (Ctrl+Espai, Ctrl+←/→).

**Fase 5 — Estadístiques**

- Pestanya d'estadístiques a cada partit, per a tot el partit o per set.
- Resum per equip: punts i el seu origen (aces, atac, bloqueig, errors del rival), side-out, break-point, eficàcia de servei, recepció positiva i atac.
- Taula per jugador: servei, recepció, atac, bloqueig, col·locació, defensa i free ball, amb punts, errors i eficàcies.
- Side-out i break-point per rotació (posició del col·locador).
- Mapa de zones d'origen i destinació per fonament i jugador.
- Des de cada número de la taula s'obren les jugades corresponents al vídeo.
- Estadístiques acumulades d'un equip per temporada i partits seleccionats.

**Fase 6 — DataVolley i Excel**

- Exportació de qualsevol partit en format DataVolley (`.dvw`, codificació Windows-1252).
- Importació de fitxers `.dvw` com a partit nou: equips (existents o nous), jugadors, alineacions, accions amb zones i instant de vídeo, canvis, temps morts i punts. Els partits importats no validen qui és al camp a cada acció, perquè DataVolley hi deixa implícits els líberos.
- Exportació a Excel de les estadístiques i totes les accions d'un partit, i de les estadístiques acumulades d'un equip.
- Importació d'equips i plantilles des d'Excel (`.xlsx`), a més de CSV.

**Fase 7 — Sense connexió**

- Codificació de partits sense connexió: cada canvi es desa primer al dispositiu (IndexedDB) i s'envia al núvol en ordre quan hi ha xarxa, automàticament.
- Còpia local del club, la llista de partits i cada partit obert, per poder-hi treballar sense connexió.
- Indicador de connexió i de canvis pendents; opció de reintentar o descartar els canvis que el servidor rebutgi.
- *Service worker*: la versió compilada de l'aplicació s'obre encara que no hi hagi connexió.

Per fer-ho servir en un pavelló sense cobertura: obre el partit abans de sortir (amb connexió) perquè quedi desat al dispositiu. Els partits nous s'han de crear amb connexió.

**Fase 8 — Aplicacions i YouTube**

- Aplicació d'escriptori per a Windows (`.msi`, `.exe`) i Linux (`.deb`, `.rpm`, `.AppImage`) amb Tauri.
- Aplicació per a tauletes Android (`.apk`) amb Capacitor.
- Les aplicacions es compilen soles a GitHub quan canvia la versió de `package.json` a la branca `main` (o amb una etiqueta `v…`) i queden a la pàgina *Releases*.
- La primera vegada, l'aplicació demana l'adreça i la clau pública del servidor Supabase (o es poden incloure a la compilació amb les variables `SUPABASE_URL` i `SUPABASE_ANON_KEY` del repositori).
- Pujada de vídeos locals al canal de YouTube del club, amb llista de reproducció i visibilitat configurables, pujada reprenible amb progrés i comprovació dels consentiments d'imatge dels menors. Es fa des de la versió web.
- Versió web publicada a GitHub Pages.

**Fase 9 — Informes en PDF**

- *Informe del partit* (semblant al *Match Report* de Click&Scout): dades del partit, durada i parcials (8, 16, 21) de cada set, participació de cada jugador a cada set (posició inicial, col·locador titular, suplents i líberos, primer servei), punts, break-points, guanyats-perduts, servei, recepció, atac i bloqueig per jugador, equip i set, i punts guanyats per servei, atac, bloqueig i errors del rival.
- *Estadístiques generals* (semblant a la *General Statistics* de Click&Scout): recompte de cada valoració de servei, recepció, atac i bloqueig, amb #% i *E% (fórmules de Click&Scout). A la pantalla i en PDF, per partit i acumulades per temporada.
- Els PDF es generen dins l'aplicació, sense connexió i sense biblioteques externes.
- Dades noves del partit (opcionals): ciutat, espectadors i àrbitres (botó *✎ Dades*). L'entrenador/a i l'ajudant surten de la fitxa de cada equip.
- A la tauleta Android, els fitxers exportats (PDF, Excel, DataVolley, CSV) s'obren amb el menú *Compartir* del sistema per desar-los o enviar-los.

**Fase 10 — Administració, registre i rendiment**

- Perfil de **superadministrador**: veu i gestiona tots els clubs i usuaris sense ser-ne membre (i pot ser, a més, membre o administrador d'un club). Només els superadministradors poden crear clubs.
- Pantalla *Administració*: clubs (crear amb administrador convidat, obrir, eliminar), usuaris (rols a cada club, afegir o treure de clubs, superadministradors) i invitacions de tots els clubs.
- **Registre d'accions** automàtic (altes, modificacions i baixes de clubs, usuaris, equips, jugadors, plantilles, partits i convocatòries; inici de cada set i desfer) i des de l'aplicació (inicis de sessió, exportacions, importacions, pujades a YouTube). Només per a superadministradors, amb filtres, detall dels canvis i exportació a Excel. Es conserva 3 mesos.
- Estadístiques del partit: selector *El nostre equip / Rival* per a totes les seccions.
- **Gràfica de teranyina** (8 eixos: servei, recepció, atac, eficàcia d'atac, bloqueig, defensa, side-out i break-point) al partit (els dos equips superposats), a les estadístiques acumulades i com a segona pàgina de l'informe del partit en PDF.
- El vídeo no es reinicia en canviar de pestanya del partit (s'atura i continua on era) i cada dispositiu recorda on s'havia quedat cada vídeo.
- Correcció de l'alineació inicial d'un set ja començat (botó *✎ Alineació del set*): es recalculen les rotacions i no es desa si alguna acció codificada deixa de ser vàlida.

## Tecnologia

- React + TypeScript + Vite (una sola base de codi per a totes les plataformes).
- Supabase (PostgreSQL, usuaris, emmagatzematge) amb seguretat a nivell de fila per aïllar cada club.
- Tauri (Windows/Linux) i Capacitor (Android) per a les aplicacions instal·lables.

## Posada en marxa

### 1. Crear el projecte Supabase

1. Crea un compte a [supabase.com](https://supabase.com) i un projecte nou. **Tria una regió de la UE** (p. ex. *Frankfurt* o *Ireland*): hi haurà dades de menors i convé que no surtin de la UE.
2. Al panell, ves a **SQL Editor** i executa, **en ordre**, cada fitxer de `supabase/migrations/` (`0001_init.sql`, `0002_matches.sql`…). Cada fitxer només s'executa una vegada.
3. A **Authentication → Sign In / Providers**, comprova que *Email* està activat.
4. A **Authentication → URL Configuration**, posa `http://localhost:5173` com a *Site URL* mentre desenvolupes.
5. Amb el botó **Connect** (a dalt del tauler) o a **Project Settings → API Keys**, copia l'URL del projecte i la clau *publishable* (`sb_publishable_…`).

### 2. Arrencar l'aplicació

Cal tenir [Node.js](https://nodejs.org) 20 o superior.

```bash
git clone https://github.com/xavigaya/volei-vidia.git
cd volei-vidia
cp .env.example .env      # a Windows (PowerShell): Copy-Item .env.example .env
                          # i omple-hi l'URL i la clau de Supabase
npm install
npm run dev
```

Obre http://localhost:5173, crea un compte, confirma el correu i crea el teu club.

### 3. Actualitzar a una versió nova

```bash
git pull
npm install
```

Si la versió nova porta un fitxer nou a `supabase/migrations/`, executa'l a l'SQL Editor de Supabase.

### 4. Versió web

La versió de navegador es publica sola a **https://xavigaya.github.io/volei-vidia/** a cada canvi a `main`.

Configuració (un sol cop):
1. GitHub → **Settings → Pages → Source: GitHub Actions**.
2. GitHub → **Settings → Secrets and variables → Actions → Variables**: crea `SUPABASE_URL` i `SUPABASE_ANON_KEY` (la clau *publishable*). Així la web i les aplicacions ja vénen connectades al servidor del club.
3. Supabase → **Authentication → URL Configuration**: *Site URL* `https://xavigaya.github.io/volei-vidia/` i, a *Redirect URLs*, afegeix `https://xavigaya.github.io/volei-vidia/**` i `http://localhost:5173/**`.
4. Per pujar vídeos a YouTube des de la web, a Google Cloud afegeix `https://xavigaya.github.io` als *Authorized JavaScript origins* del client OAuth.

### 5. Aplicacions instal·lables

Descarrega-les de la pàgina **Releases** del repositori de GitHub:

- **Windows**: executa el `.msi` o el `.exe`. Com que no està signada, Windows pot mostrar l'avís «Windows ha protegit l'ordinador»: *Més informació → Executa igualment*.
- **Linux**: `sudo apt install ./Volei.VidIA_*.deb` (Ubuntu, Debian, Linkat) o fes executable l'`.AppImage`.
- **Android**: copia l'`.apk` a la tauleta i obre'l; cal permetre instal·lar aplicacions de fonts desconegudes.

Per compilar-les tu mateix: `npm run desktop:build` (cal [Rust](https://rustup.rs) i les dependències de Tauri) o, per a Android, `npm run build && npx cap add android && npx cap open android` (cal Android Studio).

Per publicar una versió nova: canvia `"version"` a `package.json` (p. ex. `0.8.1`) i puja-ho a `main`.

### 6. YouTube

A **Configuració** del club hi ha els passos per crear l'ID de client OAuth de Google i indicar la llista de reproducció. Mentre el projecte de Google no estigui verificat, YouTube deixa els vídeos pujats en privat; la visibilitat es pot canviar després a YouTube Studio.

## Protecció de dades

Dels jugadors només es guarda el que cal per a l'estadística: nom, cognoms, àlies opcional, dorsal i posició. No es desa ni data de naixement, ni dades de contacte, ni fotos. Cada jugador té dues marques:

- **Menor d'edat**.
- **Consentiment d'imatge**: caldrà per pujar a YouTube vídeos on aparegui. En menors, l'han de donar els tutors legals.

Cada club és responsable de recollir aquests consentiments i de complir el RGPD.

## Estructura

```
supabase/migrations/   Esquema de la base de dades i polítiques de seguretat
src/auth/              Inici de sessió
src/club/              Club actual, selecció, configuració i usuaris
src/teams/             Equips i plantilles
src/players/           Jugadors
src/engine/            Motor de partit (regles, rotacions, marcador) i codis
src/matches/           Partits, convocatòria i marcador en directe
src/video/             Reproductor (YouTube i local), sincronització i vídeos filtrats
src/stats/             Càlcul i presentació d'estadístiques, exportació a Excel
src/dvw/               Lectura i escriptura de fitxers DataVolley
src/offline/           Còpia local, cua de canvis pendents i sincronització
src-tauri/             Aplicació d'escriptori (Tauri)
assets/                Icones i pantalla d'inici d'Android
src/i18n/              Traduccions (ca.json és la referència)
```
