# Kontrakt kolejki uploadu i historii nagrań

Ten dokument opisuje trwałe zasady lokalnej kolejki uploadu, spoolu i listy ostatnich nagrań w popupie.

Indeks i zasady katalogu kontraktów: [README.md](README.md), [AGENTS.md](AGENTS.md).

## Odpowiedzialności

1. Aktywne nagrywanie pozostaje pojedyncze; rozszerzenie nagrywa jedną kartę naraz.
2. Upload zakończonych nagrań nie blokuje rozpoczęcia kolejnego nagrania.
3. Uploady są wykonywane sekwencyjnie, po jednej aktywnej pozycji naraz.
4. Offscreen odpowiada za finalizację nagrania, lokalny spool, kolejkę uploadu i wysyłkę assetów.
5. Background koordynuje lifecycle rozszerzenia, stan nagrywania, komunikację z popupem i operacje Chrome storage.
6. Popup pokazuje osobno stan aktywnego nagrywania oraz listę ostatnich nagrań.

## Lokalny spool

1. Chunks nagrań są zapisywane w IndexedDB podczas nagrywania.
2. `chrome.storage.local` przechowuje metadane historii, nie zawartość nagrań.
3. Lokalny spool jest czyszczony dopiero po potwierdzonym uploadzie albo po przejściu pozycji w terminalny stan lokalnego błędu.
4. Po restarcie service workera zakończone pozycje uploadu powinny być odtwarzane z IndexedDB.
5. Aktywne, niefinalizowane nagranie utracone razem z offscreen może zostać oznaczone jako `failed_unrecoverable`.

## Limity

1. Lokalna historia trzyma domyślnie 10 ostatnich pozycji terminalnych.
2. Popup pokazuje 5 najnowszych pozycji.
3. Pozycje nieterminalne nie powinny być usuwane przez limit historii, dopóki mają szansę na upload.
4. Kolejka/spool mają twarde limity ochronne: 3 pozycje i 2 GiB łącznego rozmiaru.
5. Po przekroczeniu limitu nowa pozycja powinna przejść w czytelny błąd lokalny, zamiast cicho znikać.

## Retry i błędy

1. Retry dotyczy konkretnej pozycji kolejki, nie globalnego stanu uploadu.
2. Zwykły błąd sieciowy albo HTTP przełącza pozycję w retry z kolejną próbą po około 15 sekundach.
3. Każda kolejna pełna próba uploadu zaczyna się od aktualnej sesji `/api/upload/init`.
4. `401` albo `403` przełącza pozycję w stan wymagający ponownego połączenia z Meet2Note i zatrzymuje zwykły retry.
5. Po reconnect pozycje wymagające autoryzacji mogą wrócić do kolejki, jeśli lokalny spool nadal zawiera ich chunks.
6. Jeśli chunks zostały utracone albo storage jest uszkodzony, pozycja pozostaje w stanie błędu nieodwracalnego.

## Historia i popup

1. Popup scala lokalną historię kolejki z ostatnimi nagraniami zwróconymi przez backend, jeśli konto jest połączone.
2. Lista `Recent recordings` ma być widoczna także przy pustej historii, żeby użytkownik widział miejsce statusów kolejki.
3. Pozycja historii powinna zawierać co najmniej tytuł, status, czas rozpoczęcia, czas trwania, rozmiary assetów, liczbę prób, `backendRecordingId`, listę assetów i ewentualny błąd.
4. Długie tytuły w popupie powinny być skracane elipsą.
5. Po udanym uploadzie lokalny wpis powinien zostać scalony z backendowym `recordingId` i późniejszym statusem przetwarzania.
6. Backendowa lista nagrań i lokalna lista popupu powinny dążyć do spójności dla ostatnich 5 pozycji; zanim backend zna aktywne nagranie, lokalna historia pozostaje źródłem stanów przejściowych.

## Komunikacja

1. Offscreen publikuje snapshot kolejki komunikatem `UPLOAD_QUEUE_STATE`.
2. Odpowiedź statusowa dla popupu powinna zawierać:
   a) obecny stan nagrywania,
   b) `recordingStartedAt`,
   c) `starting` i `stopping`,
   d) `recentRecordings`.
3. Background po zmianie tokenu powinien obudzić offscreen i spróbować wznowić uploady czekające na autoryzację.

## Statusy

1. Docelowy kontrakt statusów jest opisany w [kontrakcie statusów nagrania](recording-statuses.md).
2. Obecne lokalne statusy historyczne, takie jak `queued`, `retrying`, `uploaded`, `auth_required`, `local_error` i `failed_unrecoverable`, są detalem implementacyjnym do czasu pełnej migracji #17.
3. Nowy kod powinien zmierzać do nazw z kontraktu statusów, w szczególności `upload_queued` zamiast ogólnego `queued` i `processing_queued` zamiast legacy `pending`.
