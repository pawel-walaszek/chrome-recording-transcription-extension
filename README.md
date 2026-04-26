# Rozszerzenie Chrome do nagrywania spotkań

Nagrywa bieżącą kartę Google Meet (wideo + audio) do pliku `.webm`. Opcjonalnie może domiksować mikrofon, żeby w nagraniu był też Twój głos.

Wszystko dzieje się lokalnie w przeglądarce.

Jeśli interesuje Cię proces, decyzje projektowe, demo i dodatkowe materiały, zobacz [wpis na blogu](https://www.recall.ai/blog/how-to-build-a-chrome-recording-extension).

## Hostowane API do nagrywania spotkań
Jeśli wolisz wariant z botem albo aplikacją desktopową do nagrywania, zobacz [Recall.ai](https://www.recall.ai/?utm_source=github&utm_medium=sampleapp&utm_campaign=chrome-recording-extension).

## Funkcje

**Nagrywanie karty** - przechwytuje wideo i audio z karty Google Meet do pliku `.webm` przez `MediaRecorder`.

**Opcjonalne domiksowanie mikrofonu** - dodaje mikrofon do nagrania po udzieleniu uprawnienia.

**Architektura MV3/Offscreen** - nagrywanie działa w ukrytym dokumencie offscreen.

## Jak to działa

1. Popup pozwala przygotować mikrofon oraz sterować nagrywaniem.

2. Service worker w tle tworzy i koordynuje dokument offscreen oraz pobiera właściwy `streamId` przechwytywania dla aktywnej karty.

3. Strona offscreen przechwytuje kartę, opcjonalnie miksuje audio z mikrofonu, nagrywa i przekazuje blob do pobrania.

## Wymagania

**Google Chrome** albo przeglądarka oparta na Chromium z obsługą `Manifest V3` i `Offscreen API`.

**Docker** z **Docker Compose v2** oraz **make**, żeby budować rozszerzenie bez lokalnej instalacji Node.js.

Rozszerzenie używa następujących uprawnień Chrome:
`activeTab`, `downloads`, `tabCapture`, `offscreen`, `storage`, `tabs`, `desktopCapture`.

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

Przy zmianach widocznych w przeglądarce wykonaj też test dymny z [`docs/runbooks/002-smoke-test-po-zmianach.md`](docs/runbooks/002-smoke-test-po-zmianach.md): przebuduj projekt, przeładuj `dist/` w `chrome://extensions`, a następnie sprawdź nagrywanie w Google Meet, jeśli zmiana go dotyczy.


Otwórz Google Meet i kliknij ikonę rozszerzenia:
1. **Enable Microphone / Microphone Settings** - otwiera konfigurację mikrofonu i pozwala wybrać urządzenie wejściowe.
2. **Start Recording / Stop & Download** - tworzy plik `.webm` przez Downloads API.

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

Po każdym ponownym buildzie kliknij `Reload` przy rozszerzeniu w `chrome://extensions`, żeby Chrome wczytał zmiany. Jeśli zmienił się service worker albo manifest, rozszerzenie trzeba przeładować.


## Używanie rozszerzenia

1. Otwórz Google Meet pod adresem `https://meet.google.com/...`.

2. Kliknij ikonę rozszerzenia; możesz przypiąć je w menu puzzla dla szybszego dostępu.

3. W popupie:
 
   a) Jest jeden przycisk konfiguracji mikrofonu: przy pierwszym użyciu ma etykietę **Enable Microphone**, otwiera stronę konfiguracji i prosi o dostęp do mikrofonu.
   b) Po nadaniu uprawnienia ten sam przycisk zmienia etykietę na **Microphone Settings** i pozwala później zmienić mikrofon.
   c) Na stronie konfiguracji wybierz `Default microphone` albo konkretne urządzenie wejściowe i kliknij `Save Microphone`.
   d) **Start Recording** rozpoczyna nagrywanie bieżącej karty (wideo + audio systemowe). Jeśli mikrofon jest dostępny i miksowanie jest aktywne (domyślnie), mikrofon zostanie domiksowany.
   e) Podczas nagrywania ten sam przycisk zmienia się na **Stop & Download**, finalizuje i pobiera `google-meet-recording-<meeting-id>-<timestamp>.webm`.
   f) Status pod przyciskami pokazuje, czy nagrywanie trwa i ile czasu już nagrano.

> Na aktywnym spotkaniu Google Meet rozszerzenie pokazuje znacznik `RDY`, a podczas nagrywania `REC`. Jeśli nagranie zostało rozpoczęte na karcie Meet, wyjście ze spotkania automatycznie zatrzymuje nagrywanie i pobiera plik. Wszystkie pliki są zapisywane lokalnie przez Chrome Downloads API.

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
│  ├─ popup.ts          # obsługa popupu: mikrofon, start/stop
│  ├─ micPreferences.ts # wspólne helpery zapisu wyboru mikrofonu
│  └─ micsetup.ts       # widoczna strona do nadania uprawnienia i wyboru mikrofonu
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

## Komendy builda

`make build` - domyślny build produkcyjny do `dist/` przez Docker Compose
`make check` - domyślna walidacja: typecheck i build produkcyjny w kontenerze
`make shell` - otwiera powłokę w kontenerze buildowym
`make clean` - usuwa wygenerowany `dist/`
`make deps-clean` - usuwa wolumeny zależności/cache Docker Compose

### Sentry

Build przez `make` próbuje odczytać publiczny DSN Sentry z `SENTRY_DSN` albo pobrać go przez API na podstawie `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG` i `SENTRY_BASE_URL` z `~/.codex/.secrets`. Jeśli DSN nie jest dostępny, integracja Sentry pozostaje wyłączona.

Domyślne środowisko Sentry dla tej wtyczki to `chrome-extension-dev`. Można je zmienić przed buildem:

```
SENTRY_ENVIRONMENT=chrome-extension-local make build
```

Do Sentry trafiają błędy techniczne z popupu, service workera, offscreen documentu i strony ustawień mikrofonu. Nie wysyłamy nagrań, danych audio ani treści spotkań.

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
5. @sentry/browser dla opcjonalnej diagnostyki błędów

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
2. `downloads` - lokalny zapis nagrań.
3. `tabCapture` / `desktopCapture` - przechwytywanie wideo i audio z bieżącej karty.
4. `offscreen` - tworzenie dokumentu offscreen dla logiki nagrywania działającej w tle.
5. `storage` - zapis tymczasowych wskazówek o stanie nagrywania dla synchronizacji UI.
6. `host_permissions` dla `https://sentry.eengine.pl/*` - wysyłka zdarzeń diagnostycznych do Sentry, gdy build zawiera DSN.
7. `content_scripts` dla `https://meet.google.com/*` - content script wykrywa wejście i wyjście ze spotkania, żeby pokazać stan `RDY` i automatycznie zatrzymać nagrywanie po opuszczeniu spotkania.

## Rozwiązywanie problemów / FAQ

Pytanie: Co zrobić, gdy widzę `Failed to start recording: Offscreen not ready` albo podobny komunikat?
Odpowiedź:
1. Otwórz `chrome://extensions`, kliknij `Reload` przy rozszerzeniu i spróbuj ponownie.
2. Upewnij się, że Chrome jest aktualny i obsługuje Manifest V3 oraz Offscreen API.
3. Niektóre polityki firmowe mogą blokować offscreen; w razie potrzeby sprawdź polityki administratora albo urządzenia.

Pytanie: W nagraniu nie ma audio z mikrofonu.
Odpowiedź:
1. Kliknij `Enable Microphone` albo `Microphone Settings` w popupie, wybierz mikrofon i kliknij `Save Microphone`.
2. Sprawdź też uprawnienia mikrofonu dla Chrome w systemie: `System Settings` -> `Privacy` -> `Microphone`.

Pytanie: Jak zmienić mikrofon, jeśli Chrome używa złego urządzenia?
Odpowiedź:
1. Kliknij `Microphone Settings` w popupie.
2. Wybierz `Default microphone` albo konkretne urządzenie z listy.
3. Kliknij `Save Microphone`.
4. Przy następnym nagraniu rozszerzenie użyje zapisanego wyboru; jeśli urządzenie zniknie, wróci do mikrofonu domyślnego albo nagrywania bez mikrofonu.

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

### Podziękowania
Zespołowi Recall.ai za możliwość budowania takich projektów, które pomagają ludziom w internecie uczyć się i tworzyć własne wersje.
