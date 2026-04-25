# Przewodnik agentowy: Chrome Extension MV3 + TypeScript

## Cel

Ten przewodnik jest lokalnym zestawem zasad dla agentów pracujących nad tym rozszerzeniem Chrome. Nie zastępuje oficjalnej dokumentacji Chrome, TypeScript ani MDN; wskazuje wzorce, które mają być domyślnie stosowane w tym repo.

Stosuj go przed zmianami w:

1. `manifest.json`
2. `src/background.ts`
3. `src/offscreen.ts`
4. `src/popup.ts`
5. `src/micsetup.ts`
6. `webpack.config.js`
7. plikach HTML rozszerzenia

## Źródła prawdy

1. Chrome Extensions
   a) Service worker lifecycle: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
   b) Messaging: https://developer.chrome.com/docs/extensions/develop/concepts/messaging
   c) Permissions and warnings: https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings
   d) Offscreen API: https://developer.chrome.com/docs/extensions/reference/api/offscreen
   e) Oficjalne sample: https://github.com/GoogleChrome/chrome-extensions-samples

2. Web Media APIs
   a) `MediaDevices.enumerateDevices()`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/enumerateDevices
   b) `MediaDevices.getUserMedia()`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
   c) `MediaTrackConstraints.deviceId`: https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints/deviceId

3. TypeScript i JavaScript
   a) `strict`: https://www.typescriptlang.org/tsconfig/strict.html
   b) TypeScript handbook: https://www.typescriptlang.org/docs/handbook/intro.html
   c) typescript-eslint rules: https://typescript-eslint.io/rules/
   d) npm `package.json`: https://docs.npmjs.com/cli/v11/configuring-npm/package-json

## Zasady Manifest V3

1. Manifest traktuj jako kontrakt bezpieczeństwa.
   a) Dodawaj uprawnienia tylko wtedy, gdy są niezbędne do konkretnej funkcji.
   b) Przy każdej zmianie `permissions`, `host_permissions` albo `web_accessible_resources` opisz powód w podsumowaniu.
   c) Nie dodawaj szerokich host permissions, jeśli wystarczy `activeTab` albo jawna akcja użytkownika.

2. Nie zakładaj długiego życia service workera.
   a) `background.ts` może zostać zatrzymany przez Chrome.
   b) Stan potrzebny po wznowieniu zapisuj w `chrome.storage.session` albo `chrome.storage.local`, zależnie od trwałości.
   c) Nie polegaj na globalnych zmiennych jako jedynym źródle prawdy dla stanu, który musi przeżyć restart service workera.

3. Rozdzielaj odpowiedzialności.
   a) `background.ts` koordynuje lifecycle, tab capture, badge, messaging i download.
   b) `offscreen.ts` wykonuje cięższe operacje media/recording.
   c) `popup.ts` obsługuje UI i wysyła intencje użytkownika.
   d) `micsetup.ts` obsługuje widoczne flow uprawnień i konfiguracji mikrofonu.

## Messaging

1. Preferuj jawne typy komunikatów.
   a) Każdy komunikat powinien mieć pole `type`.
   b) Payload powinien być prosty i serializowalny do JSON.
   c) Nie przesyłaj przez messaging obiektów DOM, streamów ani klas z metodami.

2. Każde żądanie powinno mieć przewidywalną odpowiedź.
   a) Sukces: `{ ok: true, ... }`
   b) Błąd: `{ ok: false, error: string }`
   c) Brak odpowiedzi traktuj jako błąd transportu.

3. Przy `sendMessage` i portach obsługuj timeouty.
   a) Offscreen i service worker mogą być w trakcie startu.
   b) Timeout powinien prowadzić do kontrolowanego cleanupu albo jednej próby odtworzenia stanu, nie do zawieszenia UI.

4. Nie rozbudowuj protokołu przez luźne stringi rozsiane po plikach.
   a) Jeśli liczba komunikatów rośnie, wydziel typy TypeScript albo mały moduł z definicjami message’y.
   b) Nazwy komunikatów utrzymuj stabilne i opisowe.

## Offscreen i media

1. Offscreen jest miejscem na operacje, które muszą działać poza popupem.
   a) Nagrywanie, miksowanie audio i `MediaRecorder` zostają w `offscreen.ts`.
   b) Prompt uprawnień mikrofonu nie powinien zależeć od offscreen.
   c) Widoczne flow uprawnień obsługuj przez popup albo dedykowaną stronę rozszerzenia.

2. `getUserMedia()` musi mieć fallbacki.
   a) Jeśli mikrofon nie działa, nie przerywaj nagrywania karty tylko z tego powodu.
   b) Jeśli konkretny `deviceId` jest niedostępny, spróbuj mikrofonu domyślnego.
   c) Jeśli mikrofon domyślny też nie działa, kontynuuj bez mikrofonu, gdy funkcja nagrywania karty nadal ma sens.

3. Zarządzaj zasobami jawnie.
   a) Zatrzymuj tracki po zakończeniu nagrania.
   b) Zamykaj `AudioContext`.
   c) Czyść interwały i listenery, gdy przestają być potrzebne.
   d) Odwołuj blob URL po przekazaniu pliku do pobrania.

4. Logi media powinny pomagać w diagnozie.
   a) Loguj liczbę tracków audio/wideo.
   b) Loguj fallback mikrofonu i powód fallbacku.
   c) Nie loguj danych prywatnych, treści rozmów ani pełnych ścieżek lokalnych.

## Storage

1. Dobierz storage do trwałości.
   a) `chrome.storage.session` dla krótkotrwałego stanu UI/runtime, np. czy trwa nagranie.
   b) `chrome.storage.local` dla decyzji użytkownika, np. wybrany mikrofon.

2. Dane w storage powinny mieć prosty schemat.
   a) Używaj nazwanych kluczy.
   b) Zapisuj tylko wartości potrzebne do działania.
   c) Dla konfiguracji użytkownika zapisuj też etykietę pomocniczą, jeśli ułatwia UI, ale nie traktuj jej jako identyfikatora technicznego.

3. Obsługuj brak albo nieaktualność danych.
   a) Każdy odczyt storage może zwrócić brak klucza.
   b) Urządzenia audio mogą zniknąć między sesjami.
   c) Nieaktualną konfigurację czyść albo ignoruj z czytelnym fallbackiem.

## TypeScript

1. Unikaj `any`, jeśli możesz tanio opisać typ.
   a) Dopuszczalne wyjątki to braki w typach Chrome albo małe adaptery API.
   b) Przy wyjątku dodaj krótki komentarz wyjaśniający powód.

2. Nie ukrywaj błędów bez powodu.
   a) Puste `catch {}` stosuj tylko dla świadomie niekrytycznych ścieżek.
   b) Jeśli błąd wpływa na zachowanie użytkownika, loguj go albo zwróć czytelny komunikat.

3. Preferuj małe funkcje z jedną odpowiedzialnością.
   a) Osobno buduj constraints.
   b) Osobno czytaj konfigurację.
   c) Osobno wykonuj fallback.

4. Utrzymuj kod kompatybilny z obecnym toolchainem.
   a) Nie dodawaj frameworków ani bundlerów bez specyfikacji.
   b) Nie zmieniaj `tsconfig.json`, webpacka ani sposobu builda bez uzasadnienia.

## UI rozszerzenia

1. Popup ma być prosty i odporny na restart tła.
   a) Po otwarciu odczytuje aktualny stan nagrywania.
   b) Przyciski nie powinny zostawać trwale zablokowane po błędzie.
   c) Długotrwałe konfiguracje otwieraj w osobnej stronie rozszerzenia.

2. Strona konfiguracji może być prosta, ale musi być kompletna.
   a) Pokazuj status uprawnień.
   b) Pokazuj błędy w sposób zrozumiały dla użytkownika.
   c) Nie wymagaj ręcznej edycji storage ani restartu rozszerzenia do typowej zmiany ustawień.

3. Teksty UI zostają po angielsku, chyba że zadanie dotyczy lokalizacji UI.

## Prywatność i bezpieczeństwo

1. Nie wysyłaj nagrań, strumieni audio/wideo ani metadanych spotkań poza przeglądarkę bez jednoznacznej decyzji człowieka.
2. Nie dodawaj zewnętrznych backendów ani telemetryki bez specyfikacji i zgody.
3. Minimalizuj zakres uprawnień Chrome.
4. Nie zapisuj lokalnie nagrań ani blobów w repo.
5. Nie commituj wygenerowanego `dist/`, nagrań, sekretów ani lokalnych danych testowych.

## Weryfikacja zmian

1. Po zmianach w kodzie lub konfiguracji uruchom:

```bash
make check
```

2. Przy zmianach w zachowaniu przeglądarkowym wykonaj runbook:

```text
docs/runbooks/002-smoke-test-po-zmianach.md
```

3. Przy zmianach w `manifest.json` sprawdź po buildzie:
   a) wersję w `dist/manifest.json`,
   b) listę uprawnień,
   c) brak niezamierzonych `host_permissions`,
   d) brak wygenerowanych artefaktów w commicie.

4. Przy zmianach media sprawdź minimum:
   a) start nagrywania,
   b) stop i pobranie `.webm`,
   c) zachowanie bez mikrofonu,
   d) zachowanie po przeładowaniu rozszerzenia.
