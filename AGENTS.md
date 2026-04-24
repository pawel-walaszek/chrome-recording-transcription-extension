# AGENTS

Ten plik definiuje zasady dla agentow AI i automatyzacji pracujacych w tym repozytorium.

## Jezyk i zakres

- Z czlowiekiem komunikuj sie po polsku, chyba ze poprosi inaczej.
- Publiczny `README.md` i teksty widoczne dla uzytkownikow rozszerzenia utrzymuj po angielsku, zgodnie z obecnym stylem projektu.
- Wprowadzaj zmiany minimalne, zgodne z celem zadania i istniejaca struktura repo.
- Nie cofaj ani nie nadpisuj recznych zmian czlowieka bez wyraznej zgody.
- Przy starcie nowego kontekstu najpierw sprawdz `docs/followups.md`, jesli plik istnieje.

## Format odpowiedzi

- W wypunktowaniach stosuj numeracje glownych punktow jako `1.`, `2.`, `3.`.
- Punktory drugiego poziomu zapisuj jako `a)`, `b)`, `c)`.
- Punktory trzeciego poziomu zapisuj jako liste z kropkami.

## Technologia projektu

- Projekt jest rozszerzeniem Chrome Manifest V3 do Google Meet.
- Kod zrodlowy jest w `src/` i kompiluje sie przez webpack + TypeScript.
- Build trafia do `dist/`; nie edytuj recznie plikow wygenerowanych w `dist/`.
- Entry pointy webpacka sa zdefiniowane w `webpack.config.js`; pliki HTML i `manifest.json` sa kopiowane do `dist/`.
- Uprawnienia Chrome i `host_permissions` zmieniaj tylko wtedy, gdy wymaga tego funkcjonalnosc, i opisz powod w podsumowaniu.

## Weryfikacja

- Po zmianach w kodzie lub konfiguracji uruchom `npm run check`.
- Dla zmian dotykajacych przeplywow przegladarkowych wykonaj tez smoke test z `docs/runbooks/002-smoke-test-po-zmianach.md`.
- Jesli nie da sie uruchomic walidacji, podaj konkretny powod i zakres ryzyka.

## Dokumentacja

- Pliki `AGENTS.md` sa dla agentow i automatyzacji.
- Pliki `README.md` sa dla czlowieka.
- Dokumentacje techniczna trzymaj w `docs/`; indeks i zasady dla tego katalogu sa w `docs/AGENTS.md`.
- Specyfikacje wiekszych zmian zapisuj w `docs/specs/` przed implementacja, gdy zadanie nie miesci sie w prostej poprawce.
- Runbooki trzymaj w `docs/runbooks/` tylko dla powtarzalnych procedur.
- Unikaj semantycznych duplikatow miedzy `AGENTS.md`, `README.md` i dokumentacja.

## GitHub i proces pracy

- Glowne repozytorium ustalaj z `git remote -v`.
- Domyslny hosting to GitHub.
- Jesli dla operacji istnieje odpowiedni serwer MCP, uzyj go jako pierwszej sciezki pozyskania danych lub wykonania operacji.
- Commit, push i tworzenie Pull Request wykonuj tylko po wyraznej zgodzie czlowieka.
- PR powinien zawierac zakres, sposob weryfikacji, ryzyka oraz informacje o zmianach w uprawnieniach Chrome, jesli takie wystapily.

## Chrome Extension

- Po `npm run build` testuj przez zaladowanie katalogu `dist/` w `chrome://extensions`.
- Po zmianach w `manifest.json`, `background.ts`, `offscreen.ts` albo plikach HTML przeladuj rozszerzenie w `chrome://extensions`.
- Po zmianach w `scrapingScript.ts` odswiez aktywna karte Google Meet.
- Nie dodawaj zewnetrznych uslug ani przesylania nagran/transkrypcji poza przegladarke bez jednoznacznej decyzji czlowieka.
