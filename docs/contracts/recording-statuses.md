# Kontrakt statusów nagrania

Ten dokument opisuje docelowy wspólny kontrakt statusów nagrania dla rozszerzenia Chrome i backendu Meet2Note.

Indeks i zasady katalogu kontraktów: [README.md](README.md), [AGENTS.md](AGENTS.md).

Źródła kontekstu:

1. Issue rozszerzenia: [#17](https://github.com/pawel-walaszek/chrome-recording-transcription-extension/issues/17).
2. Kontrakt backendu: [`docs/contracts/recording-statuses.md`](https://github.com/pawel-walaszek/recording-backend/blob/codex/recording-status-contract/docs/contracts/recording-statuses.md).
3. Powiązany PR backendu: [recording-backend#33](https://github.com/pawel-walaszek/recording-backend/pull/33).

## Cel

Status nagrania ma znaczyć to samo w popupie rozszerzenia, lokalnej kolejce uploadu, API backendu i panelu Meet2Note.

Rozszerzenie nie powinno emitować ani pokazywać legacy statusu `pending`. Status `queued` używany wcześniej dla kolejki uploadu powinien zostać zastąpiony jawniejszym `upload_queued`.

## Statusy

| Status | Owner | Znaczenie |
|--------|-------|-----------|
| `recording` | Chrome extension | Trwa lokalne nagrywanie spotkania. Backend może jeszcze nie znać tej pozycji. |
| `finalizing` | Chrome extension | Użytkownik zatrzymał nagrywanie, a rozszerzenie finalizuje lokalne bloby i metadane przed uploadem. |
| `upload_queued` | Chrome extension | Nagranie jest gotowe do uploadu, ale upload czeka albo jest zaplanowany do retry. |
| `uploading` | Chrome extension | Rozszerzenie aktywnie wysyła assety nagrania do backendu. |
| `processing_queued` | Backend | Backend ma pliki i metadane, a przetwarzanie po stronie serwera czeka na start. |
| `processing` | Backend | Worker backendu aktywnie przetwarza nagranie. |
| `ready` | Backend | Przetworzone nagranie web-playable jest dostępne. |
| `failed` | Backend albo Chrome extension | Aktualny etap zakończył się błędem i wymaga retry, diagnostyki albo akcji użytkownika. |
| `canceled` | Chrome extension | Użytkownik celowo anulował nagrywanie albo upload. |
| `expired` | Backend | Backend wygasił niedokończone albo osierocone nagranie przejściowe. |

## Model przejść

Typowy udany przepływ:

```text
recording -> finalizing -> upload_queued -> uploading -> processing_queued -> processing -> ready
```

Przepływy błędów:

1. Każdy aktywny status może przejść do `failed`.
2. Celowe przerwanie przez użytkownika przechodzi do `canceled`.
3. Backendowy cleanup porzuconych pozycji przejściowych przechodzi do `expired`.

## Polityka legacy

1. Nowy kod rozszerzenia nie powinien emitować ani zapisywać `pending`.
2. Lokalne legacy dane ze statusem `pending` powinny być mapowane do najbliższego aktualnego statusu, zamiast utrzymywać `pending` w UI.
3. `queued` w kontekście lokalnej kolejki uploadu jest nazwą historyczną z implementacji #10 i powinno zostać zmapowane do `upload_queued`.
4. Po zakończonym uploadzie UI rozszerzenia musi umieć przyjąć z backendu `processing_queued`, a potem `processing`, `ready` albo `failed`.

## Status nagrania a status artefaktu

Status nagrania opisuje etap całego procesu. Statusy artefaktów, takich jak video, transkrypt albo podsumowanie, są osobne i używają prostszego modelu:

```text
missing -> processing -> ready
```

Rozszerzenie powinno renderować status nagrania, a nie próbować wyprowadzać go z gotowości pojedynczego artefaktu.
