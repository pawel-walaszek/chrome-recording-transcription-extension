# Cel

Krótko opisz, co się zmienia i dlaczego.

## Zakres

1. 
2. 

## Weryfikacja

1. `make check`
2. Ręczny smoke test rozszerzenia Chrome, jeśli zmieniło się zachowanie w przeglądarce:
   a) załaduj `dist/` w `chrome://extensions`
   b) sprawdź start/stop nagrywania, jeśli zmienił się kod przechwytywania albo offscreen

## Wpływ na rozszerzenie Chrome

- [ ] Uprawnienia w `manifest.json` bez zmian.
- [ ] Jeśli uprawnienia się zmieniły, powód jest wyjaśniony w tym PR.
- [ ] Wygenerowane pliki `dist/` nie są commitowane.

## Checklist

- [ ] Zmiana jest ograniczona do opisanego zakresu.
- [ ] Dokumentacja została zaktualizowana, jeśli było to potrzebne.
- [ ] Nie dodano sekretów, nagrań ani lokalnych artefaktów.
