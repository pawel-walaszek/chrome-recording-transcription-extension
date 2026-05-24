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
7. Backend Meet2Note ma być docelowym źródłem widoczności dla wszystkich pozycji, które rozszerzenie nagrywa, finalizuje, próbuje uploadować albo oznacza jako `failed`.

## Widoczność w backendzie

1. Backend powinien widzieć każdą pozycję znaną rozszerzeniu, także taką, której assety nigdy nie zostały w pełni wysłane.
2. Każdy `failed` musi mieć uzasadnienie widoczne w backendzie: etap błędu, komunikat, `failureReason`, liczba prób i ostatni znany czas retry, jeśli dotyczy.
3. Rozszerzenie nie powinno samodzielnie porzucać ani ukrywać pozycji tylko dlatego, że upload się nie udaje.
4. Użytkownik decyduje w backendowym widoku `/recordings`, kiedy pozycja ma zostać porzucona, usunięta albo oznaczona jako świadomie zakończona.
5. Automatyczny cleanup porzuconych pozycji nie jest częścią obecnego kontraktu; może wrócić wyłącznie jako osobna decyzja produktowa.
6. Do czasu pełnej implementacji synchronizacji stanów w backendzie popup może nadal scalać lokalne wpisy z listą backendową, ale nie jest to docelowe źródło prawdy.

## Lokalny spool

1. Chunks nagrań są zapisywane w IndexedDB podczas nagrywania.
2. `chrome.storage.local` przechowuje metadane historii, nie zawartość nagrań.
3. Lokalny spool nie jest obecnie czyszczony automatycznie po potwierdzonym globalnym `/complete`; automatyczne usuwanie może wrócić tylko jako osobna decyzja produktowa.
4. Po restarcie service workera zakończone pozycje uploadu powinny być odtwarzane z IndexedDB.
5. Aktywne, niefinalizowane nagranie utracone razem z offscreen może zostać oznaczone jako `failed` z metadaną `failureReason: "unrecoverable"`.
6. Kolejka uploadu trzyma w pamięci metadane pozycji, nie całe Bloby; assety są składane z IndexedDB dopiero na czas uploadu aktywnej pozycji.
7. Automatyka rozszerzenia nie powinna usuwać failed pozycji ani ich chunków jako decyzji produktowej o porzuceniu; decyzja o porzuceniu należy do użytkownika w backendzie.
8. Jeśli lokalne dane są fizycznie niedostępne albo uszkodzone, rozszerzenie może oznaczyć pozycję jako `failed`, ale powinno zsynchronizować ten fakt z backendem zamiast cicho usuwać pozycję z widoczności użytkownika.

## Limity

1. Lokalna historia nie usuwa automatycznie pozycji terminalnych tylko dlatego, że przekroczono limit liczby wpisów.
2. Popup pokazuje 5 najnowszych pozycji.
3. Pozycje nieterminalne i terminalne pozostają dostępne dla synchronizacji z backendem, dopóki istnieją w lokalnej historii albo spoolu.
4. Kolejka/spool nie mają arbitralnego limitu liczby pozycji ani stałego limitu łącznego rozmiaru po stronie rozszerzenia.
5. Przed startem nagrania rozszerzenie sprawdza dostępność IndexedDB i szacowane użycie storage przeglądarki; jeśli przeglądarka raportuje prawie pełny storage, start ma zakończyć się czytelnym błędem lokalnym.
6. Jeśli zapis chunków do IndexedDB nie powiedzie się w trakcie nagrywania, pozycja przechodzi w czytelny błąd lokalny, zamiast cicho znikać.

## Retry i błędy

1. Retry dotyczy konkretnej pozycji kolejki, nie globalnego stanu uploadu.
2. Zwykły błąd sieciowy albo HTTP przełącza pozycję w retry z kolejną próbą po około 15 sekundach.
3. Każda kolejna pełna próba uploadu zaczyna się od aktualnej sesji `/api/upload/init`.
4. `401` albo `403` przełącza pozycję w stan wymagający ponownego połączenia z Meet2Note i zatrzymuje zwykły retry.
5. Po reconnect pozycje wymagające autoryzacji mogą wrócić do kolejki, jeśli lokalny spool nadal zawiera ich chunks.
6. Jeśli chunks zostały utracone albo storage jest uszkodzony, pozycja pozostaje w stanie błędu nieodwracalnego.
7. Błędy lokalne, błędy uploadu i pauzy autoryzacyjne powinny być raportowane do backendu jako stan tej samej pozycji, a nie wyłącznie jako lokalna diagnostyka.
8. `failed` nie oznacza automatycznego porzucenia; oznacza stan wymagający diagnostyki, retry, reconnect albo decyzji użytkownika.

## Historia i popup

1. Popup scala lokalną historię kolejki z ostatnimi nagraniami zwróconymi przez backend, jeśli konto jest połączone.
2. Lista `Recent recordings` ma być widoczna także przy pustej historii, żeby użytkownik widział miejsce statusów kolejki.
3. Pozycja historii powinna zawierać co najmniej tytuł, status, czas rozpoczęcia, czas trwania, rozmiary assetów, liczbę prób, `backendRecordingId`, listę assetów i ewentualny błąd.
4. Długie tytuły w popupie powinny być skracane elipsą.
5. Po udanym uploadzie lokalny wpis powinien zostać scalony z backendowym `recordingId` i późniejszym statusem przetwarzania.
6. Gdy backend zwraca listę nagrań, popup traktuje ją jako źródło kolejności i pozycji dla nagrań znanych backendowi.
7. Lokalne wpisy bez `backendRecordingId` są stanem przejściowym i powinny zostać zsynchronizowane do backendu, jeśli tylko rozszerzenie ma ważne połączenie z Meet2Note.
8. Lokalne `failed` bez `backendRecordingId` nadal reprezentują próbę nagrania albo uploadu; docelowo mają być widoczne w backendzie z uzasadnieniem błędu.
9. Snapshot lokalnej kolejki z offscreen nie może zastępować backendowej listy nagrań; background scala go z cachem backendu.
10. Popup może używać lokalnego cache UI dla stanu połączenia i ostatniej listy nagrań, żeby pierwszy render nie pokazywał fałszywego stanu rozłączenia ani pustej listy przed asynchroniczną synchronizacją.
11. Popup pokazuje dla pozycji nagrania tylko tytuł, status oraz jedną linię czasu. Jeśli backend zwraca `displayTimeline`, popup renderuje tę wartość bez własnego formatowania; fallback lokalny istnieje tylko dla wpisów, których backend jeszcze nie zna albo dla starszej wersji API.

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
2. Lokalna kolejka używa `upload_queued` dla pozycji gotowych do uploadu, także wtedy, gdy pozycja czeka na zaplanowane retry.
3. Po udanym uploadzie lokalny wpis przechodzi do `processing_queued`, dopóki backend nie zwróci dokładniejszego statusu.
4. Błędy lokalne i konieczność reconnect są opisywane statusem `failed` oraz metadanym `failureReason`, a nie osobnymi statusami spoza kontraktu.
5. Legacy statusy `queued`, `retrying`, `uploaded`, `pending`, `auth_required`, `local_error` i `failed_unrecoverable` muszą być mapowane do aktualnego kontraktu przy odczycie lokalnej historii.
6. Popup nie powinien tłumaczyć `processing_queued` na `uploaded`; statusy backendowe mają być prezentowane kanonicznie, żeby nie rozjeżdżały się z widokiem webowym Meet2Note.
