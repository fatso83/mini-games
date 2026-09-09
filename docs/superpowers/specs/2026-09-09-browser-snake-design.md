# Nettleserbasert Snake – designspesifikasjon

## Mål

Bygg første versjon av et enspiller-Snake-spill som kjører i nettleseren og tegnes med Canvas 2D. Spillogikken skal være grundig enhetstestet og organisert slik at flere spillere kan innføres senere uten å skrive om kjernen.

## Avgrensning

Første versjon inneholder én lokal spiller, tastaturstyring, poeng, økende hastighet, pause, omstart, tap og seier. Slangen kommer inn på motsatt side når den passerer en brettkant.

Første versjon inneholder ikke nettverkskode, lobby, kontoer, vedvarende poengtavle, lydeffekter, berøringskontroller eller en generell spillmotor. Flerspillerstøtte betyr her at domenemodellen og kommandoformatet ikke låses til nøyaktig én spiller.

## Teknologistakk

- TypeScript
- Vite
- Vitest
- Canvas 2D
- Nettleserens `requestAnimationFrame` og tastatur-API-er

Det brukes ikke et UI-rammeverk. Grensesnittet er lite, og direkte DOM- og Canvas-bruk holder avhengigheter og arkitektur enkle.

## Arkitektur

Systemet deles i tre lag med énveis avhengigheter:

1. **Spillkjerne:** Plattformuavhengig TypeScript som eier regler og tilstand. Kjernen kjenner ikke DOM, Canvas, tastatur, faktisk klokke eller globale tilfeldighetsfunksjoner.
2. **Nettleseradapter:** Leser tastaturkommandoer, driver den faste simuleringsløkken og sender kommandoer til spillkjernen.
3. **Canvas-renderer:** Tegner et øyeblikksbilde av spilltilstanden, men endrer aldri regler eller tilstand.

Spillkjernen uttrykkes som rene tilstandsoverganger så langt det er praktisk. Et spillsteg mottar gjeldende tilstand og nødvendige kommandoer og returnerer neste tilstand. Tilfeldig matplassering leveres gjennom en injisert avhengighet, slik at testen kan styre utfallet.

## Domenemodell

En samlet, validert spillkonfigurasjon definerer brettstørrelse, startkropp og -retning, grunnintervall, hastighetstrinn, minimumsintervall, poeng per matbit og inputkøens kapasitet. Produksjonen bruker ett standardsett, mens testene kan opprette små, målrettede brett.

Spilltilstanden inneholder:

- Brettets bredde og høyde målt i logiske ruter
- En samling spillere indeksert med stabil spiller-ID
- Én aktiv matposisjon i første versjon
- Rundestatus: klar, kjører, pauset, tapt eller vunnet
- Gjeldende simuleringsintervall og grenser for hastighetsøkning

Hver spiller inneholder:

- Stabil ID
- Slangens ordnede kroppsposisjoner, med hodet først
- Gjeldende retning
- En begrenset kø av godkjente retningskommandoer
- Poengsum
- Spillerstatus

MVP-en oppretter bare én spiller. Samlingsmodellen og kommandoer adressert med spiller-ID bevarer en naturlig overgang til flere lokale eller nettverkstilkoblede spillere senere. Det bygges ingen abstrakt nettverksprotokoll før den trengs.

## Spillregler

- En ny runde starter med én slange, én matbit, null poeng og grunnfart.
- Etter opprettelse står runden i `klar` uten å bevege seg. Første gyldige retningskommando eller mellomrom starter runden. Det første simuleringssteget skjer først når ett helt spillintervall har gått etter starten.
- Spilleren styrer med piltaster eller WASD.
- Hvert fast spillsteg flytter slangens hode én rute i gjeldende retning.
- Koordinater normaliseres på begge akser. Et hode som går utenfor brettet, kommer inn på motsatt side.
- En kommando som ville snu slangen direkte 180 grader, avvises.
- Inputkøen har kapasitet til to retningskommandoer per spiller. Når køen er full, ignoreres nye kommandoer fram til et spillsteg har frigjort plass. Nøyaktig én kommando tas fra køen og anvendes før hvert spillsteg. Hver ny kommando valideres mot den sist kølagte retningen, eller gjeldende retning når køen er tom. Dermed kan spilleren planlegge to lovlige vendinger, men aldri komprimere flere vendinger til én bevegelse.
- Når hodet treffer mat, beholdes halen slik at slangen vokser med én rute, poengsummen økes, og en ny matbit plasseres på en ledig rute.
- Farten øker trinnvis etter spist mat til et definert maksimum. Konkrete konstanter velges i implementasjonen og samles i spillkonfigurasjonen.
- Når slangen ikke spiser, fjernes halen før egenkollisjon avgjøres. Det er derfor lovlig å flytte inn i ruten halen forlater i samme steg. Når slangen spiser, beholdes halen og hele den eksisterende kroppen teller ved kollisjon.
- Når ingen ledig rute finnes etter at mat er spist, avsluttes runden som vunnet.
- Mellomrom starter en klar runde og veksler mellom pause og fortsettelse mens runden er aktiv. Akkumulert tid nullstilles ved pause og fortsettelse, slik at fortsettelse ikke utløser umiddelbare innhentingssteg.
- Knappen «Ny runde» kan brukes når som helst og tilbakestiller spillet til `klar`. Etter tap eller seier kan Enter gjøre det samme.

Senere flerspillerregler, blant annet kollisjoner mellom slanger, er uttrykkelig utsatt. Domenemodellen skal ikke late som slike regler allerede er bestemt.

## Tid og dataflyt

Nettleseren tegner via `requestAnimationFrame`, men simulerer med faste tidssteg. En akkumulator sammenligner forløpt tid med intervallet i spilltilstanden og kan utføre flere faste steg før neste tegning.

Antall innhentingssteg per frame begrenses. Hvis fanen har vært i bakgrunnen eller maskinen stopper midlertidig, forkastes overdreven akkumulert tid slik at spillet ikke utfører en lang serie usynlige bevegelser.

Dataflyten er:

1. Tastaturhendelser oversettes til spilleradresserte kommandoer.
2. Kommandoene valideres og legges i spillerens inputkø.
3. Den faste løkken ber spillkjernen beregne neste tilstand.
4. Rendereren mottar siste tilstand og tegner den.
5. DOM-elementer for poeng og rundestatus oppdateres fra samme tilstand.

Denne modellen gjør at samme starttilstand og kommandosekvens senere kan simuleres likt på flere klienter, forutsatt samme tilfeldige input. Full deterministisk nettverkssynkronisering er ikke et MVP-krav.

## Presentasjon og kontroller

Siden viser:

- En responsiv Canvas-spillflate med fast logisk rutenett
- Gjeldende poengsum
- Rundestatus
- Korte instruksjoner for piltaster/WASD og pause
- En tydelig knapp for ny runde

Canvas tilpasses tilgjengelig visuell størrelse og enhetens pikselforhold, mens det logiske rutenettet forblir uendret. Rendereren beregner rutestørrelse og sentrerer brettet ved behov. Hvis Canvas 2D ikke er tilgjengelig, erstattes spillflaten med en forståelig feilmelding.

## Robusthet

- Tastaturadapteren hindrer standard scrolling for spilltaster når spillet har fokus.
- Input ignoreres når kommandoen ikke er gyldig i gjeldende rundestatus.
- Matgeneratoren velger bare blant eksplisitt beregnede ledige ruter og kan derfor ikke havne på slangen.
- Uventet lang frametid kan ikke utløse ubegrenset arbeid.
- Endring av vindusstørrelse påvirker bare rendering, ikke spilltilstanden.
- Oppstartsfeil rapporteres synlig i grensesnittet og i utviklerkonsollen.

## Teststrategi

Vitest tester spillkjernen uten DOM eller Canvas. Testene skal dekke:

- Flytting i alle retninger
- Wrap-around ved venstre, høyre, øvre og nedre kant
- Avvisning av direkte 180-graders vending
- Korrekt behandling av flere raske retningskommandoer
- Vekst, poengøkning og matfornyelse
- Trinnvis hastighetsøkning og maksimal hastighet
- Matplassering utelukkende på ledige ruter
- Kollisjon med egen kropp
- Pause, fortsettelse, omstart, tap og seier
- At spilleradresserte oppdateringer ikke utilsiktet endrer en annen spiller i en kunstig tilstand med flere spillere
- Relevante grenseverdier, inkludert nesten fullt og helt fullt brett

Testene bruker arrangerte tilstander og en kontrollert tilfeldig kilde. De skal hevde observerbar oppførsel framfor interne implementasjonsdetaljer.

Et lite integrasjonstestsett i et DOM-lignende testmiljø verifiserer at tastaturinput oversettes korrekt, at spillet starter, og at manglende Canvas-kontekst håndteres. Visuell pikseltesting og full ende-til-ende-test er ikke påkrevd i første iterasjon.

## Akseptansekriterier

- Spillet kan startes lokalt og spilles i en moderne nettleser.
- All grafikk i selve spillet tegnes med Canvas 2D.
- Slangen styres med piltaster og WASD og kan ikke snu direkte inn i seg selv.
- Slangen går gjennom alle brettkanter og kommer inn på motsatt side.
- Mat øker lengde og poeng, og farten øker til et maksimum.
- Egenkollisjon avslutter runden; fullt brett gir seier.
- Pause og omstart fungerer.
- En ny runde står stille fram til første retningskommando eller mellomrom. Mellomrom styrer deretter pause og fortsettelse, mens Enter kan opprette en ny runde etter tap eller seier.
- Spillreglene er uavhengige av nettleser-API-er og dekkes av enhetstester.
- Testpakken kjører uten nettleser og består.
- Kjernen representerer spillere med stabile ID-er og kan behandle spilleradresserte kommandoer, uten å implementere flerspillernettverk.
