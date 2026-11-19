# vidia-vision — eina local d'anàlisi de vídeo

Eina de **Volei VidIA** que analitza el vídeo d'un partit a l'ordinador del club (amb la GPU NVIDIA) i detecta:

- els **cops de pilota** i els **xiulets** de l'àrbitre (àudio),
- la **pilota** i la seva trajectòria (imatge),
- els **jugadors** a la pista i el seu moviment (detector de persones),
- els **contactes** (servei, recepció, col·locació, atac, bloqueig, defensa) i el jugador més proper,
- les **jugades**, amb el servidor i el guanyador de cada punt si hi ha l'acta.

És l'etapa 1.2 del reconeixement de jugades (vegeu `docs/reconeixement-jugades.md`). El vídeo **no surt mai de l'ordinador**. Tot és programari lliure i no té cap cost.

## Requisits

- Windows 11 (també funciona a Linux).
- Python 3.10, 3.11, 3.12 o 3.13 — <https://www.python.org/downloads/windows/> (marca *Add python.exe to PATH*).
- GPU NVIDIA amb el controlador actualitzat (la RTX 3070 va bé). Sense GPU també funciona, però la detecció de jugadors és molt més lenta.
- Uns 6 GB d'espai lliure (PyTorch i els models).

## Instal·lació

A PowerShell, dins la carpeta `vision` del repositori:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

L'script crea un entorn propi (`.venv`), hi instal·la PyTorch amb CUDA (prova la 12.8 i, si cal, la 12.6) i l'eina, i en acabar comprova la GPU. Es pot tornar a executar per actualitzar.

Per comprovar la instal·lació en qualsevol moment:

```powershell
.\vidia-vision.cmd check
```

La primera anàlisi amb jugadors baixa els pesos del detector (uns 170 MB).

## Ús

1. A l'app, al partit: **Anàlisi assistida → Calibració del vídeo**, calibra el vídeo i desa.
2. A **Anàlisi assistida**, prem **Exporta el paquet d'anàlisi**. El paquet porta la calibració, les formacions, la convocatòria, l'acta (amb la seqüència de punts) i les accions codificades amb el seu temps.
3. Analitza el vídeo original:

```powershell
.\vidia-vision.cmd analyze paquet.json --video "D:\Partits\balafia-farners.mp4"
```

Es desa `balafia-farners.deteccions.json` al costat del vídeo.

Perquè l'eina pugui lligar cada jugada amb l'acta (quin punt és, qui serveix i qui el guanya), ha de saber **on comença cada set al vídeo**. Indica-ho a l'app (*Calibració del vídeo → Inici al vídeo*, amb el botó ⏱ sobre el fotograma del primer servei de cada set) abans d'exportar el paquet, o amb `--set-starts`. Si el tram analitzat no inclou l'inici d'un set, les jugades d'aquell set no es lliguen amb l'acta.

Opcions útils:

| Opció | Què fa |
|---|---|
| `--start 10:00 --end 15:00` | Analitza només un tram (proves ràpides) |
| `--debug-video revisio.mp4` | Desa un vídeo amb la pista, la pilota i els jugadors dibuixats, per revisar la detecció |
| `--no-players` | Sense detecció de jugadors (no cal PyTorch; molt més ràpid) |
| `--players-fps 5` | Deteccions de jugadors per segon (més = més precís i més lent) |
| `--device cpu` | Força la CPU |
| `--set-starts 1:20,29:45,58:10` | Moment del vídeo en què comença cada set (si no s'ha indicat a l'app, a *Calibració del vídeo*). Cal per lligar les jugades amb l'acta |
| `--out fitxer.json` | Nom del fitxer de resultats |

Al final de cada anàlisi es mostra el temps de càlcul respecte a la durada del tram. Amb la GPU, el detector de jugadors treballa en mitja precisió.

Altres ordres: `.\vidia-vision.cmd info partit.mp4` (resolució, fps, durada, àudio).

> Consell per a la primera prova: un tram de 5 minuts amb `--debug-video` i comprovar que la pista verda coincideix amb la real i que la pilota (cercle groc) la segueix bé.

## Com funciona

| Part | Mètode |
|---|---|
| Àudio | Flux espectral a 0,8–6 kHz amb llindar adaptatiu (cops) i to sostingut a 2–4,5 kHz (xiulets) |
| Pilota | Diferència entre tres fotogrames consecutius, taques de la mida esperada segons la calibració, enllaçades en trajectòries. Es descarten les taques dins el cos dels jugadors (braços, cap) i es trien les trajectòries que s'assemblen a un vol lliure, sense solapar-se |
| Jugadors | Faster R-CNN (torchvision, pesos de COCO) a 5 fps; es descarten les persones fora de la pista (banquetes, àrbitres) amb la calibració; seguiment amb assignació òptima |
| Contactes | Trencament de la trajectòria (l'ajust parabòlic local falla i la direcció canvia), confirmat pel so d'un cop |
| Jugades | Contactes seguits, tallats als xiulets i als silencis; cal almenys un contacte confirmat pel so. Si hi ha acta, s'ajusten al nombre de punts de cada set i reben el servidor i el guanyador |

Limitacions d'aquesta primera versió:

- Sense entrenament propi: la pilota es troba pel moviment. Amb fons molt mogut (públic a la grada) hi pot haver falsos candidats; amb pilota molt lluny i petita, contactes febles. A la fase 2 s'hi afegirà un detector entrenat amb els partits del club.
- El jugador de cada contacte és el més proper a la pilota; l'assignació del dorsal (amb la formació i la recepció) és l'etapa 1.4.
- Les jugades es reparteixen per sets segons els temps de les accions codificades del paquet.

## Resultat (`volei-vidia/vision-detections`)

```json
{
  "format": "volei-vidia/vision-detections", "version": 1,
  "video": { "name": "partit.mp4", "width": 1920, "height": 1080, "fps": 30, "duration": 5400 },
  "audio": { "onsets": [[12.34, 0.8]], "whistles": [[10.1, 10.7]] },
  "ball": [[12.30, 960.5, 410.2, 0.83]],
  "players": [{ "id": 3, "samples": [[12.2, 4.1, 3.0, 900, 500, 960, 700, 0.97]] }],
  "contacts": [{ "t": 12.33, "x": 961, "y": 405, "score": 0.9, "audio": true, "visual": true,
                 "track": 3, "side": "H", "u": 4.1, "v": 3.0 }],
  "rallies": [{ "set": 1, "index": 0, "start": 12.3, "end": 19.8, "contacts": [0, 1, 2],
                "whistle": true, "server": "A", "serverPlayer": 13, "winner": "H", "scoreBefore": [0, 0] }],
  "acta": { "1": { "expected": 47, "found": 49, "kept": 47, "missing": 0 } }
}
```

- `players.samples`: temps, posició a terra (u, v en metres, coordenades de càmera), requadre (px) i confiança.
- Coordenades de càmera: `u` 0–9 d'esquerra a dreta vist des de la càmera, `v` 0–18 des de la línia de fons propera; la xarxa és a `v = 9`.

## Proves

```powershell
.\.venv\Scripts\python.exe -m pip install pytest
.\.venv\Scripts\python.exe -m pytest tests
```

Les proves generen un vídeo sintètic (pista, pilota, cops i xiulets) i comproven tota la cadena.
