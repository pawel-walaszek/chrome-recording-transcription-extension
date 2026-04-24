# Rozszerzenie Chrome do nagrywania spotkań

Zbiera napisy na żywo z Google Meet i zapisuje je jako transkrypcję `.txt` albo nagrywa bieżącą kartę Google Meet (wideo + audio) do pliku `.webm`. Opcjonalnie może domiksować mikrofon, żeby w nagraniu był też Twój głos.

Wszystko dzieje się lokalnie w przeglądarce.

Jeśli interesuje Cię proces, decyzje projektowe, demo i dodatkowe materiały, zobacz [wpis na blogu](https://www.recall.ai/blog/how-to-build-a-chrome-recording-extension).

## Hostowane API do nagrywania spotkań
Jeśli wolisz wariant z botem albo aplikacją desktopową do nagrywania, zobacz [Recall.ai](https://www.recall.ai/?utm_source=github&utm_medium=sampleapp&utm_campaign=chrome-recording-extension).

## Funkcje

**Zapisywanie transkrypcji** - parsuje napisy na żywo z Google Meet i pobiera plik `.txt` ze znacznikiem czasu.

**Nagrywanie karty** - przechwytuje wideo i audio z karty Google Meet do pliku `.webm` przez `MediaRecorder`.

**Opcjonalne domiksowanie mikrofonu** - dodaje mikrofon do nagrania po udzieleniu uprawnienia.

**Architektura MV3/Offscreen** - nagrywanie działa w ukrytym dokumencie offscreen.

## Jak to działa

1. Skrypt treści obserwuje DOM napisów Google Meet i buforuje tekst ze znacznikami czasu.

2. Popup pozwala pobrać transkrypcję albo sterować nagrywaniem.

3. Service worker w tle tworzy i koordynuje dokument offscreen oraz pobiera właściwy `streamId` przechwytywania dla aktywnej karty.

4. Strona offscreen przechwytuje kartę, opcjonalnie miksuje audio z mikrofonu, nagrywa i przekazuje blob do pobrania.

## Wymagania

**Google Chrome** albo przeglądarka oparta na Chromium z obsługą `Manifest V3` i `Offscreen API`.

**Docker** z **Docker Compose v2** oraz **make**, żeby budować rozszerzenie bez lokalnej instalacji Node.js.

Rozszerzenie używa następujących uprawnień Chrome:
`activeTab`, `downloads`, `tabCapture`, `offscreen`, `storage`, `tabs`, `desktopCapture`
i jest ograniczone do `https://meet.google.com/*`.

## Szybki start

1. Sklonuj repozytorium

```
git clone https://github.com/recallai/chrome-recording-transcription-extension.git
cd chrome-recording-transcription-extension
```

2. Zbuduj w kontenerze

```
make build
```

To polecenie używa Docker Compose i zapisuje paczkę rozszerzenia w `./dist`.

3. Załaduj do Chrome

   a) Otwórz `chrome://extensions`.
   b) Włącz `Developer mode`.
   c) Kliknij `Load unpacked`.
   d) Wybierz katalog `./dist`.

## Przepływ pracy deweloperskiej

Przed otwarciem PR albo przekazaniem zmian innemu agentowi uruchom:

```
make check
```

Przy zmianach widocznych w przeglądarce wykonaj też test dymny z [`docs/runbooks/002-smoke-test-po-zmianach.md`](docs/runbooks/002-smoke-test-po-zmianach.md): przebuduj projekt, przeładuj `dist/` w `chrome://extensions`, a następnie sprawdź pobieranie transkrypcji i nagrywanie w Google Meet, jeśli zmiana ich dotyczy.


Otwórz Google Meet i kliknij ikonę rozszerzenia:
1. **Download Transcript** - zapisuje `.txt` z napisami na żywo; włącz napisy w Google Meet.
2. **Enable Microphone** - nadaje uprawnienie mikrofonu, żeby Twój głos mógł zostać domiksowany do nagrania.
3. **Start Recording (tab) / Stop & Download** - tworzy plik `.webm` przez Downloads API.

## Instalacja i budowanie

**1. Zainstaluj Docker i make**

Docker musi udostępniać polecenie `docker compose`.

Sprawdź:

```
docker compose version
make --version
```

**2. Zbuduj jednorazowo wersję produkcyjną**

```
make build
```

To uruchamia `npm ci` i produkcyjny build webpacka w kontenerze `node:20-bookworm-slim`. Zależności są trzymane w wolumenach Dockera, a nie w lokalnym katalogu `node_modules/`. Wygenerowane rozszerzenie trafia do `dist/`.

**3. Załaduj rozszerzenie**

1. Otwórz `chrome://extensions`.
2. Włącz `Developer mode`.
3. Kliknij `Load unpacked` i wybierz katalog `dist`, który powstał w repo po uruchomieniu `make build`.

Po każdym ponownym buildzie kliknij `Reload` przy rozszerzeniu w `chrome://extensions`, żeby Chrome wczytał zmiany. Jeśli zmienił się service worker albo manifest, rozszerzenie trzeba przeładować; przy zmianach tylko w skrypcie treści może wystarczyć odświeżenie karty Google Meet.


## Używanie rozszerzenia

1. Otwórz Google Meet pod adresem `https://meet.google.com/...`.

2. Dla transkrypcji włącz napisy w Google Meet.

3. Kliknij ikonę rozszerzenia; możesz przypiąć je w menu puzzla dla szybszego dostępu.

4. W popupie:
 
   a) **Download Transcript**: włącz napisy, a po spotkaniu kliknij `Download Transcript`. Zapisze to plik **google-meet-transcript-<meeting-id>-<timestamp>.txt**.
   b) **Recording**
      - **Enable Microphone** - włącz przed kliknięciem `Start Recording`, żeby poza dźwiękiem innych uczestników nagrać też swój głos.
      - Prośba o dostęp do mikrofonu może nie pojawiać się niezawodnie w popupie. W takim przypadku przycisk otwiera dedykowaną stronę `Enable Microphone` (`micsetup.html`), gdzie można kliknąć `Enable` i udzielić dostępu do mikrofonu.
      - Po udzieleniu dostępu etykieta zmienia się na `Microphone Enabled`.
   c) **Start Recording**: rozpoczyna nagrywanie bieżącej karty (wideo + audio systemowe). Jeśli mikrofon jest włączony i miksowanie jest aktywne (domyślnie), mikrofon zostanie domiksowany.
   d) **Stop & Download**: finalizuje i pobiera `google-meet-recording-<meeting-id>-<timestamp>.webm`.

> Podczas nagrywania rozszerzenie pokazuje znacznik `REC`. Wszystkie pliki są zapisywane lokalnie przez Chrome Downloads API.

## Struktura projektu
```
.
├─ manifest.json
├─ webpack.config.js
├─ tsconfig.json
├─ package.json
├─ compose.yml
├─ Makefile
├─ popup.html
├─ offscreen.html
├─ micsetup.html
├─ .github/             # szablony GitHub, instrukcje Copilota i CI
├─ docs/                # mapa systemu, specyfikacje i runbooki
├─ scripts/             # lokalne skrypty pomocnicze
├─ src/
│  ├─ background.ts     # service worker MV3: tworzy offscreen i koordynuje strumienie
│  ├─ offscreen.ts      # uruchamia nagrywarkę, miksuje mikrofon z kartą i zapisuje blob
│  ├─ popup.ts          # obsługa popupu: transkrypcja, mikrofon, start/stop
│  ├─ scrapingScript.ts # parsuje napisy Google Meet z DOM
│  └─ micsetup.ts       # widoczna strona do nadania uprawnienia mikrofonu
└─ dist/                # wygenerowany wynik builda
```

## Konfiguracja
1. Domiksowanie mikrofonu do nagrania
  a) W `src/offscreen.ts`:
```
const WANT_MIC_MIX = true
```
  b) Ustaw `false`, żeby całkowicie wyłączyć miksowanie mikrofonu i nagrywać tylko audio z karty.

2. Nazwy plików wynikowych
  a) Nagrania: `google-meet-recording-<meet-suffix>-<timestamp>.webm`
  b) Transkrypcje: `google-meet-transcript-<meet-suffix>-<timestamp>.txt`

## Komendy builda

`make build` - domyślny build produkcyjny do `dist/` przez Docker Compose
`make check` - domyślna walidacja: typecheck i build produkcyjny w kontenerze
`make shell` - otwiera powłokę w kontenerze buildowym
`make clean` - usuwa wygenerowany `dist/`
`make deps-clean` - usuwa wolumeny zależności/cache Docker Compose

## Wewnętrzne skrypty npm

`npm run build` - pojedynczy build produkcyjny do `dist/`
`npm run typecheck` - uruchamia walidację TypeScript bez generowania plików
`npm run check` - uruchamia typecheck i build produkcyjny
`npm run smoke` - uruchamia helper testu dymnego
`npm run watch` - przebudowuje przy zmianach; pamiętaj o przeładowaniu rozszerzenia w Chrome

Skrypty npm są szczegółem implementacyjnym używanym przez kontener buildowy i CI. Wspierany lokalny przepływ pracy to opisany wyżej przepływ Make/Docker Compose.

## Zależności i łańcuch narzędziowy

1. TypeScript (`target` `es2020`)
2. webpack 5 + ts-loader
3. copy-webpack-plugin, clean-webpack-plugin
4. @types/chrome, @types/node

Są już zadeklarowane w `package.json`:
```
"devDependencies": {
  "@types/chrome": "^0.0.326",
  "@types/node": "^24.0.4",
  "clean-webpack-plugin": "^4.0.0",
  "copy-webpack-plugin": "^13.0.1",
  "ts-loader": "^9.5.0",
  "typescript": "^5.8.3",
  "webpack": "^5.99.9",
  "webpack-cli": "^6.0.1"
}
```
## Wyjaśnienie uprawnień
1. `activeTab`, `tabs` - odczyt aktywnej karty, potrzebny do wskazania i opisania nagrania.
2. `downloads` - lokalny zapis transkrypcji i nagrań.
3. `tabCapture` / `desktopCapture` - przechwytywanie wideo i audio z bieżącej karty.
4. `offscreen` - tworzenie dokumentu offscreen dla logiki nagrywania działającej w tle.
5. `storage` - zapis tymczasowych wskazówek o stanie nagrywania dla synchronizacji UI.
6. `host_permissions: ["https://meet.google.com/*"]` - ograniczenie skryptu treści do Google Meet.

## Rozwiązywanie problemów / FAQ

Pytanie: Co zrobić, jeśli nie widzę żadnego tekstu transkrypcji?
Odpowiedź:
1. Upewnij się, że w UI Google Meet włączone są `Captions`.
2. Rozszerzenie zbiera dane tylko z `https://meet.google.com/*`.
3. Odśwież stronę Google Meet po załadowaniu albo przeładowaniu rozszerzenia.

Pytanie: Co zrobić, gdy widzę `Failed to start recording: Offscreen not ready` albo podobny komunikat?
Odpowiedź:
1. Otwórz `chrome://extensions`, kliknij `Reload` przy rozszerzeniu i spróbuj ponownie.
2. Upewnij się, że Chrome jest aktualny i obsługuje Manifest V3 oraz Offscreen API.
3. Niektóre polityki firmowe mogą blokować offscreen; w razie potrzeby sprawdź polityki administratora albo urządzenia.

Pytanie: W nagraniu nie ma audio z mikrofonu.
Odpowiedź:
1. Kliknij `Enable Microphone` w popupie. Jeśli prośba inline nie zadziała, otworzy się karta konfiguracji mikrofonu; kliknij tam `Enable` i zezwól na dostęp.
2. Sprawdź też uprawnienia mikrofonu dla Chrome w systemie: `System Settings` -> `Privacy` -> `Microphone`.

Pytanie: Dlaczego nagranie jest ciche albo bez dźwięku?
Odpowiedź:
1. Upewnij się, że karta Google Meet odtwarza audio i nie jest wyciszona.
2. Jeśli wyciszysz stronę, kartę albo Google Meet, audio z karty nie zostanie przechwycone.
3. Jeśli miksowanie mikrofonu jest włączone, sprawdź urządzenie wejściowe i poziomy w systemie.

Pytanie: `Stop & Download` kończy działanie, ale plik się nie pojawia. Co zrobić?
Odpowiedź:
1. Sprawdź panel pobranych plików w przeglądarce.
2. Jeśli masz włączone pytanie o miejsce zapisu każdego pliku, powinno pojawić się okno zapisu.
3. Niektóre menedżery pobierania albo rozszerzenia mogą przeszkadzać; wyłącz je i spróbuj ponownie.

Pytanie: Dlaczego przyciski w popupie nie włączają się albo nie wyłączają poprawnie?
Odpowiedź:
1. Popup odzwierciedla stan rozgłaszany przez `background` i `offscreen`.
2. Jeśli stan się rozjedzie, zatrzymaj nagranie, jeśli trwa, a potem kliknij `Reload` przy rozszerzeniu w `chrome://extensions`.

## Wskazówki deweloperskie

1. Używaj `make build` do kontenerowego builda produkcyjnego.
2. Logi tła są w konsoli `service worker`:
   a) `chrome://extensions` -> Twoje rozszerzenie -> `service worker` -> `Inspect`
3. Logi offscreen: otwórz `chrome://extensions` -> Twoje rozszerzenie -> `service worker` i szukaj komunikatów z `[offscreen]`.
4. Logi skryptu treści są w karcie Google Meet w DevTools Console.

### Podziękowania
Zespołowi Recall.ai za możliwość budowania takich projektów, które pomagają ludziom w internecie uczyć się i tworzyć własne wersje.
