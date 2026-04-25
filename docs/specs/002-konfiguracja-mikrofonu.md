# Specyfikacja: konfiguracja mikrofonu

## Podsumowanie

Celem jest zamiana jednorazowego przycisku `Enable Microphone` w pełną konfigurację mikrofonu. Użytkownik ma móc wrócić do ustawień, zobaczyć dostępne urządzenia wejściowe, wybrać konkretny mikrofon albo wrócić do mikrofonu domyślnego. Nagrywanie ma używać zapisanego wyboru, a gdy wybrane urządzenie nie jest dostępne, rozszerzenie ma bezpiecznie wrócić do domyślnego mikrofonu albo nagrywania bez mikrofonu.

Zmiana dotyczy tylko konfiguracji i użycia mikrofonu. Nie przywraca transkrypcji, nie dodaje backendu i nie zmienia sposobu nagrywania karty.

## Cel

1. Umożliwić zmianę mikrofonu po wcześniejszym udzieleniu uprawnienia.
2. Usunąć stan, w którym przycisk mikrofonu jest nieaktywny i nie pozwala wrócić do konfiguracji.
3. Zapamiętać wybrany mikrofon między sesjami rozszerzenia.
4. Użyć wybranego mikrofonu przy `Start Recording`.

## Zakres

1. W zakresie:
   a) Zmiana zachowania przycisku mikrofonu w `popup.html` / `src/popup.ts`.
   b) Rozbudowa `micsetup.html` / `src/micsetup.ts` o listę mikrofonów i zapis wyboru.
   c) Odczyt zapisanego wyboru w `src/offscreen.ts` podczas pobierania strumienia mikrofonu.
   d) Dodanie obsługi opcji mikrofonu domyślnego.
   e) Aktualizacja README, mapy systemu i runbooka smoke testu.
   f) Podbicie wersji rozszerzenia w `manifest.json` jako zmiana funkcjonalna.

2. Poza zakresem:
   a) Zmiana mechanizmu przechwytywania karty.
   b) Przywracanie transkrypcji albo napisów Google Meet.
   c) Wybór urządzenia audio wyjściowego.
   d) Zaawansowany mikser audio, poziomy głośności, suwak gain albo redukcja szumów poza obecnymi constraints.
   e) Publikacja do Chrome Web Store.

## Obecne zachowanie

1. `popup.html` ma przycisk `Enable Microphone`.
2. `src/popup.ts`:
   a) sprawdza stan uprawnienia mikrofonu przez Permissions API,
   b) po stanie `granted` ustawia etykietę `Microphone Enabled ✓`,
   c) wyłącza przycisk mikrofonu,
   d) przy `Start Recording` próbuje automatycznie przygotować mikrofon, jeśli uprawnienie nie jest nadane.

3. `micsetup.html` / `src/micsetup.ts`:
   a) pokazuje prostą stronę z przyciskiem `Enable Microphone`,
   b) wywołuje `navigator.mediaDevices.getUserMedia({ audio: true })`,
   c) nie pokazuje listy urządzeń,
   d) nie zapisuje wyboru mikrofonu.

4. `src/offscreen.ts`:
   a) `maybeGetMicStream()` wywołuje `getUserMedia()` bez `deviceId`,
   b) Chrome wybiera mikrofon domyślny albo ostatnio wybrany przez użytkownika/system,
   c) użytkownik nie ma w rozszerzeniu sposobu na zmianę tego wyboru.

## Proponowana zmiana

1. Popup
   a) Przycisk mikrofonu ma zawsze pozostać aktywny.
   b) Gdy uprawnienie nie jest nadane, etykieta zostaje `Enable Microphone`.
   c) Gdy uprawnienie jest nadane, etykieta zmienia się na `Microphone Settings`.
   d) Kliknięcie przycisku zawsze otwiera `micsetup.html`.
   e) Popup może pokazywać krótki status aktualnego wyboru, np. `Mic: Default` albo `Mic: iPhone Microphone`, jeśli da się go ustalić bez rozbudowy UI.

2. Strona konfiguracji mikrofonu
   a) Po wejściu na `micsetup.html` strona próbuje uzyskać uprawnienie mikrofonu, jeśli nie jest jeszcze nadane.
   b) Po uzyskaniu uprawnienia wywołuje `navigator.mediaDevices.enumerateDevices()`.
   c) Filtruje urządzenia `kind === "audioinput"`.
   d) Pokazuje wybór urządzenia w elemencie `select`.
   e) Dodaje opcję `Default microphone`, która oznacza brak wymuszonego `deviceId`.
   f) Zapisuje wybór w `chrome.storage.local`.
   g) Pozwala ponownie odświeżyć listę urządzeń.
   h) Pokazuje czytelny status zapisu i błędów uprawnień.

3. Format danych w `chrome.storage.local`
   a) `preferredMicDeviceId`: `string | null`
   b) `preferredMicLabel`: `string | null`

4. Użycie mikrofonu w offscreen
   a) `maybeGetMicStream()` odczytuje `preferredMicDeviceId` z `chrome.storage.local`.
   b) Jeśli `preferredMicDeviceId` istnieje, próbuje:

```ts
audio: {
  deviceId: { exact: preferredMicDeviceId },
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true
}
```

   c) Jeśli wybrane urządzenie nie jest dostępne albo `getUserMedia()` zwróci błąd `OverconstrainedError` / `NotFoundError`, rozszerzenie czyści zapisany `preferredMicDeviceId`, loguje przyczynę i próbuje mikrofonu domyślnego.
   d) Jeśli mikrofon domyślny też się nie uda, zachowuje obecne zachowanie: kontynuuje nagrywanie samej karty bez mikrofonu.
   e) Nie wolno przerwać nagrywania karty tylko dlatego, że mikrofon nie jest dostępny.

5. Start nagrywania
   a) `Start Recording` nie powinien po cichu zmieniać zapisanego mikrofonu.
   b) Jeśli uprawnienie mikrofonu nie jest nadane, obecna próba przygotowania mikrofonu może zostać zachowana jako fallback, ale preferowana ścieżka użytkownika to `Microphone Settings`.
   c) Jeśli użytkownik chce zmienić urządzenie, robi to jawnie przez stronę konfiguracji.

6. Dokumentacja
   a) README opisuje, że `Microphone Settings` służy do wyboru mikrofonu.
   b) Runbook smoke testu obejmuje wybór mikrofonu domyślnego i konkretnego urządzenia, jeśli na maszynie są co najmniej dwa wejścia.
   c) Mapa systemu opisuje, że `micsetup.html` zarządza zapisanym wyborem mikrofonu.

## Decyzje projektowe

1. Wybór mikrofonu zapisujemy w `chrome.storage.local`, nie w `chrome.storage.session`.
   a) Uzasadnienie: wybór urządzenia ma przetrwać zamknięcie popupu, restart service workera i kolejne sesje przeglądarki.

2. Opcja domyślna oznacza brak zapisanego `deviceId`.
   a) Uzasadnienie: system i Chrome mogą wtedy same obsłużyć zmianę urządzenia domyślnego.

3. Gdy zapisany mikrofon znika, rozszerzenie czyści wybór i wraca do domyślnego mikrofonu.
   a) Uzasadnienie: urządzenia takie jak iPhone, słuchawki Bluetooth albo mikrofony USB mogą znikać między sesjami.

4. UI pozostaje prosty i oparty o natywne kontrolki HTML.
   a) Uzasadnienie: obecny popup i `micsetup.html` są minimalne; ta zmiana nie wymaga frameworka ani nowego systemu komponentów.

5. Teksty UI mogą pozostać po angielsku.
   a) Uzasadnienie: istniejący UI rozszerzenia jest po angielsku, a zadanie dotyczy zachowania konfiguracji mikrofonu, nie lokalizacji interfejsu.

6. Wersję rozszerzenia należy podbić z `1.2.0` do `1.3.0`.
   a) Uzasadnienie: to nowa funkcja użytkowa, a nie bugfix ostatniej cyfry.

## Niejednoznaczności rozstrzygnięte w specyfikacji

1. Czy przycisk mikrofonu ma być aktywny po nadaniu uprawnienia?
   a) Tak, ma zawsze otwierać konfigurację.

2. Czy start nagrywania ma blokować, gdy wybrany mikrofon jest niedostępny?
   a) Nie, nagrywanie karty ma wystartować, a mikrofon ma przejść przez fallback.

3. Czy trzeba pytać użytkownika o sposób zapisu wyboru?
   a) Nie, `chrome.storage.local` wynika z architektury rozszerzenia i celu zapamiętywania wyboru.

4. Czy trzeba zmieniać uprawnienia Chrome?
   a) Nie zakładamy nowych uprawnień. Projekt ma już `storage`, a mikrofon jest obsługiwany przez `getUserMedia()` na stronie rozszerzenia/offscreen.

## Kryteria akceptacji

1. Po nadaniu uprawnienia mikrofonu przycisk w popupie nie jest wyłączony.
2. Kliknięcie przycisku mikrofonu otwiera stronę konfiguracji.
3. Strona konfiguracji pokazuje opcję `Default microphone`.
4. Strona konfiguracji pokazuje dostępne urządzenia `audioinput`, jeśli przeglądarka udostępnia ich etykiety po nadaniu uprawnienia.
5. Wybór konkretnego mikrofonu zapisuje się w `chrome.storage.local`.
6. Wybór `Default microphone` usuwa wymuszony `deviceId`.
7. Nagrywanie używa zapisanego mikrofonu, gdy jest dostępny.
8. Gdy zapisany mikrofon nie jest dostępny, nagrywanie nie kończy się błędem tylko z tego powodu.
9. Gdy mikrofon nie jest dostępny w ogóle, nagrywanie karty nadal działa bez domiksowania mikrofonu.
10. `make check` przechodzi.
11. `dist/manifest.json` ma wersję `1.3.0` po buildzie.

## Plan weryfikacji

1. Uruchomić:

```bash
make check
```

2. Załadować `dist/` w `chrome://extensions`.
3. Otworzyć popup i potwierdzić, że przycisk mikrofonu jest aktywny także po stanie `Microphone Enabled`.
4. Otworzyć stronę konfiguracji mikrofonu.
5. Nadać uprawnienie mikrofonu, jeśli Chrome o nie poprosi.
6. Wybrać `Default microphone`, zapisać i uruchomić krótkie nagranie.
7. Jeśli dostępne są co najmniej dwa mikrofony:
   a) wybrać konkretny mikrofon,
   b) zapisać,
   c) uruchomić nagranie,
   d) potwierdzić w logach offscreen, że użyto zapisanego urządzenia albo że fallback zadziałał.

8. Odłączyć wybrane urządzenie, jeśli to łatwo odtworzyć, i sprawdzić fallback do mikrofonu domyślnego albo nagrywania bez mikrofonu.
9. Sprawdzić, że `Stop & Download` nadal pobiera `.webm`.

## Ryzyka

1. Etykiety urządzeń mogą być puste przed nadaniem uprawnienia.
   a) Mitigacja: najpierw wywołać `getUserMedia({ audio: true })`, potem `enumerateDevices()`.

2. `deviceId` może zmienić się po wyczyszczeniu danych strony albo zmianie polityk prywatności przeglądarki.
   a) Mitigacja: fallback do domyślnego mikrofonu i czyszczenie nieaktualnego wyboru.

3. Wymuszenie `deviceId: { exact }` może powodować błąd, gdy urządzenie zniknie.
   a) Mitigacja: obsłużyć `OverconstrainedError` / `NotFoundError` i ponowić bez `deviceId`.

4. Auto-prime mikrofonu przy `Start Recording` może być mylące, jeśli użytkownik spodziewa się konfiguracji.
   a) Mitigacja: popup prowadzi do `Microphone Settings`, a start nagrywania nie zapisuje urządzenia samoczynnie.

5. Test ręczny może nie potwierdzić realnej zmiany mikrofonu, jeśli na maszynie jest tylko jedno wejście.
   a) Mitigacja: kryterium wyboru konkretnego urządzenia obowiązuje tylko, gdy dostępne są co najmniej dwa wejścia audio.
