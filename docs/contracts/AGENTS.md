# AGENTS dla `docs/contracts/`

Ten katalog zawiera trwale zasady projektu i kontrakty integracyjne obowiazujace po zakonczeniu prac implementacyjnych.

## Zasady

- Traktuj pliki w tym katalogu jako zrodla prawdy dla stabilnych decyzji projektowych, a nie jako robocze plany implementacji.
- Nie kopiuj tutaj calej historii specyfikacji, kryteriow akceptacji ani planow weryfikacji; zostaw tylko ustalenia, ktore maja obowiazywac dalej.
- Gdy zakonczona specyfikacja z `docs/specs/` zawiera trwale ustalenia, przenies je do logicznego pliku kontraktu i usun nieaktualna specyfikacje.
- Przy zmianach cross-repo linkuj odpowiednie issue, PR albo dokument backendu, ale opisuj lokalnie tylko kontrakt potrzebny tej wtyczce.
- Unikaj semantycznych duplikatow miedzy kontraktami; jesli temat jest juz opisany w innym pliku, linkuj go zamiast powtarzac.

## Indeks

- `README.md` - indeks kontraktow i wyjasnienie roli katalogu.
- `build-and-validation.md` - lokalny build, walidacja, pakietowanie i konfiguracja builda.
- `meet2note-upload.md` - polaczenie konta, upload assetow, uprawnienia i granice odpowiedzialnosci backendu.
- `microphone.md` - konfiguracja urzadzenia wejsciowego, zapis preferencji i fallbacki.
- `recording-statuses.md` - wspolny kontrakt statusow rozszerzenia i backendu.
- `upload-queue-and-history.md` - lokalny spool, retry, limity i lista ostatnich nagran.
