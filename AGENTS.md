# Prosjektinstruksjoner

## Mål og omfang

Bygg et Snake-spill som kjører i nettleseren. Første iterasjon er for én lokal spiller, men domenemodellen skal kunne utvides med flere spillere senere uten at spillkjernen må skrives om.

Følg den godkjente designspesifikasjonen i `docs/superpowers/specs/2026-09-09-browser-snake-design.md`. Ikke legg til nettverk, lobby, kontoer, poengtavle, lyd eller andre utsatte funksjoner uten en uttrykkelig bestilling.

## Teknologi

- Bruk TypeScript og Vite.
- Bruk Vitest til enhets- og integrasjonstester.
- Tegn selve spillet med Canvas 2D.
- Ikke innfør React eller et annet UI-rammeverk for denne iterasjonen.

## Arkitektur

- Hold spillkjernen plattformuavhengig. Den skal ikke kjenne DOM, Canvas, tastatur, faktisk klokke eller globale tilfeldighetsfunksjoner.
- Uttrykk spillreglene som rene, deterministiske tilstandsoverganger så langt det er praktisk.
- Injiser tilfeldighetskilden som brukes til matplassering.
- Skill mellom spillkjerne, nettleser-/inputadapter og Canvas-renderer.
- La rendereren kun lese tilstand og tegne; den skal aldri avgjøre spillregler.
- Representer spillere med stabile ID-er og spilleradresserte kommandoer, selv om MVP-en bare oppretter én spiller.
- Ikke design en nettverksprotokoll eller bestem regler for kollisjoner mellom flere slanger ennå.

## Spillregler

- Støtt piltaster og WASD.
- Slangen skal gå gjennom kanten og komme inn på motsatt side på begge akser.
- Avvis direkte vending på 180 grader.
- Behandle flere raske retningskommandoer i rekkefølge med en begrenset inputkø.
- Mat skal øke slangens lengde og poengsum.
- Plasser ny mat kun på en ledig rute.
- Øk hastigheten trinnvis etter spist mat, opp til en konfigurert maksimumshastighet.
- Egenkollisjon avslutter runden.
- Et fullt brett gir seier.
- Støtt pause, fortsettelse og omstart.
- Bruk faste simuleringstidssteg, uavhengig av `requestAnimationFrame`, og begrens innhentingssteg etter lange pauser.

## Testing og arbeidsform

- Enhetstester for spillogikken er obligatoriske.
- Bruk testdrevet utvikling: skriv en sviktende test, bekreft feilen, implementer minst mulig, og bekreft at testen består.
- Test minst flytting, wrap-around, retningsvalidering, inputkø, vekst, poeng, hastighet, matplassering, egenkollisjon, pause, omstart, tap, seier og isolasjon mellom spillerobjekter.
- Hold testene uavhengige av en ekte nettleser og ekte tilfeldighet.
- Legg til små integrasjonstester for tastaturmapping, oppstart og manglende Canvas-kontekst.
- Kjør relevante tester etter hver avgrensede endring og hele testpakken før arbeidet erklæres ferdig.
- Foretrekk små, fokuserte filer med ett tydelig ansvar og små commits som hver etterlater prosjektet i en fungerende tilstand.

## Brukerflate og robusthet

- Vis Canvas-spillflate, poengsum, rundestatus, korte kontrollinstruksjoner og en tydelig kontroll for ny runde.
- Gjør Canvas responsivt uten å endre det logiske rutenettet.
- Hindre standard scrolling for spilltaster når spillet har fokus.
- Vis en forståelig feil dersom Canvas 2D ikke er tilgjengelig.
