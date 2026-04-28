# Rozszerzenie Chrome do nagrywania spotkań

Nagrywa bieżącą kartę Google Meet i wysyła nagranie bezpośrednio do backendu `https://meet2note.com`.

Audio karty i mikrofon są wysyłane jako osobne assety, żeby backend mógł później normalizować poziomy, połączyć ścieżki i udostępnić gotowe nagranie. Rozszerzenie nie pobiera lokalnego pliku `.webm`.

Jeśli interesuje Cię proces, decyzje projektowe, demo i dodatkowe materiały, zobacz [wpis na blogu](https://www.recall.ai/blog/how-to-build-a-chrome-recording-extension).

## Hostowane API do nagrywania spotkań
Jeśli wolisz wariant z botem albo aplikacją desktopową do nagrywania, zobacz [Recall.ai](https://www.recall.ai/?utm_source=github&utm_medium=sampleapp&utm_campaign=chrome-recording-extension).

## Funkcje

**Nagrywanie karty** - przechwytuje wideo i audio z karty Google Meet przez `MediaRecorder`.

**Osobny asset mikrofonu** - nagrywa mikrofon jako oddzielny asset, jeśli użytkownik udzielił uprawnienia.

**Upload do backendu** - wysyła `video_audio` i opcjonalny `microphone` do `https://meet2note.com`.

**Połączenie z kontem Meet2Note** - popup otwiera flow `Connect to Meet2Note`, zapisuje długotrwały token w `chrome.storage.local` i używa go przy uploadzie.

**Kolejka i retry uploadu** - zakończone nagrania trafiają do lokalnej kolejki, a pojedynczy upload w retry nie blokuje kolejnego nagrania.

**Architektura MV3/Offscreen** - nagrywanie działa w ukrytym dokumencie offscreen.

## Jak to działa

1. Popup pozwala przygotować mikrofon oraz sterować nagrywaniem.

2. Popup pozwala połączyć rozszerzenie z kontem Meet2Note przez backendowy flow i stronę callbacku `connect-callback.html`.

3. Service worker w tle tworzy i koordynuje dokument offscreen oraz pobiera właściwy `streamId` przechwytywania dla aktywnej karty.

4. Strona offscreen przechwytuje kartę, nagrywa osobny asset mikrofonu, finalizuje bloby i dodaje nagranie do sekwencyjnej kolejki uploadu.

## Wymagania

**Google Chrome** albo przeglądarka oparta na Chromium z obsługą `Manifest V3` i `Offscreen API`.

**Docker** z **Docker Compose v2** oraz **make**, żeby budować rozszerzenie bez lokalnej instalacji Node.js.

Rozszerzenie używa następujących uprawnień Chrome:
`activeTab`, `tabCapture`, `offscreen`, `storage`, `tabs`, `desktopCapture`.

Rozszerzenie ma też wąskie `host_permissions` dla:
1. `https://meet2note.com/*` - flow połączenia konta, wymiana kodu i upload nagrań do backendu.
2. `http://localhost/*` oraz `http://127.0.0.1/*` - lokalne testy integracyjne z backendem podczas developmentu.
3. `https://sentry.eengine.pl/*` - opcjonalna diagnostyka błędów, jeśli build zawiera DSN Sentry.

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

Publikacja paczki ZIP dla serwisu Meet2Note odbywa się przez workflow GitHub Actions `Publish Extension Package`. Zmiana `version` w `manifest.json` i push do `main` uruchamia workflow, który buduje ZIP i publikuje go na serwerze.


Otwórz Google Meet i kliknij ikonę rozszerzenia:
1. **Connect to Meet2Note** - otwiera backendowy flow połączenia z kontem użytkownika.
2. **Enable Microphone / Microphone Settings** - otwiera konfigurację mikrofonu i pozwala wybrać urządzenie wejściowe.
3. **Start Recording / Stop & Upload** - nagrywa kartę i wysyła wynik do `https://meet2note.com`.

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
   d) Jeśli popup pokazuje `Not connected`, kliknij **Connect to Meet2Note** i przejdź przez flow logowania/połączenia w backendzie.
   e) Po połączeniu popup pokazuje konto Meet2Note, a token użytkownika jest zapisany w `chrome.storage.local`.
   f) **Start Recording** rozpoczyna nagrywanie bieżącej karty (wideo + audio systemowe). Jeśli mikrofon jest dostępny, zostanie nagrany jako osobny asset.
   g) Podczas nagrywania ten sam przycisk zmienia się na **Stop & Upload**, finalizuje nagranie i wysyła assety do `https://meet2note.com`.
   h) Lista ostatnich nagrań pokazuje status każdego uploadu oraz kiedy nastąpi kolejna próba retry.

> Na aktywnym spotkaniu Google Meet rozszerzenie pokazuje znacznik `RDY`, a podczas nagrywania `REC`. Jeśli nagranie zostało rozpoczęte na karcie Meet, wyjście ze spotkania automatycznie zatrzymuje nagrywanie i uruchamia upload do backendu. Rozszerzenie nie zapisuje nagrań lokalnie przez Chrome Downloads API.

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
├─ connect-callback.html
├─ offscreen.html
├─ micsetup.html
├─ .github/             # szablony GitHub, instrukcje Copilota i CI
├─ docs/                # mapa systemu, specyfikacje i runbooki
├─ scripts/             # lokalne skrypty pomocnicze
├─ src/
│  ├─ background.ts     # service worker MV3: tworzy offscreen i koordynuje strumienie
│  ├─ connectCallback.ts # callback flow połączenia Meet2Note
│  ├─ extensionAuth.ts  # token użytkownika, state flow połączenia i storage
│  ├─ offscreen.ts      # uruchamia nagrywarkę i wysyła assety do backendu
│  ├─ popup.tsx         # UI popupu w React + Ant Design: mikrofon, start/stop
│  ├─ micPreferences.ts # wspólne helpery zapisu wyboru mikrofonu
│  ├─ uploadClient.ts   # klient kontraktu uploadu backendu
│  └─ micsetup.tsx      # strona React + Ant Design do nadania uprawnienia i wyboru mikrofonu
└─ dist/                # wygenerowany wynik builda
```

## Konfiguracja
1. Asset mikrofonu
  a) W `src/offscreen.ts`:
```
const WANT_MIC_ASSET = true
```
  b) Ustaw `false`, żeby całkowicie wyłączyć nagrywanie assetu mikrofonu i wysyłać tylko `video_audio`.

2. Backend uploadu
  a) Domyślny URL: `https://meet2note.com`.
  b) Ten sam URL jest używany dla flow `Connect to Meet2Note`, callbacku wymiany kodu i uploadu.
  c) Możesz go zmienić przy buildzie:

```
UPLOAD_API_BASE_URL=http://localhost:3000 make build
```

## Komendy builda

`make build` - domyślny build produkcyjny do `dist/` przez Docker Compose
`make check` - domyślna walidacja: typecheck i build produkcyjny w kontenerze
`make package` - buduje `dist/` i tworzy `release/meet2note-chrome-extension-vX.Y.Z.zip`
`make zip` - alias do `make package`
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
3. React + Ant Design dla popupu i strony konfiguracji mikrofonu
4. copy-webpack-plugin, clean-webpack-plugin
5. @types/chrome, @types/node, @types/react, @types/react-dom
6. @sentry/browser dla opcjonalnej diagnostyki błędów

Są już zadeklarowane w `package.json`:
```
"devDependencies": {
  "@types/chrome": "^0.0.326",
  "@types/node": "^24.0.4",
  "@types/react": "^19.2.14",
  "@types/react-dom": "^19.2.3",
  "clean-webpack-plugin": "^4.0.0",
  "copy-webpack-plugin": "^13.0.1",
  "ts-loader": "^9.5.0",
  "typescript": "^5.8.3",
  "webpack": "^5.99.9",
  "webpack-cli": "^6.0.1"
},
"dependencies": {
  "@ant-design/icons": "^6.1.1",
  "@sentry/browser": "^10.50.0",
  "antd": "^6.3.6",
  "react": "^19.2.5",
  "react-dom": "^19.2.5"
}
```
## Wyjaśnienie uprawnień
1. `activeTab`, `tabs` - odczyt aktywnej karty, potrzebny do wskazania i opisania nagrania.
2. `tabCapture` / `desktopCapture` - przechwytywanie wideo i audio z bieżącej karty.
3. `offscreen` - tworzenie dokumentu offscreen dla logiki nagrywania i uploadu działającej w tle.
4. `storage` - zapis tymczasowych wskazówek o stanie nagrywania/uploadu, wyboru mikrofonu oraz długotrwałego tokenu Meet2Note.
5. `host_permissions` dla `https://meet2note.com/*` - flow połączenia konta, wymiana jednorazowego kodu i upload nagrań do backendu.
6. `host_permissions` dla `http://localhost/*` oraz `http://127.0.0.1/*` - lokalne endpointy developerskie używane podczas testów integracji i uploadu poza docelowym środowiskiem `https://meet2note.com`.
7. `host_permissions` dla `https://sentry.eengine.pl/*` - wysyłka zdarzeń diagnostycznych do Sentry, gdy build zawiera DSN.
8. `content_scripts` dla `https://meet.google.com/*` - content script wykrywa wejście i wyjście ze spotkania, żeby pokazać stan `RDY` i automatycznie zatrzymać nagrywanie po opuszczeniu spotkania.

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
3. Jeśli asset mikrofonu jest włączony, sprawdź urządzenie wejściowe i poziomy w systemie.

Pytanie: `Stop & Upload` kończy nagrywanie, ale upload się ponawia. Co zrobić?
Odpowiedź:
1. Sprawdź, czy `https://meet2note.com` działa i czy przeglądarka ma połączenie z siecią.
2. Rozszerzenie ponawia pełną próbę uploadu tej pozycji co 15 sekund, a kolejne nagrania mogą w tym czasie trafiać do kolejki.
3. Nie zamykaj przeglądarki ani nie przeładowuj rozszerzenia, bo gotowe bloby są trzymane w pamięci i mogą zostać oznaczone jako utracone.

Pytanie: Popup pokazuje `Connect to Meet2Note` albo `Reconnect to Meet2Note`. Co zrobić?
Odpowiedź:
1. Kliknij `Connect to Meet2Note`.
2. Jeśli backend poprosi o logowanie, zaloguj się kontem Google.
3. Po udanym callbacku wróć do popupu i sprawdź, czy pokazuje połączone konto.
4. Jeśli backend odrzuci token przy uploadzie, rozszerzenie przerywa zwykły retry i wymaga ponownego połączenia.

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
