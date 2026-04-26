# Specyfikacja: upload do backendu meet2note.com

## Podsumowanie

Celem zmiany jest przejście z pobierania lokalnego pliku `.webm` na bezpośredni upload nagrania do backendu działającego pod `https://meet2note.com`. Tę domenę traktujemy na razie jako środowisko deweloperskie/prod-like, bo system nie jest jeszcze faktycznie uruchomiony produkcyjnie. Wtyczka ma użyć uzgodnionego API backendu, a nie własnego, równoległego formatu komunikacji.

Zakres tej specyfikacji przygotowuje implementację po stronie wtyczki. Backend pozostaje osobnym repozytorium i źródłem prawdy dla realnego zachowania API.

## Cel

1. Wysyłać nagrania z rozszerzenia bezpośrednio do `https://meet2note.com`.
2. Użyć kontraktu uploadu z backendu:
   a) `POST /api/upload/init`,
   b) `PUT /api/upload/{recordingId}/video`,
   c) opcjonalnie `PUT /api/upload/{recordingId}/microphone`,
   d) `POST /api/upload/{recordingId}/complete`.
3. Przekazywać `X-Upload-Token` zwrócony przez backend po inicjalizacji uploadu.
4. Zachować diagnostykę błędów w Sentry dla problemów z uploadem.

## Zakres

1. W zakresie:
   a) Dodanie konfiguracji bazowego URL backendu z domyślną wartością `https://meet2note.com`.
   b) Dodanie klienta uploadu po stronie rozszerzenia.
   c) Zmiana przepływu po zatrzymaniu nagrywania tak, aby nagranie było wysyłane do backendu zamiast pobierane lokalnie.
   d) Usunięcie lokalnego pobierania nagrania jako domyślnego efektu zatrzymania nagrywania.
   e) Zmiana nagrywania tak, aby domyślnie powstawały dwa assety: `video_audio` oraz `microphone`, jeśli mikrofon jest dostępny.
   f) Dodanie wymaganej zgody Chrome na komunikację z `https://meet2note.com/*`.
   g) Przekazywanie metadanych nagrania do `/api/upload/init`.
   h) Obsługa błędów sieciowych, błędów HTTP i timeoutów.
   i) Aktualizacja README, mapy systemu i runbooków.
   j) Podbicie wersji rozszerzenia zgodnie z zasadami z `AGENTS.md`.

2. Poza zakresem:
   a) Implementacja backendu.
   b) Autoryzacja użytkowników po stronie wtyczki, jeśli backend jeszcze jej nie wymaga.
   c) Finalna normalizacja audio, transkodowanie i transkrypcja.
   d) Integracje backendu z zewnętrznymi API lub usługami firm trzecich.
   e) Publikacja wtyczki do Chrome Web Store.

## Obecne zachowanie

1. `src/offscreen.ts` nagrywa media przez `MediaRecorder` i zwraca blob URL.
2. `src/background.ts` po zatrzymaniu nagrywania uruchamia pobranie pliku przez Chrome Downloads API.
3. Popup pokazuje przycisk `Start Recording` / `Stop & Download`.
4. Nagranie nie opuszcza przeglądarki poza lokalnym pobraniem pliku.
5. Backend jest opisany w dokumentacji, ale wtyczka nie wykonuje do niego żadnych requestów.
6. `src/offscreen.ts` obecnie miksuje mikrofon do jednego finalnego strumienia, więc surowy plik nie rozdziela audio karty i mikrofonu na osobne assety.

## Backend

1. Repozytorium backendu:
   a) lokalnie: `$HOME/playground/recording-backend`,
   b) GitHub: `pawel-walaszek/recording-backend`.

2. Stos technologiczny backendu:
   a) API: Node.js + TypeScript + NestJS + Fastify,
   b) GUI: React + Vite + Ant Design,
   c) workspace: pnpm workspaces,
   d) lokalny start: `docker compose up -d`.

3. Źródło ustaleń integracyjnych:
   a) issue cross-repo po stronie wtyczki i backendu,
   b) dokumentacja backendu, jeśli backend utrzymuje ją jako aktualną,
   c) realne zachowanie endpointów `https://meet2note.com`.

4. Środowiska:
   a) lokalny backend: `http://localhost:3000`,
   b) docelowy dev/prod-like backend wtyczki: `https://meet2note.com`.

## Proponowana zmiana

1. Konfiguracja backendu
   a) Dodać jedno miejsce konfiguracji bazowego URL uploadu, np. `UPLOAD_API_BASE_URL`.
   b) Domyślna wartość w buildzie deweloperskim wtyczki: `https://meet2note.com`.
   c) Nie zapisywać sekretów, prywatnych tokenów ani danych Sentry w kodzie.
   d) Dodać `https://meet2note.com/*` do `host_permissions`, bo wtyczka będzie wykonywać requesty do tego hosta z kontekstu rozszerzenia.
   e) Nie dodawać szerszych uprawnień typu `https://*/*`.

2. Inicjalizacja uploadu
   a) Po zatrzymaniu nagrywania wtyczka wywołuje `POST /api/upload/init`.
   b) Minimalne metadane:
      - `title`,
      - `meetingId`, jeśli da się go ustalić z Google Meet,
      - `meetingTitle`, jeśli da się go ustalić bez kruchego parsowania UI,
      - `startedAt`,
      - `durationMs`.
   c) Backend zwraca `recordingId`, `uploadToken` i `expiresAt`.
   d) `title` budować deterministycznie z `meetingTitle`, a jeśli go nie ma, z hosta/ścieżki aktywnej karty i daty rozpoczęcia.
   e) `meetingId` dla Google Meet brać z ostatniego segmentu ścieżki URL, jeśli pasuje do kodu spotkania.
   f) Nie parsować agresywnie DOM Google Meet tylko po to, aby wydobyć nazwę spotkania.

3. Upload assetów
   a) Główny blob `video_audio` wysyłać do `PUT /api/upload/{recordingId}/video`.
   b) Request ma używać `Content-Type: application/octet-stream`.
   c) Request ma używać nagłówka `X-Upload-Token: <uploadToken>`.
   d) Mikrofon nagrywać jako osobny asset `microphone`, jeśli strumień mikrofonu jest dostępny.
   e) Asset `video_audio` ma zawierać obraz karty oraz audio karty, bez domiksowanego mikrofonu.
   f) Asset `microphone` wysyłać do `PUT /api/upload/{recordingId}/microphone`.
   g) Jeśli mikrofon jest niedostępny, wysłać tylko `video_audio`, a w `/complete` podać tylko faktycznie wysłane assety.
   h) Surowy asset mikrofonu może mieć format `audio/webm` / Opus, ale request nadal używa `Content-Type: application/octet-stream`, zgodnie z kontraktem.
   i) Po udanym uploadzie nie wywoływać Chrome Downloads API i nie pobierać lokalnego pliku `.webm`.

4. Miejsce wykonania uploadu
   a) Upload wykonywać w `offscreen.ts`, po zatrzymaniu `MediaRecorder` i zbudowaniu blobów.
   b) `background.ts` ma koordynować lifecycle, badge, stan runtime i komunikaty do popupu, ale nie powinien przejmować dużych blobów tylko po to, żeby wykonać upload.
   c) Uzasadnienie: offscreen już obsługuje media i pozostaje naturalnym miejscem dla finalizacji nagrania, a service worker MV3 może zostać uśpiony przy dłuższych operacjach.

5. Zakończenie uploadu
   a) Po pomyślnym uploadzie assetów wywołać `POST /api/upload/{recordingId}/complete`.
   b) W body przekazać listę wysłanych assetów zgodną z kontraktem backendu.
   c) Po sukcesie pokazać w popupie stan zakończonego uploadu.

6. Obsługa błędów
   a) Jeśli `/init` nie powiedzie się, nie rozpoczynać uploadu assetu.
   b) Jeśli upload assetu nie powiedzie się, nie wywoływać `/complete`.
   c) Błędy HTTP i błędy sieciowe logować przez istniejącą diagnostykę.
   d) Komunikat w popupie ma być krótki, ale ma odróżniać błąd nagrywania od błędu uploadu.
   e) Błąd uploadu nie powinien automatycznie uruchamiać lokalnego pobierania pliku jako fallbacku.
   f) Nie logować `uploadToken`, pełnego URL z tokenem ani zawartości blobów.
   g) Jeśli upload się nie powiedzie, zachować gotowe bloby w pamięci i ponawiać pełną próbę uploadu co 15 sekund aż do sukcesu.
   h) Retry ma działać bez trwałego zapisu lokalnego; jeśli Chrome zamknie kontekst rozszerzenia albo przeglądarka zostanie zamknięta, nagranie może zostać utracone.
   i) Każda próba po błędzie powinna zaczynać od nowego `/api/upload/init`, żeby nie polegać na częściowo zużytej sesji uploadu.

7. Stan runtime i popup
   a) Wprowadzić stany: `idle`, `recording`, `stopping`, `uploading`, `upload_retrying`, `uploaded`.
   b) Stan krótkotrwały zapisywać w `chrome.storage.session`, tak jak obecny stan nagrywania.
   c) Popup po otwarciu ma odczytać aktualny stan i pokazać właściwą etykietę oraz status.
   d) Podczas `uploading` przycisk start/stop ma być zablokowany albo ma jasno pokazywać, że trwa finalizacja.
   e) Podczas retry status powinien jasno informować, że upload jest ponawiany i że kolejna próba nastąpi za około 15 sekund.

8. UI
   a) Przycisk nie powinien sugerować pobrania, jeśli domyślną akcją jest upload.
   b) Etykietę `Stop & Download` zmienić na `Stop & Upload`.
   c) Timer nagrywania pozostaje bez zmian w trakcie nagrywania.
   d) Po zatrzymaniu timer może zostać zastąpiony statusem uploadu, np. `Uploading...`, `Retrying upload...`, `Uploaded`.
   e) Nie dodawać lokalnego przycisku download w ramach tej zmiany.

## Decyzje projektowe

1. `https://meet2note.com` traktujemy jako dev/prod-like.
   a) Uzasadnienie: domena już odpowiada, ale projekt nie jest jeszcze live produkcyjnie.

2. API backendu jest nadrzędne wobec lokalnych pomysłów wtyczki.
   a) Uzasadnienie: backend będzie obsługiwał dalszą normalizację, transkodowanie, transkrypcję i udostępnianie.

3. Na start nie dokładamy autoryzacji użytkownika w rozszerzeniu, jeśli backend jej jeszcze nie egzekwuje.
   a) Uzasadnienie: aktualny kontrakt uploadu opiera się na `uploadToken` zwracanym przez `/init`.

4. Nie kodujemy integracji z zewnętrznymi usługami po stronie wtyczki.
   a) Uzasadnienie: integracje typu storage, AI/transkrypcja i przetwarzanie mają należeć do backendu.

5. Upload zastępuje lokalny zapis nagrania.
   a) Uzasadnienie: docelowo użytkownik nie ma pracować na surowym pliku `.webm`; nagranie ma trafić do backendu, gdzie będzie dalej przetwarzane, normalizowane i udostępniane.
   b) Lokalny download nie jest fallbackiem dla błędów uploadu.
   c) Ewentualny ręczny eksport lokalnego pliku może wrócić tylko jako osobna funkcja po jawnej decyzji.
   d) Przy błędzie uploadu wtyczka nie pobiera pliku lokalnie, tylko ponawia upload co 15 sekund aż do sukcesu.

6. Mikrofon wysyłamy jako osobny asset, nie jako miks w `video_audio`.
   a) Uzasadnienie: backend ma docelowo normalizować poziomy audio i dopiero potem łączyć ścieżki.
   b) `video_audio` oznacza obraz karty oraz audio karty.
   c) `microphone` oznacza surowe audio z wybranego mikrofonu.
   d) Jeśli mikrofon jest niedostępny, upload bez mikrofonu nadal jest poprawnym, zdegradowanym przepływem.

7. Upload wykonywany jest w offscreen.
   a) Uzasadnienie: offscreen posiada blob po finalizacji `MediaRecorder` i lepiej pasuje do długich operacji media niż service worker.
   b) `background.ts` pozostaje koordynatorem stanu i komunikacji z popupem.

8. Zmiana wersji rozszerzenia powinna być podbiciem minor.
   a) Uzasadnienie: zastąpienie lokalnego downloadu uploadem do backendu to istotna zmiana zachowania.
   b) Dla obecnej linii `1.5.x` oczekiwany kolejny numer to `1.6.0`, chyba że przed implementacją wersja w `manifest.json` będzie już wyższa.

9. Retry uploadu trwa do skutku.
   a) Po błędzie wtyczka ponawia pełną próbę uploadu co 15 sekund.
   b) Retry nie ma limitu liczby prób po stronie wtyczki.
   c) Wtyczka nie zapisuje nagrania lokalnie na dysku jako mechanizmu retry.
   d) Retry działa tak długo, jak długo Chrome utrzymuje kontekst rozszerzenia z blobami w pamięci.

## Niejednoznaczności rozstrzygnięte w specyfikacji

1. Czy produkcyjnie wyglądająca domena `https://meet2note.com` ma być traktowana ostrożnie jak produkcja?
   a) Nie na tym etapie. Dla tej zmiany traktujemy ją jako środowisko dev/prod-like.

2. Czy wtyczka ma wymyślać własny endpoint uploadu?
   a) Nie. Używa API uzgodnionego z `recording-backend`.

3. Czy upload ma zawierać osobny asset mikrofonu?
   a) Tak, jeśli mikrofon jest dostępny.
   b) Implementacja ma przestać traktować miks mikrofonu do `video_audio` jako domyślny format docelowy dla uploadu.

4. Czy po udanym uploadzie wtyczka ma nadal pobierać lokalny plik `.webm`?
   a) Nie. Upload do `https://meet2note.com` zastępuje pobieranie.
   b) Nie dodajemy też automatycznego lokalnego pobierania jako fallbacku przy błędzie uploadu.

5. Czy `https://meet2note.com/*` trzeba dodać do `host_permissions`?
   a) Tak. Wtyczka będzie wykonywać requesty do tego hosta, więc uprawnienie ma być jawne i wąskie.

6. Czy upload ma być w `background.ts` czy w `offscreen.ts`?
   a) W `offscreen.ts`, bo tam powstają bloby po nagrywaniu.
   b) `background.ts` tylko przekazuje stan i koordynuje lifecycle.

7. Jaką etykietę ma mieć przycisk zatrzymania?
   a) `Stop & Upload`.

8. Co zrobić z gotowym nagraniem, jeśli upload do backendu się nie powiedzie?
   a) Zachować gotowe bloby w pamięci i ponawiać upload co 15 sekund aż do sukcesu.
   b) Nie pobierać lokalnego pliku i nie zapisywać trwałej kopii nagrania na dysku.
   c) Jeśli kontekst rozszerzenia zostanie zamknięty przez Chrome albo użytkownik zamknie przeglądarkę, retry może zostać przerwany, a nagranie utracone.

## Kryteria akceptacji

1. Wtyczka po zatrzymaniu nagrywania inicjuje upload przez `POST /api/upload/init`.
2. Wtyczka wysyła główny blob do `PUT /api/upload/{recordingId}/video`.
3. Wtyczka wysyła osobny blob mikrofonu do `PUT /api/upload/{recordingId}/microphone`, jeśli mikrofon jest dostępny.
4. Wtyczka przekazuje `X-Upload-Token` przy uploadzie assetów i przy `/complete`.
5. Wtyczka kończy upload przez `POST /api/upload/{recordingId}/complete`.
6. Body `/complete` zawiera tylko faktycznie wysłane assety.
7. Po udanym uploadzie wtyczka nie pobiera lokalnego pliku `.webm`.
8. Przy błędzie uploadu wtyczka nie uruchamia automatycznego lokalnego pobierania.
9. Przy błędzie uploadu wtyczka ponawia pełny upload co 15 sekund aż do sukcesu.
10. Popup pokazuje stan uploadu i informację o retry.
11. Błędy uploadu trafiają do istniejącej diagnostyki bez tokenów i bez zawartości nagrań.
12. README i mapa systemu opisują nowy przepływ bez lokalnego zapisu jako domyślnej ścieżki.
13. `manifest.json` ma `host_permissions` ograniczone do niezbędnych domen, w tym `https://meet2note.com/*`.
14. `manifest.json` ma podbitą wersję zgodnie z zasadą minor dla tej zmiany.
15. `make check` przechodzi.

## Weryfikacja

1. Uruchomić:

```bash
make check
```

2. Załadować świeże `dist/` w `chrome://extensions`.
3. Wykonać krótkie nagranie na stronie testowej albo w Google Meet.
4. Zatrzymać nagrywanie i potwierdzić requesty:
   a) `POST /api/upload/init`,
   b) `PUT /api/upload/{recordingId}/video`,
   c) `PUT /api/upload/{recordingId}/microphone`, jeśli mikrofon jest dostępny,
   d) `POST /api/upload/{recordingId}/complete`.
5. Potwierdzić po stronie backendu, że nagranie jest widoczne jako rekord uploadu.
6. Potwierdzić, że po sukcesie Chrome nie pobiera lokalnego `.webm`.
7. Wymusić błąd backendu albo sieci i potwierdzić, że popup pokazuje retry uploadu.
8. Przywrócić backend albo sieć i potwierdzić, że kolejna próba po maksymalnie około 15 sekundach kończy upload sukcesem.
9. Potwierdzić, że Sentry dostaje diagnostykę błędów bez tokenów i bez zawartości nagrania.

## Ryzyka

1. CORS albo konfiguracja proxy na `https://meet2note.com` może blokować requesty z rozszerzenia.
   a) Mitigacja: sprawdzić requesty z `chrome-extension://...` i w razie potrzeby poprawić backend/proxy.

2. Duże pliki `.webm` mogą powodować timeout albo wysokie zużycie pamięci.
   a) Mitigacja: w pierwszym kroku wysyłać cały blob, ale zostawić w dokumentacji miejsce na późniejszy upload chunkowany.

3. Service worker MV3 może zostać uśpiony podczas długiego uploadu.
   a) Mitigacja: wykonać upload w offscreen document i utrzymywać kontrolowany przepływ finalizacji.

4. Backend może mieć jeszcze placeholderową obsługę storage.
   a) Mitigacja: przed implementacją sprawdzić aktualny stan `recording-backend`, powiązane issue i realne zachowanie API.

5. Zmiana z pobierania na upload zmienia oczekiwania użytkownika.
   a) Mitigacja: jednoznacznie zmienić etykiety UI i README.
