# Kontrakt mikrofonu

Ten dokument opisuje trwałe zasady konfiguracji i użycia mikrofonu w rozszerzeniu.

Indeks i zasady katalogu kontraktów: [README.md](README.md), [AGENTS.md](AGENTS.md).

## UI i konfiguracja

1. Popup prowadzi użytkownika do strony `micsetup.html`.
2. Przycisk konfiguracji mikrofonu pozostaje aktywny także po nadaniu uprawnienia.
3. Gdy uprawnienie nie jest nadane, etykieta może wskazywać pierwsze włączenie mikrofonu.
4. Gdy uprawnienie jest nadane, etykieta powinna prowadzić do ustawień mikrofonu.
5. Teksty UI rozszerzenia pozostają po angielsku, chyba że zadanie dotyczy lokalizacji.

## Przechowywanie wyboru

1. Wybór mikrofonu jest przechowywany w `chrome.storage.local`.
2. Klucze storage:
   a) `preferredMicDeviceId`,
   b) `preferredMicLabel`.
3. Wartość `null` dla `preferredMicDeviceId` oznacza mikrofon domyślny.
4. Opcja `Default microphone` nie wymusza `deviceId`; Chrome i system mogą wtedy same obsłużyć zmianę urządzenia domyślnego.

## Lista urządzeń

1. Strona konfiguracji może poprosić o `getUserMedia({ audio: true })`, żeby Chrome udostępnił etykiety urządzeń.
2. Lista urządzeń mikrofonu pochodzi z `navigator.mediaDevices.enumerateDevices()`.
3. Do wyboru trafiają tylko urządzenia `kind === "audioinput"`.
4. Pseudo-urządzenia przeglądarki nie powinny być zapisywane jako konkretny mikrofon, jeśli nie reprezentują realnego wejścia.
5. Użytkownik powinien mieć możliwość powrotu do `Default microphone`.

## Użycie w nagrywaniu

1. Offscreen odczytuje preferencje mikrofonu przed startem nagrywania.
2. Jeśli `preferredMicDeviceId` istnieje, pierwsza próba `getUserMedia()` używa `deviceId: { exact: preferredMicDeviceId }`.
3. Constraints mikrofonu powinny zawierać `echoCancellation`, `noiseSuppression` i `autoGainControl`, o ile obecny kod tego używa.
4. `Start Recording` nie powinien po cichu zmieniać zapisanego mikrofonu.
5. Zmiana urządzenia wejściowego jest jawną akcją użytkownika na stronie konfiguracji.

## Fallbacki

1. Brak mikrofonu nie może przerywać nagrywania karty, jeśli przechwytywanie karty działa.
2. Jeśli zapisany mikrofon jest niedostępny, rozszerzenie czyści zapisany wybór i próbuje mikrofonu domyślnego.
3. Jeśli mikrofon domyślny też jest niedostępny, nagranie kontynuuje się bez assetu mikrofonu.
4. Typowe błędy niedostępnego zapisanego urządzenia, np. `OverconstrainedError` i `NotFoundError`, powinny prowadzić do fallbacku zamiast do błędu całego nagrania.
5. Fallback mikrofonu powinien być logowany diagnostycznie bez danych prywatnych.
