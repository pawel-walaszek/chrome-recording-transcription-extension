# Kontrakt integracji Meet2Note

Ten dokument opisuje trwały kontrakt między rozszerzeniem Chrome i backendem Meet2Note.

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
3. Backend zwraca `recordingId`, `uploadToken` i `expiresAt`.
4. Główny asset `video_audio` jest wysyłany przez `PUT /api/upload/{recordingId}/video`.
5. Opcjonalny asset `microphone` jest wysyłany przez `PUT /api/upload/{recordingId}/microphone`, jeśli mikrofon jest dostępny.
6. Upload assetów używa `Content-Type: application/octet-stream`.
7. Upload assetów i `/complete` używają nagłówków `Authorization` oraz `X-Upload-Token`.
8. Rozszerzenie kończy upload przez `POST /api/upload/{recordingId}/complete`.
9. Body `/complete` zawiera tylko faktycznie wysłane assety.
10. `uploadToken`, pełnych URL-i z tokenami ani zawartości blobów nie wolno logować.

## Assety

1. `video_audio` oznacza obraz karty oraz audio karty.
2. `microphone` oznacza osobne surowe audio z wybranego mikrofonu.
3. Mikrofon nie powinien być domiksowywany do `video_audio` w docelowym formacie uploadu.
4. Jeśli mikrofon jest niedostępny, upload samego `video_audio` jest poprawnym zdegradowanym przepływem.
5. Rozszerzenie nie wykonuje normalizacji audio, transkodowania, transkrypcji ani integracji z zewnętrznymi usługami; to odpowiedzialność backendu.

## Błędy i autoryzacja

1. Jeśli `/init` nie powiedzie się, rozszerzenie nie wysyła assetów.
2. Jeśli upload assetu nie powiedzie się, rozszerzenie nie wywołuje `/complete`.
3. Błędy sieciowe i HTTP trafiają do istniejącej diagnostyki bez sekretów i bez zawartości nagrań.
4. `401` albo `403` oznacza konieczność ponownego połączenia z Meet2Note.
5. Po `401` albo `403` rozszerzenie czyści lokalny token, oznacza odpowiednią pozycję jako wymagającą reconnect i nie ponawia zwykłego uploadu bez końca.

## Uprawnienia Chrome

1. `https://meet2note.com/*` jest wymagane dla flow połączenia konta, wymiany kodu, listy nagrań i uploadu.
2. `http://localhost/*` oraz `http://127.0.0.1/*` są dozwolone tylko dla lokalnych testów integracyjnych.
3. Nie dodawaj szerszych uprawnień hosta typu `https://*/*`, jeśli wystarcza jawna lista hostów.

## Granice funkcjonalne

1. Upload do Meet2Note zastępuje automatyczne pobieranie lokalnego pliku `.webm`.
2. Przy błędzie uploadu rozszerzenie nie uruchamia automatycznego lokalnego downloadu jako fallbacku.
3. Ręczny eksport surowego pliku może wrócić tylko jako osobna funkcja po jawnej decyzji produktowej.
