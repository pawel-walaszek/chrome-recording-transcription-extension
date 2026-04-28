# Specyfikacja: kolejka uploadu i historia nagrań

## Cel

Zrealizować zakres issue [#10](https://github.com/pawel-walaszek/chrome-recording-transcription-extension/issues/10): upload zakończonego nagrania ma działać w tle i nie blokować rozpoczęcia kolejnego nagrania, a popup ma pokazywać kilka ostatnich nagrań z ich własnymi statusami.

Użytkownik powinien widzieć oddzielnie:

1. Stan aktywnego nagrywania.
2. Stan kolejki uploadów zakończonych nagrań.
3. Historię ostatnich nagrań z błędami, retry i `recordingId` z backendu po sukcesie.

## Zakres

1. W zakresie:
   a) Zastąpienie pojedynczego globalnego stanu uploadu kolejką pozycji uploadu.
   b) Rozdzielenie stanu nagrywania od stanu uploadów.
   c) Usunięcie blokady startu nowego nagrania, gdy poprzednie nagranie jest w `uploading` albo `retrying`.
   d) Sekwencyjny worker uploadu: jedno aktywne wysyłanie naraz, reszta pozycji czeka.
   e) Lokalna historia ostatnich nagrań w `chrome.storage.local`.
   f) Przechowywanie blobów nagrań w pamięci dokumentu offscreen na czas kolejki i retry.
   g) Popup z listą kilku ostatnich nagrań, statusami, metadanymi i błędami.
   h) Retry co około 15 sekund na poziomie konkretnej pozycji kolejki.
   i) Obsługa `401`/`403` jako `auth_required` dla konkretnej pozycji i globalny sygnał reconnect.
   j) Odtwarzanie metadanych kolejki po restarcie service workera i ponownym otwarciu popupu.
   k) Aktualizacja smoke testu o scenariusz dwóch nagrań jedno po drugim.

2. Poza zakresem:
   a) Backendowe zmiany API uploadu.
   b) Równoległy upload wielu nagrań.
   c) Trwałe składowanie dużych blobów w IndexedDB albo na dysku.
   d) Ręczny eksport lokalnego pliku `.webm`.
   e) Ręczne kasowanie pojedynczych pozycji historii z UI, o ile nie okaże się konieczne dla ergonomii.
   f) Migracja starszych, już utraconych uploadów zapisanych tylko jako globalny `uploadStatus`.

## Obecne zachowanie

1. `src/background.ts` trzyma pojedynczy globalny stan uploadu: `uploadStatus`, `uploadError`, `uploadNextRetryAt`, `uploadedRecordingId`.
2. `START_RECORDING` w `src/background.ts` odrzuca start, jeśli globalny upload jest w `uploading` albo `upload_retrying`.
3. `src/offscreen.ts` ma pojedynczą flagę `uploadInProgress` i również blokuje start nagrywania podczas uploadu.
4. Po `MediaRecorder.onstop` offscreen buduje bloby i uruchamia `uploadRecordingUntilSuccess()`, które ponawia pełny upload co około 15 sekund.
5. Retry dotyczy jednego globalnego uploadu, nie konkretnej pozycji.
6. Popup w `src/popup.tsx` pokazuje tylko globalny status uploadu pod przyciskiem start/stop.
7. Metadane uploadu są krótkotrwale zapisywane w `chrome.storage.session`; nie ma trwałej historii ostatnich nagrań.

## Decyzje Projektowe

1. Aktywne nagrywanie pozostaje pojedyncze.
   a) Rozszerzenie nadal może nagrywać tylko jedną kartę naraz.
   b) Zmiana dotyczy tylko tego, że upload poprzednich nagrań nie blokuje nowego startu.

2. Uploady wykonujemy sekwencyjnie.
   a) Jedna aktywna pozycja ma status `uploading` albo `retrying`.
   b) Kolejne zakończone nagrania czekają jako `queued`.
   c) Uzasadnienie: kontrakt backendu i zużycie pasma/pamięci są bezpieczniejsze przy jednym aktywnym uploadzie.

3. Bloby pozostają w pamięci offscreen.
   a) Gotowe `videoBlob` i opcjonalny `microphoneBlob` są trzymane w pamięci kolejki offscreen.
   b) `chrome.storage.local` przechowuje tylko metadane historii, nie zawartość nagrań.
   c) Uzasadnienie: trwałe składowanie dużych blobów wymaga osobnej decyzji o IndexedDB, limitach, czyszczeniu i prywatności.

4. Restart service workera ma być obsłużony przez metadane i ponowne spięcie z offscreen.
   a) Po restarcie service worker odczytuje historię z `chrome.storage.local`.
   b) Jeśli offscreen nadal żyje, background pobiera aktualny snapshot kolejki przez komunikat do offscreen.
   c) Jeśli offscreen został utracony razem z blobami, pozycje nieukończone są oznaczane jako `failed` z komunikatem o utracie danych nagrania.

5. `401` i `403` nie uruchamiają zwykłego retry.
   a) Pozycja przechodzi w `auth_required`.
   b) Token Meet2Note jest czyszczony przez istniejący mechanizm reconnect.
   c) Po ponownym połączeniu pozycja może wrócić do `queued`, jeśli jej bloby nadal istnieją w pamięci offscreen.
   d) Jeśli bloby zostały utracone, pozycja pozostaje `failed`.

6. Historia ma ograniczony rozmiar.
   a) Domyślny limit: 10 ostatnich pozycji.
   b) Starsze pozycje terminalne są usuwane po przekroczeniu limitu.
   c) Pozycje nieterminalne (`queued`, `uploading`, `retrying`, `auth_required`) nie są usuwane przez limit, dopóki mają szansę na upload.

7. Globalny `uploadStatus` zostaje zastąpiony snapshotem kolejki.
   a) Popup nie powinien już blokować przycisku startu tylko dlatego, że istnieje aktywny upload.
   b) Blokady przycisku start/stop dotyczą wyłącznie stanu aktywnego nagrywania, startu, zatrzymywania i braku połączenia z Meet2Note.

## Model Danych

1. Status pozycji historii:

```ts
type RecordingUploadStatus =
  | 'queued'
  | 'uploading'
  | 'retrying'
  | 'uploaded'
  | 'auth_required'
  | 'failed'
```

2. Trwała pozycja historii w `chrome.storage.local`, np. pod kluczem `meet2noteRecordingHistory`:

```ts
interface RecordingHistoryItem {
  localId: string
  status: RecordingUploadStatus
  title: string
  meetingId?: string
  meetingTitle?: string
  tabUrl?: string
  startedAt: string
  stoppedAt: string
  durationMs: number
  videoBytes: number
  microphoneBytes: number
  attempt: number
  nextRetryAt: number | null
  backendRecordingId: string | null
  assets: Array<'video_audio' | 'microphone'>
  error: string | null
  createdAt: string
  updatedAt: string
}
```

3. Nietrwała pozycja kolejki w offscreen:

```ts
interface UploadQueueEntry extends RecordingHistoryItem {
  videoBlob: Blob
  microphoneBlob: Blob | null
}
```

4. `localId`:
   a) Generowany po finalizacji nagrania, przed dodaniem pozycji do historii.
   b) Wystarczy `crypto.randomUUID()`, z fallbackiem na losowy string, jeśli API nie jest dostępne.

## Maszyna Stanów

1. Po zatrzymaniu nagrania:
   a) offscreen buduje `videoBlob` i `microphoneBlob`,
   b) tworzy `UploadQueueEntry`,
   c) zapisuje metadane do historii jako `queued`,
   d) uruchamia worker uploadu, jeśli nie działa.

2. Worker uploadu:
   a) wybiera najstarszą pozycję `queued`,
   b) ustawia `uploading`,
   c) pobiera aktualny `extensionToken`,
   d) wykonuje `uploadRecordingOnce()`,
   e) po sukcesie ustawia `uploaded` i zapisuje `backendRecordingId`,
   f) usuwa bloby tej pozycji z pamięci,
   g) przechodzi do kolejnej pozycji.

3. Błąd zwykły:
   a) pozycja przechodzi w `retrying`,
   b) zapisuje `error`, `attempt` i `nextRetryAt`,
   c) worker czeka około 15 sekund,
   d) ta sama pozycja wraca do `uploading`,
   e) pozostałe pozycje czekają w `queued`.

4. Błąd autoryzacji:
   a) pozycja przechodzi w `auth_required`,
   b) zwykły retry tej pozycji zatrzymuje się,
   c) popup pokazuje reconnect,
   d) po zmianie tokenu worker może requeue'ować pozycje `auth_required`, jeśli bloby nadal są dostępne.

5. Utrata blobów:
   a) dotyczy zamknięcia offscreen, restartu przeglądarki albo cleanupu, który usuwa pamięć kolejki,
   b) metadane pozycji nieterminalnych pozostają w `chrome.storage.local`,
   c) pozycje bez blobów przechodzą w `failed`,
   d) komunikat błędu powinien wyjaśniać, że danych nagrania nie da się już wysłać.

## Komunikacja Między Komponentami

1. `src/offscreen.ts`:
   a) utrzymuje pamięciową kolejkę `UploadQueueEntry[]`,
   b) wykonuje sekwencyjny worker uploadu,
   c) aktualizuje historię w `chrome.storage.local`,
   d) publikuje snapshot kolejki przez port do background.

2. `src/background.ts`:
   a) usuwa blokadę startu zależną od uploadu,
   b) nadal koordynuje aktywne nagrywanie, badge i offscreen,
   c) hydratuje historię z `chrome.storage.local`,
   d) przekazuje popupowi stan nagrywania i snapshot ostatnich nagrań,
   e) po reconnect/token change prosi offscreen o wznowienie pozycji `auth_required`, jeśli ma bloby.

3. `src/popup.tsx`:
   a) przestaje używać pojedynczego `UploadState` jako źródła blokady startu,
   b) odczytuje snapshot przez `GET_RECORDING_STATUS` albo nowy komunikat `GET_EXTENSION_STATUS`,
   c) słucha komunikatów `RECORDING_STATE` i `UPLOAD_QUEUE_STATE`,
   d) renderuje listę kilku ostatnich pozycji.

4. Komunikat snapshotu kolejki:

```ts
interface UploadQueueSnapshotMessage {
  type: 'UPLOAD_QUEUE_STATE'
  items: RecordingHistoryItem[]
}
```

5. Odpowiedź statusowa dla popupu powinna zawierać:
   a) obecny stan nagrywania,
   b) `recordingStartedAt`,
   c) `starting` / `stopping`,
   d) `recentRecordings: RecordingHistoryItem[]`.

## UI Popupu

1. Główna akcja:
   a) `Start Recording` pozostaje dostępne, gdy konto jest połączone i nie trwa aktywne nagrywanie/start/stop.
   b) Upload w tle nie zmienia etykiety przycisku na `Uploading...`.
   c) Podczas nagrywania przycisk pokazuje `Stop & Upload`.

2. Historia:
   a) Pokazać kompaktową sekcję ostatnich nagrań pod główną akcją.
   b) Widoczny limit w popupie: 5 najnowszych pozycji.
   c) Dane pozycji: tytuł, status, czas/długość, `recordingId` po sukcesie albo błąd/retry.
   d) UI ma być gęsty i czytelny w obecnej szerokości popupu.

3. Statusy użytkowe:
   a) `queued`: `Waiting to upload`.
   b) `uploading`: `Uploading...`.
   c) `retrying`: `Retrying in Ns`.
   d) `uploaded`: `Uploaded`.
   e) `auth_required`: `Reconnect to upload`.
   f) `failed`: krótki komunikat błędu.

4. Reconnect:
   a) Jeśli istnieje pozycja `auth_required`, popup pokazuje błąd przy sekcji połączenia.
   b) Po ponownym połączeniu historia powinna odświeżyć statusy.

## Plan Implementacji

1. Typy i storage:
   a) Dodać wspólne typy kolejki/historii.
   b) Dodać helpery odczytu/zapisu historii w `chrome.storage.local`.
   c) Dodać przycinanie historii do limitu 10 terminalnych pozycji.

2. Offscreen:
   a) Zastąpić `uploadInProgress` kolejką i flagą workera.
   b) Po finalizacji `MediaRecorder` dodawać pozycję do kolejki zamiast wywoływać bezpośrednio pojedynczy retry loop.
   c) Usunąć blokadę startu nagrania podczas uploadu.
   d) Dodać sekwencyjny worker, retry per item i obsługę `auth_required`.
   e) Publikować `UPLOAD_QUEUE_STATE` po każdej zmianie pozycji.

3. Background:
   a) Usunąć `isUploadBlockingNewRecording()` z warunku startu.
   b) Zastąpić globalne `uploadStatus` obsługą snapshotu kolejki.
   c) Hydratować historię z `chrome.storage.local` w `GET_RECORDING_STATUS`.
   d) Przekazywać snapshot do popupu.

4. Popup:
   a) Zastąpić globalny `UploadState` listą `recentRecordings`.
   b) Usunąć upload jako powód blokowania startu.
   c) Dodać listę ostatnich nagrań i statusy per item.
   d) Zachować obecne connect/disconnect i ustawienia mikrofonu.

5. Dokumentacja:
   a) Zaktualizować README, jeśli opis retry nadal mówi o jednym globalnym uploadzie.
   b) Zaktualizować `docs/system-map.md`.
   c) Zaktualizować smoke test o dwa nagrania wykonane jedno po drugim.

## Kryteria Akceptacji

1. Po zatrzymaniu pierwszego nagrania upload startuje w tle.
2. Drugie nagranie można rozpocząć bez czekania na zakończenie uploadu pierwszego.
3. Jeśli pierwszy upload jest w `retrying`, drugie nagranie nadal można rozpocząć i zakończyć.
4. Uploady są wysyłane sekwencyjnie, po jednej pozycji naraz.
5. Popup pokazuje listę ostatnich nagrań z własnymi statusami.
6. Po sukcesie pozycja ma status `uploaded` i zapisany `backendRecordingId`.
7. Po `401` albo `403` dana pozycja ma status `auth_required`, a zwykły retry jest zatrzymany.
8. Po reconnect pozycja `auth_required` wraca do uploadu, jeśli offscreen nadal ma jej bloby.
9. Po restarcie service workera popup pokazuje historię z `chrome.storage.local`.
10. Jeśli offscreen utraci bloby, nieterminalna pozycja przechodzi w `failed` z czytelnym błędem.
11. Historia nie rośnie bez końca i utrzymuje limit ostatnich pozycji.
12. `make check` przechodzi.

## Weryfikacja

1. Uruchomić:

```bash
make check
```

2. Załadować świeże `dist/` w `chrome://extensions`.
3. Połączyć konto przez `Connect to Meet2Note`.
4. Wykonać pierwsze nagranie i zatrzymać je przez `Stop & Upload`.
5. Zanim pierwszy upload się zakończy, rozpocząć drugie nagranie.
6. Potwierdzić w popupie, że pierwsze nagranie jest `uploading` albo `retrying`, a drugie można nagrywać.
7. Zatrzymać drugie nagranie i potwierdzić, że trafia do kolejki.
8. Potwierdzić w logach/backendzie, że uploady są wykonywane sekwencyjnie.
9. Wymusić błąd sieci/backendu i potwierdzić retry per item co około 15 sekund.
10. Wymusić `401` albo `403` i potwierdzić `auth_required` bez nieskończonego zwykłego retry.
11. Otworzyć popup ponownie i potwierdzić, że historia jest nadal widoczna.
12. Zrestartować service worker i potwierdzić, że popup odtwarza metadane historii.

## Ryzyka

1. Pamięć offscreen może rosnąć przy wielu dużych nagraniach czekających na upload.
   a) Mitigacja: sekwencyjny upload, limit historii i brak równoległości; w przyszłości rozważyć IndexedDB albo upload chunkowany.

2. Chrome może zamknąć offscreen albo przeglądarkę przed zakończeniem uploadu.
   a) Mitigacja: metadane historii zostają, ale po utracie blobów pozycja przechodzi w `failed`.

3. Długi upload może konkurować o zasoby z kolejnym nagrywaniem.
   a) Mitigacja: jeden aktywny upload naraz i obserwacja realnego zachowania w smoke teście.

4. Popup jest mały i może stać się zbyt gęsty.
   a) Mitigacja: pokazać maksymalnie 5 pozycji, krótkie statusy i elipsę dla długich tytułów.

5. Wznowienie `auth_required` po reconnect wymaga koordynacji storage i offscreen.
   a) Mitigacja: po zmianie tokenu background wysyła do offscreen komunikat wznowienia kolejki.

## Otwarte Pytania

Brak pytań blokujących na etapie specyfikacji. Trwałe składowanie blobów w IndexedDB jest świadomie poza zakresem tej iteracji i powinno dostać osobne issue, jeśli okaże się wymagane.
