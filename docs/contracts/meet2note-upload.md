# Kontrakt integracji Meet2Note

Ten dokument opisuje trwały kontrakt między rozszerzeniem Chrome i backendem Meet2Note.

Indeks i zasady katalogu kontraktów: [README.md](README.md), [AGENTS.md](AGENTS.md).

## Repozytorium i środowiska

1. Backend jest rozwijany w repozytorium `pawel-walaszek/recording-backend`.
2. Lokalna ścieżka backendu to `/Users/pawel.walaszek/playground/recording-backend`.
3. Lokalny backend może działać pod `http://localhost:3000`.
4. Docelowy dev/prod-like URL używany przez rozszerzenie to `https://meet2note.com`.
5. `https://meet2note.com` traktujemy jako środowisko deweloperskie/prod-like mimo produkcyjnie wyglądającej domeny.

## Połączenie konta

1. Popup uruchamia flow połączenia przez `GET /extension/connect`.
2. Backend przekierowuje użytkownika na `connect-callback.html` w rozszerzeniu z jednorazowym `code` i `state`.
3. Callback waliduje `state` i wymienia `code` przez `POST /api/extension/token`.
4. Długotrwały `extensionToken` jest zapisywany lokalnie w `chrome.storage.local`.
5. Requesty API używają `Authorization: Bearer <extensionToken>`.
6. Tokenów, kodów wymiany ani nagłówka `Authorization` nie wolno logować do konsoli ani Sentry.

## Upload nagrania

1. Rozszerzenie inicjuje upload przez `POST /api/upload/init`.
2. Minimalne metadane inicjalizacji to:
   a) `title`,
   b) `meetingId`, jeśli da się go ustalić z URL Google Meet,
   c) `meetingTitle`, jeśli da się go ustalić bez kruchego parsowania UI,
   d) `startedAt`,
   e) `durationMs`.
3. Backend zwraca `recordingId`, `uploadToken`, `expiresAt`, `uploadMode`, `recommendedChunkSizeBytes` i `maxAssetSizeBytes`.
   a) `expiresAt` może być `null`; oznacza to upload session bez znanego terminu wygaśnięcia.
4. Docelowy `uploadMode` to `chunked`; rozszerzenie nie używa legacy endpointów `/video` ani `/microphone`.
5. Dla każdego assetu rozszerzenie inicjalizuje metadane przez `PUT /api/upload/{recordingId}/assets/{asset}`.
   a) `asset` to `video_audio` albo `microphone`.
   b) Body zawiera `contentType`, `sizeBytes`, `chunkSizeBytes` i `totalChunks`.
   c) `chunkSizeBytes` musi być dodatnią liczbą całkowitą i nie może przekraczać limitu backendu, obecnie 32 MiB; dla assetów mniejszych niż rekomendowany rozmiar chunka rozszerzenie używa rozmiaru assetu i `totalChunks: 1`.
6. Przed wysyłką brakujących chunków albo po błędzie rozszerzenie pobiera stan assetu przez `GET /api/upload/{recordingId}/assets/{asset}`.
   a) Backend zwraca między innymi `receivedChunks` i `receivedBytes`.
   b) Rozszerzenie wysyła tylko chunki, których backend jeszcze nie przyjął.
7. Pojedynczy chunk jest wysyłany przez `PUT /api/upload/{recordingId}/assets/{asset}/chunks/{chunkIndex}`.
   a) Request używa `Content-Type: application/octet-stream`.
   b) Jeden request zawiera tylko jeden chunk.
   c) Upload chunków jest sekwencyjny w pierwszej wersji.
8. Po przyjęciu wszystkich chunków danego assetu rozszerzenie wywołuje `POST /api/upload/{recordingId}/assets/{asset}/complete`.
9. Rozszerzenie kończy całe nagranie przez `POST /api/upload/{recordingId}/complete`.
10. Body globalnego `/complete` zawiera tylko faktycznie wysłane i zakończone assety.
11. Endpointy assetów, chunków i `/complete` używają nagłówków `Authorization` oraz `X-Upload-Token`.
12. `uploadToken`, pełnych URL-i z tokenami ani zawartości blobów nie wolno logować.
13. Lokalny spool IndexedDB nie jest obecnie czyszczony automatycznie po `/complete`; decyzje o porzuceniu albo usuwaniu pozycji pozostają poza automatem rozszerzenia.

## Assety

1. `video_audio` oznacza obraz karty oraz audio karty.
2. `microphone` oznacza osobne surowe audio z wybranego mikrofonu.
3. Mikrofon nie powinien być domiksowywany do `video_audio` w docelowym formacie uploadu.
4. Jeśli mikrofon jest niedostępny, upload samego `video_audio` jest poprawnym zdegradowanym przepływem.
5. Rozszerzenie nie wykonuje normalizacji audio, transkodowania, transkrypcji ani integracji z zewnętrznymi usługami; to odpowiedzialność backendu.

## Błędy i autoryzacja

1. Jeśli `/init` nie powiedzie się, rozszerzenie nie wysyła assetów.
2. Jeśli inicjalizacja assetu, upload chunka albo asset complete nie powiedzie się, rozszerzenie nie wywołuje globalnego `/complete`.
3. Przy retry rozszerzenie używa zapisanego `recordingId` i `uploadToken`, jeśli sesja uploadu nie wygasła.
4. Retry nie wysyła od początku chunków już potwierdzonych przez backend.
5. Błędy sieciowe i HTTP trafiają do istniejącej diagnostyki bez sekretów i bez zawartości nagrań.
6. `401` albo `403` oznacza konieczność ponownego połączenia z Meet2Note.
7. Po `401` albo `403` rozszerzenie czyści lokalny token, oznacza odpowiednią pozycję jako wymagającą reconnect i nie ponawia zwykłego uploadu bez końca.
8. Jeśli zapisany `uploadSession` zwróci `404`, rozszerzenie traktuje go jako nieaktualny, czyści tylko sesję backendową i zakłada nową sesję dla tego samego lokalnego nagrania.
9. Błędy uploadu i błędy lokalne mają być raportowane do backendu jako stan nagrania z uzasadnieniem, a nie tylko do lokalnego popupu albo Sentry.

## Synchronizacja stanu rozszerzenia

1. Rozszerzenie synchronizuje stan każdej backendowo mutowalnej pozycji przez `PUT /api/recordings/{recordingId}/extension-state`.
2. `recordingId` jest stabilnym UUID po stronie rozszerzenia. Dla historycznych lokalnych identyfikatorów spoza formatu UUID rozszerzenie dogenerowuje UUID i zapisuje go jako `backendRecordingId`.
3. Ten sam identyfikator trafia później do `POST /api/upload/init`, żeby stan przeduploadowy i sesja uploadu dotyczyły tego samego rekordu backendu.
4. Synchronizacja obejmuje statusy właścicielskie rozszerzenia: `recording`, `finalizing`, `upload_queued`, `uploading`, `failed` i `canceled`.
5. Rozszerzenie nie wysyła przez ten endpoint statusów backendowych `processing_queued`, `processing`, `ready` ani `expired`.
6. Obecny backendowy payload przyjmuje `title`, `status`, `startedAt`, `durationMs`, `uploadProgressPercent`, `meetingId` i `meetingUrl`.
7. Docelowo payload musi zostać rozszerzony po stronie backendu o uzasadnienie błędu, między innymi `failureReason`, `error`, `attempt` i `nextRetryAt`; jest to zakres backendowego issue `pawel-walaszek/recording-backend#31`.
8. `failed` bez uzasadnienia jest niepoprawnym stanem produktowym; dopóki backend nie przyjmie tych pól, rozszerzenie przechowuje uzasadnienie lokalnie i synchronizuje sam status.
9. Automatyka rozszerzenia nie powinna wysyłać decyzji o porzuceniu pozycji. Porzucenie, usunięcie albo świadome zakończenie failed pozycji jest decyzją użytkownika w backendzie.

## Uprawnienia Chrome

1. `https://meet2note.com/*` jest wymagane dla flow połączenia konta, wymiany kodu, listy nagrań i uploadu.
2. `http://localhost/*` oraz `http://127.0.0.1/*` są dozwolone tylko dla lokalnych testów integracyjnych.
3. Nie dodawaj szerszych uprawnień hosta typu `https://*/*`, jeśli wystarcza jawna lista hostów.

## Granice funkcjonalne

1. Upload do Meet2Note zastępuje automatyczne pobieranie lokalnego pliku `.webm`.
2. Przy błędzie uploadu rozszerzenie nie uruchamia automatycznego lokalnego downloadu jako fallbacku.
3. Ręczny eksport surowego pliku może wrócić tylko jako osobna funkcja po jawnej decyzji produktowej.
