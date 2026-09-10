# Browser Snake Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bygg et spillbart enspiller-Snake i nettleseren med Canvas 2D, en deterministisk og enhetstestet TypeScript-kjerne, wrap-around-kanter og arkitektur som kan utvides med flere spillere.

**Architecture:** En ren spillkjerne eier konfigurasjon, spillertilstand, kommandoer og faste tilstandsoverganger. Et separat nettleserlag mapper tastatur og klokke til kjernen, mens en Canvas-renderer kun leser tilstand. Alle produksjonsfunksjoner som avgjør spillregler utvikles test-først; tilfeldighet og tid injiseres ved grensene.

**Tech Stack:** TypeScript, Vite, Vitest, jsdom, Canvas 2D, CSS

---

## Filkart

- `package.json` — skript og utviklingsavhengigheter.
- `tsconfig.json` — streng TypeScript-konfigurasjon for app og tester.
- `vite.config.ts` — Vite- og Vitest-konfigurasjon med jsdom.
- `index.html` — tilgjengelig applikasjonsskall og inngangspunkt.
- `src/game/types.ts` — domenetyper uten nettleseravhengigheter.
- `src/game/config.ts` — standardkonfigurasjon og validering.
- `src/game/food.ts` — deterministisk beregning og valg av ledig matrute.
- `src/game/create-game.ts` — opprettelse og omstart av en gyldig runde.
- `src/game/commands.ts` — spilleradresserte retninger og globale rundekommandoer.
- `src/game/step-game.ts` — ett fast simuleringssteg: bevegelse, wrap, mat, fart, egenkollisjon og seier.
- `src/browser/input.ts` — tastaturmapping og fokusavgrenset eventbinding.
- `src/browser/fixed-step-loop.ts` — `requestAnimationFrame`-adapter med akkumulator og innhentingsgrense.
- `src/browser/canvas-renderer.ts` — HiDPI-responsiv tegning uten spillregler.
- `src/main.ts` — komposisjonsrot, DOM-status, feilhåndtering og ny-runde-knapp.
- `src/styles.css` — enkel responsiv presentasjon.
- `src/**/*.test.ts` — samlokaliserte enhets- og integrasjonstester for filene over.

## Fastsatte standardverdier

Produksjonskonfigurasjonen bruker et rutenett på `20 × 20`, startkropp `[(10,10), (9,10), (8,10)]`, startretning `right`, grunnintervall `140 ms`, reduksjon `8 ms` per matbit, minimum `60 ms`, `10` poeng per matbit og inputkøkapasitet `2`. Disse verdiene ligger kun i `DEFAULT_GAME_CONFIG`; testene bruker små eksplisitte konfigurasjoner.

### Task 1: Prosjektskjelett og testverktøy

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `index.html`
- Create: `src/smoke.test.ts`

- [ ] **Step 1: Opprett pakke- og TypeScript-konfigurasjon**

Bruk følgende skript i `package.json`:

```json
{
  "name": "browser-snake",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "jsdom": "^26.0.0",
    "typescript": "^5.9.0",
    "vite": "^7.0.0",
    "vitest": "^3.2.0"
  }
}
```

Konfigurer `tsconfig.json` med `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, DOM-bibliotek og `noEmit`. Konfigurer Vitest i `vite.config.ts` med `environment: 'jsdom'`, `restoreMocks: true` og `clearMocks: true`.

- [ ] **Step 2: Installer låste avhengigheter**

Run: `npm install`
Expected: `package-lock.json` opprettes og installasjonen avsluttes med kode 0.

- [ ] **Step 3: Skriv og kjør en test-runner-smoketest**

```ts
import { describe, expect, it } from 'vitest';

describe('test setup', () => {
  it('runs TypeScript tests in jsdom', () => {
    expect(document.createElement('canvas')).toBeInstanceOf(HTMLCanvasElement);
  });
});
```

Run: `npm test`
Expected: PASS, 1 test.

- [ ] **Step 4: Verifiser TypeScript/Vite-skjelettet**

Lag et minimalt `index.html` med `#app` og `<script type="module" src="/src/main.ts">`; lag midlertidig `src/main.ts` som setter en tekst i `#app`.

Run: `npm run build`
Expected: TypeScript og Vite avslutter med kode 0 og oppretter `dist/`.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts index.html src/main.ts src/smoke.test.ts
git commit -m "build: scaffold TypeScript snake project"
```

### Task 2: Domenetyper, konfigurasjon og opprettelse

**Files:**
- Create: `src/game/types.ts`
- Create: `src/game/config.ts`
- Create: `src/game/config.test.ts`
- Create: `src/game/food.ts`
- Create: `src/game/food.test.ts`
- Create: `src/game/create-game.ts`
- Create: `src/game/create-game.test.ts`
- Delete: `src/smoke.test.ts`

- [ ] **Step 1: Skriv sviktende tester for standardkonfigurasjon og alle invarianter**

Test først at `DEFAULT_GAME_CONFIG` har verdiene fastsatt over. Skriv deretter tabelltester for at `validateGameConfig` avviser: dimensjon mindre enn én, ikke-heltallig dimensjon, tom/duplisert startkropp, startkropp som fyller hele brettet, startposisjon utenfor brettet, ikke-heltallsposisjon, grunnintervall mindre enn minimum, negativt/ikke-positivt fartstrinn, minimumsintervall mindre enn én, poeng mindre enn én, køkapasitet mindre enn én og ikke-heltallig køkapasitet. Test at en gyldig konfigurasjon returneres som en dyp, uforanderlig kopi.

Run: `npm test -- src/game/config.test.ts`
Expected: FAIL fordi modulene ikke finnes.

- [ ] **Step 2: Implementer domenetyper og konfigurasjonsvalidering minimalt**

Definer minst:

```ts
export type PlayerId = string;
export type Direction = 'up' | 'down' | 'left' | 'right';
export type RoundStatus = 'ready' | 'running' | 'paused' | 'lost' | 'won';
export interface Position { readonly x: number; readonly y: number }
export interface PlayerState {
  readonly id: PlayerId;
  readonly body: readonly Position[];
  readonly direction: Direction;
  readonly queuedDirections: readonly Direction[];
  readonly score: number;
}
export interface GameConfig {
  readonly width: number;
  readonly height: number;
  readonly startingBody: readonly Position[];
  readonly startingDirection: Direction;
  readonly baseTickMs: number;
  readonly speedStepMs: number;
  readonly minTickMs: number;
  readonly pointsPerFood: number;
  readonly inputQueueSize: number;
}
export interface GameState {
  readonly config: GameConfig;
  readonly players: Readonly<Record<PlayerId, PlayerState>>;
  readonly food: Position | null;
  readonly status: RoundStatus;
  readonly tickIntervalMs: number;
}
export type RandomSource = () => number;
```

Implementer bare valideringene som testene i Step 1 krever. Bruk rekursiv kopiering/frysing for konfigurasjonen slik at også `startingBody` og posisjonene er uforanderlige ved runtime.

- [ ] **Step 3: Kjør konfigurasjonstestene og bekreft GREEN**

Run: `npm test -- src/game/config.test.ts`
Expected: PASS.

- [ ] **Step 4: Skriv sviktende tester for ledige ruter og matvalg**

Test `listFreeCells(config, players)` og `placeFood(config, players, random)`: alle spillerkropper ekskluderes; `random: () => 0` velger første ledige; en verdi nær `1` velger siste; fullt brett gir `null`; tilfeldig verdi utenfor `[0, 1)` kaster en beskrivende feil.

Run: `npm test -- src/game/food.test.ts`
Expected: FAIL fordi `food.ts` ikke finnes.

- [ ] **Step 5: Implementer minimal matplassering og bekreft GREEN**

Generer ledige ruter i stabil rad-major-rekkefølge. `placeFood` skal være eneste matvalgalgoritme både ved opprettelse og senere spising.

Run: `npm test -- src/game/food.test.ts`
Expected: PASS.

- [ ] **Step 6: Skriv sviktende tester for standardrunde**

Test at `createGame({ config, playerIds: ['local'], random: () => 0 })` returnerer status `ready`, stabil spiller-ID, korrekt startkropp, tom inputkø, null poeng, grunnintervall og mat fra `placeFood` på en ledig rute. Test også to spiller-ID-er med uavhengige spillerobjekter, og avvis tomme eller dupliserte ID-er.

```ts
it('creates a ready game with one addressable player', () => {
  const state = createGame({ config: TEST_CONFIG, playerIds: ['local'], random: () => 0 });
  expect(state.status).toBe('ready');
  expect(state.players.local).toMatchObject({
    id: 'local', direction: 'right', queuedDirections: [], score: 0,
  });
  expect(state.tickIntervalMs).toBe(TEST_CONFIG.baseTickMs);
  expect(state.food).not.toBeNull();
  expect(state.players.local.body).not.toContainEqual(state.food);
});
```

Run: `npm test -- src/game/create-game.test.ts`
Expected: FAIL fordi `createGame` ikke finnes.

- [ ] **Step 7: Implementer standardrunde minimalt og bekreft GREEN**

Valider konfigurasjonen, opprett ett selvstendig spillerobjekt per ID, og kall `placeFood`; ikke dupliser utvalgslogikken.

Run: `npm test -- src/game/create-game.test.ts`
Expected: PASS.

- [ ] **Step 8: Kjør hele pakken og commit**

Run: `npm test && npm run build`
Expected: alle tester består; build avsluttes med kode 0.

```bash
git add src/game src/smoke.test.ts
git commit -m "feat: define snake game state"
```

### Task 3: Retningskø og rundekommandoer

**Files:**
- Create: `src/game/commands.ts`
- Create: `src/game/commands.test.ts`
- Modify: `src/game/types.ts`
- Modify: `src/game/create-game.ts`

- [ ] **Step 1: Skriv sviktende test for spilleradressert retning**

Test `queueDirection(state, 'local', 'up')`: kommandoen legges til bare hos `local`, mens et kunstig `remote`-objekt beholder samme objektreferanse og verdi.

```ts
export function queueDirection(
  state: GameState,
  playerId: PlayerId,
  direction: Direction,
): GameState;

export type RoundCommand = 'toggle-pause' | 'new-round';
export function applyRoundCommand(
  state: GameState,
  command: RoundCommand,
  random: RandomSource,
): GameState;
```

- [ ] **Step 2: Bekreft RED, implementer bare den testede grunnoppførselen og bekreft GREEN**

Run RED/GREEN: `npm test -- src/game/commands.test.ts`

Implementer kun at en gyldig vinkelrett retning legges hos en kjent spiller i `running`, uten å mutere andre spillere eller inngående state. Vent med avvisnings- og kapasitetsreglene til de får egne sviktende tester i neste steg.

- [ ] **Step 3: Utvid test-først med køreglene**

Legg til separate tester for:

- direkte 180-graders vending avvises;
- motsatt retning i `ready` avvises uten å starte runden;
- to lovlige raske vendinger beholdes i rekkefølge;
- en tredje kommando ignoreres når kapasiteten er to;
- en kommando valideres mot siste kølagte retning;
- input under `paused`, `lost` og `won` ignoreres;
- ukjent spiller-ID returnerer den samme state-referansen uten å kaste;
- første gyldige retning i `ready` endrer status til `running`, men flytter ikke slangen.

For hver oppførsel: skriv bare én ny test, kjør og se forventet feil, implementer bare regelen testen krever, kjør og se PASS før neste test skrives.

- [ ] **Step 4: Implementer globale rundekommandoer test-først**

Definer `applyRoundCommand(state, command, random)` der `command` er `'toggle-pause' | 'new-round'`.

Test at:

- `toggle-pause` starter `ready`, pauser `running` og fortsetter `paused`;
- pause tømmer alle spilleres retningskøer;
- fortsettelse beholder retning og tom kø;
- kommandoen ikke endrer `lost`/`won`;
- `new-round` kan brukes fra alle statuser og lager en ny `ready`-runde med samme konfigurasjon og spiller-ID-er, null poeng og ny mat.

- [ ] **Step 5: Kjør verifikasjon og commit**

Run: `npm test && npm run build`
Expected: alle tester og build består.

```bash
git add src/game
git commit -m "feat: add player and round commands"
```

### Task 4: Fast spillsteg, wrap-around og inputforbruk

**Files:**
- Create: `src/game/step-game.ts`
- Create: `src/game/step-game.test.ts`
- Modify: `src/game/types.ts`

- [ ] **Step 1: Skriv sviktende parameteriserte flyttetester**

Test ett steg i hver retning. Bruk arrangerte states med mat langt unna. Bekreft nytt hode, at gammel hale forsvinner, uendret lengde og at input/state behandles uten mutasjon. I en kunstig fler-spiller-state skal et steg adressert til `local` beholde `remote` som samme objektreferanse og verdi. Skriv også sviktende tester som krever samme state-referanse for hver ikke-`running` status og for ukjent spiller-ID.

- [ ] **Step 2: Bekreft RED, implementer ett minimalt steg og bekreft GREEN**

API:

```ts
export function stepGame(
  state: GameState,
  playerId: PlayerId,
  random: RandomSource,
): GameState;
```

Implementer både flytting og de testede no-op-grenene minimalt. `stepGame` returnerer samme state når status ikke er `running` eller spilleren ikke finnes.

Run RED/GREEN: `npm test -- src/game/step-game.test.ts`

- [ ] **Step 3: Utvikle wrap-around test-først**

Legg til én parameterisert test for venstre, høyre, øvre og nedre kant. Bruk modulo-normalisering som også virker for negative koordinater.

- [ ] **Step 4: Utvikle inputforbruk test-først**

Test at nøyaktig første køelement brukes før bevegelsen, at resten beholdes, og at bare én kommando forbrukes per steg. Test sekvensen `right → up → left` over to steg: første steg opp, andre steg venstre.

- [ ] **Step 5: Kjør verifikasjon og commit**

Run: `npm test && npm run build`
Expected: alle tester og build består.

```bash
git add src/game
git commit -m "feat: move snakes with wraparound"
```

### Task 5: Mat, vekst, poeng, fart, kollisjon og seier

**Files:**
- Modify: `src/game/step-game.ts`
- Modify: `src/game/step-game.test.ts`

- [ ] **Step 1: Utvikle vekst og poeng test-først**

Arranger mat på neste hodeposisjon. Test at halen beholdes, lengden øker med én, poeng øker med `pointsPerFood`, og `placeFood` mottar den voksede kroppen slik at ny mat er ledig.

- [ ] **Step 2: Utvikle hastighet test-først**

Test at intervallet reduseres med `speedStepMs` per matbit, og aldri går under `minTickMs`, inkludert når differansen ikke er delelig med trinnet.

- [ ] **Step 3: Utvikle egenkollisjon test-først**

Test at hodet inn i en beholdt kroppsdel gir `lost`. Test separat at hodet lovlig kan flytte inn i ruten halen forlater på et steg uten mat. Test at samme trekk gir kollisjon dersom mat gjør at halen beholdes.

- [ ] **Step 4: Utvikle seier test-først**

På et nesten fullt lite brett: spis siste ledige rute og test `status === 'won'`, `food === null`, korrekt lengde og poeng.

- [ ] **Step 5: Kjør verifikasjon og commit**

Run: `npm test && npm run build`
Expected: alle tester og build består.

```bash
git add src/game
git commit -m "feat: add food scoring and round outcomes"
```

### Task 6: Tastaturadapter og fast tidssteg

**Files:**
- Create: `src/browser/input.ts`
- Create: `src/browser/input.test.ts`
- Create: `src/browser/fixed-step-loop.ts`
- Create: `src/browser/fixed-step-loop.test.ts`

- [ ] **Step 1: Utvikle ren tastaturmapping test-først**

Definer `mapKeyToCommand(key)` som mapper piltaster og WASD case-insensitivt til spillerretninger, faktisk `KeyboardEvent.key`-verdi `' '` (og legacy-verdien `'Spacebar'`) til `toggle-pause`, Enter til `new-round`, og andre taster til `null`.

Run RED/GREEN: `npm test -- src/browser/input.test.ts`

- [ ] **Step 2: Utvikle fokusavgrenset eventbinding test-først**

Definer følgende kontrakt. Funksjonen lytter kun på fokuserbart Canvas, kaller `preventDefault()` bare for gjenkjente spilltaster, fokuserer Canvas ved pekeklikk og returnerer en cleanup-funksjon. Integrasjonstesten dispatcher ekte `KeyboardEvent` og `MouseEvent` mot jsdom-elementet.

```ts
export type GameInputCommand =
  | { readonly type: 'direction'; readonly direction: Direction }
  | { readonly type: 'round'; readonly command: RoundCommand };

export interface GameInputHandlers {
  readonly onCommand: (command: GameInputCommand) => void;
}

export function bindGameInput(
  canvas: HTMLCanvasElement,
  handlers: GameInputHandlers,
): () => void;
```

- [ ] **Step 3: Utvikle akkumulatoren som en ren funksjon test-først**

Skill beregning fra `requestAnimationFrame`:

```ts
export interface AdvanceResult {
  readonly accumulatorMs: number;
  readonly steps: number;
}

export function advanceAccumulator(
  accumulatorMs: number,
  elapsedMs: number,
  tickMs: number,
  maxCatchUpSteps: number,
): AdvanceResult;
```

Test 0 steg før et helt intervall, ett/flere steg ved nok tid, resttid, maksimum antall innhentingssteg og forkasting av overdreven akkumulert tid.

- [ ] **Step 4: Utvikle RAF-adapteren test-først**

Definer kontrakten under. Test med fakes at første frame bare etablerer tidsgrunnlag, at `ready → running` nullstiller tidsgrunnlag/akkumulator slik at det går ett helt intervall før første steg, at pause nullstiller akkumulatoren, at fortsettelse venter et helt intervall, at `onRender` kalles per frame, og at `stop()` avbestiller neste frame.

```ts
export interface FixedStepLoopOptions {
  readonly now: () => number;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly getTickMs: () => number;
  readonly shouldRun: () => boolean;
  readonly onStep: () => void;
  readonly onRender: () => void;
  readonly maxCatchUpSteps: number;
}

export interface FixedStepLoop {
  readonly start: () => void;
  readonly stop: () => void;
  readonly resetTiming: () => void;
}

export function createFixedStepLoop(options: FixedStepLoopOptions): FixedStepLoop;
```

Komposisjonsroten kaller `resetTiming()` ved enhver overgang mellom ikke-kjørende og `running`, inkludert første retning eller mellomrom i `ready` og fortsettelse fra `paused`.

- [ ] **Step 5: Kjør verifikasjon og commit**

Run: `npm test && npm run build`
Expected: alle tester og build består.

```bash
git add src/browser
git commit -m "feat: add browser input and fixed-step loop"
```

### Task 7: Canvas-renderer

**Files:**
- Create: `src/browser/canvas-renderer.ts`
- Create: `src/browser/canvas-renderer.test.ts`

- [ ] **Step 1: Skriv sviktende test for layoutberegning**

Trekk ut `calculateBoardLayout(cssWidth, cssHeight, columns, rows)` og test at den velger største kvadratiske cellestørrelse som passer, sentrerer brettet og aldri endrer logiske dimensjoner.

- [ ] **Step 2: Bekreft RED, implementer og bekreft GREEN**

Run RED/GREEN: `npm test -- src/browser/canvas-renderer.test.ts`

- [ ] **Step 3: Skriv sviktende renderer-test med minimal Canvas-fake**

Bruk følgende kontrakt. Test at `createCanvasRenderer(canvas, context, getDevicePixelRatio)` gir et objekt med `render(state)`, setter backing store etter CSS-størrelse × pikselforhold, resetter transform, tømmer flaten og tegner mat og alle spillerkropper fra state. Test observerbare Canvas-kall; ikke piksel-snapshots.

```ts
export interface CanvasRenderer {
  readonly render: (state: GameState) => void;
}

export function createCanvasRenderer(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  getDevicePixelRatio: () => number,
): CanvasRenderer;
```

- [ ] **Step 4: Implementer renderer uten regler**

Rendereren skal bruke `state.config` for rutenettet, `state.players` for slanger og `state.food` når den ikke er `null`. Den skal ikke flytte slanger, avgjøre kollisjon eller plassere mat. Bruk tydelig kontrast og et visuelt skille mellom hode og kropp.

- [ ] **Step 5: Kjør verifikasjon og commit**

Run: `npm test && npm run build`
Expected: alle tester og build består.

```bash
git add src/browser
git commit -m "feat: render game state on canvas"
```

### Task 8: Komposisjonsrot, UI og feiltilstand

**Files:**
- Modify: `index.html`
- Modify: `src/main.ts`
- Create: `src/main.test.ts`
- Create: `src/styles.css`

- [ ] **Step 1: Skriv sviktende integrasjonstest for oppstart**

Eksporter `mountGame(root, dependencies)` med kontrakten under. Testene kan dermed injisere Canvas-kontekst, tilfeldig kilde og frame-API. Test at mount lager/finner Canvas, poeng `0`, status `Klar`, instruksjoner og «Ny runde», og at Canvas er fokusérbart.

```ts
export interface AppDependencies {
  readonly random: RandomSource;
  readonly now: () => number;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly cancelFrame: (handle: number) => void;
  readonly getCanvasContext: (canvas: HTMLCanvasElement) => CanvasRenderingContext2D | null;
  readonly devicePixelRatio: () => number;
}

export interface MountedGame {
  readonly destroy: () => void;
  readonly getState: () => GameState;
}

export function mountGame(root: HTMLElement, dependencies: AppDependencies): MountedGame;
```

Run RED: `npm test -- src/main.test.ts`
Expected: FAIL fordi komposisjonen ikke finnes.

- [ ] **Step 2: Implementer minimal applikasjonskomposisjon og bekreft GREEN**

Koble retningsinput og mellomrom til `queueDirection`/`applyRoundCommand`, loopen til `stepGame`, og hver render til Canvas samt DOM-status. Koble «Ny runde»-knappen til `new-round`-overgangen fra alle statuser. Vent med tastaturets Enter-filter til Step 4, hvor oppførselen utvikles test-først. Bruk `Math.random`, `performance.now` og `requestAnimationFrame` bare her ved produksjonskomposisjon.

Run: `npm test -- src/main.test.ts`
Expected: PASS.

- [ ] **Step 3: Utvikle manglende Canvas-kontekst test-først**

Test at `getContext('2d') === null` viser en forståelig norsk feilmelding i stedet for å starte loopen, og logger den opprinnelige feilen med `console.error`.

- [ ] **Step 4: Utvikle UI-oppdateringer og omstart test-først**

Test én oppførsel av gangen og bekreft RED før produksjonsendringen: status/poeng gjenspeiler siste state; «Ny runde» fungerer fra aktiv runde; Enter ignoreres i `ready`/`running`/`paused`, men starter ny runde i `lost`/`won`; knappen fokuserer Canvas igjen; cleanup stopper loop og eventlyttere. Implementer Enter-filteret først etter at den tilhørende sviktende testen finnes.

- [ ] **Step 5: Ferdigstill responsiv HTML/CSS**

Lag en sentrert spillflate som fungerer fra små mobilbredder til desktop, men uten berøringskontroller. Bruk semantiske labels, synlig fokusmarkering, status med `aria-live="polite"`, instruksjonstekst og en knapp som ikke overlapper Canvas.

- [ ] **Step 6: Kjør full automatisk verifikasjon**

Run: `npm test`
Expected: alle enhets- og integrasjonstester består med 0 feil.

Run: `npm run build`
Expected: TypeScript og produksjonsbuild avsluttes med kode 0.

Run: `git diff --check`
Expected: ingen output og exit 0.

- [ ] **Step 7: Commit**

```bash
git add index.html src/main.ts src/main.test.ts src/styles.css
git commit -m "feat: assemble playable canvas snake game"
```

### Task 9: Kravsporbarhet og nettleserverifikasjon

**Files:**
- Modify only if verification exposes a defect; every fix requires a failing regression test first.

- [ ] **Step 1: Kjør fersk komplett verifikasjon**

Run: `npm test && npm run build && git diff --check`
Expected: alle tester består, build består og ingen whitespace-feil rapporteres.

- [ ] **Step 2: Spor spesifikasjonen mot implementasjonen**

Kontroller punkt for punkt: Canvas 2D, én lokal spiller, stabile ID-er, spilleradresserte retninger, wrap på fire kanter, køkapasitet to, én kommando per steg, mat kun på ledig rute, vekst, poeng, fartsgrense, egenkollisjon med haleregel, fullt brett, pause/køtømming, omstart, responsiv HiDPI-rendering, fokusstyring, synlig Canvas-feil og begrenset innhenting.

- [ ] **Step 3: Start lokal server og åpne innebygd nettleser**

Run: `npm run dev`
Expected: Vite oppgir en lokal `http://127.0.0.1:<port>/`-adresse.

Åpne adressen i den innebygde nettleseren. Bekreft synlig spillflate, poeng, status, instruksjoner og ny-runde-knapp.

- [ ] **Step 4: Funksjonstest spillet manuelt**

Med Canvas i fokus:

1. Start med retningstast; bekreft bevegelse.
2. Styr med både piltaster og WASD.
3. Kryss hver kant og bekreft wrap-around.
4. Forsøk direkte 180-graders vending og bekreft at den avvises.
5. Spis mat og bekreft vekst, poeng og gradvis høyere fart.
6. Pause/fortsett med mellomrom og bekreft ingen umiddelbar innhenting.
7. Bruk «Ny runde» under aktiv runde; bekreft nullstilt poeng, klar-status og Canvas-fokus.
8. Fremprovoser egenkollisjon og bekreft tap; bruk Enter for ny runde.

- [ ] **Step 5: Rett eventuelle funn med TDD og verifiser på nytt**

For ethvert avvik: skriv en sviktende automatisert regresjonstest, bekreft RED, implementer minste rettelse, bekreft GREEN, kjør full test/build og gjenta nettlesersjekken.

- [ ] **Step 6: Endelig commit ved eventuelle verifikasjonsfunn**

```bash
git add src index.html
git commit -m "fix: address browser verification findings"
```

Ikke opprett en tom commit dersom ingen funn krevde endringer.
