# Scripts

Skrypty pomocnicze dla lokalnych przepływów pracy projektu. Domyślne punkty wejścia do builda i walidacji to targety Make oparte o Docker Compose.

## Dostępne skrypty

1. `smoke-test.sh` - uruchamia lokalną komendę walidacyjną używaną przed ręcznym testowaniem rozszerzenia Chrome.
2. `package-extension.sh` - pakuje aktualne `dist/` do `release/meet2note-chrome-extension-vX.Y.Z.zip` i pilnuje zgodności wersji z `manifest.json`.

Do codziennej walidacji preferuj `make check`. Uruchamiaj skrypty bezpośrednio tylko wtedy, gdy wskazuje na nie target Make albo gdy debugujesz sam helper.

Uruchamiaj skrypty z głównego katalogu repozytorium.
