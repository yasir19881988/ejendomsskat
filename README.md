# ejendomsskat.dk

Platform til at tjekke danske boligejeres offentlige ejendomsvurdering mod reelle salgspriser.

## Funktioner

- **Adresse-søgning**: Autocomplete via DAR GraphQL
- **Ejendomsprofil**: BBR-data (areal, byggeår), OIS-vurdering, seneste salgspris
- **Nabotjek**: Sammenligning med solgte ejendomme i området
- **Indsigelses-indikator**: Viser potentiale for indsigelse mod vurderingen

## Teknologi

- **Frontend**: Next.js 16 (App Router, TypeScript), Tailwind CSS
- **Backend**: Next.js API Routes
- **Datakilder**:
  - DAR GraphQL (adresser)
  - BBR GraphQL (bygningsdata)
  - OIS.dk (ejendomsvurdering og salg)
  - Datafordeleren (Tinglysning - kræver godkendelse)

## Kom i gang

### 1. Installer dependencies

```bash
npm install
```

### 2. Konfigurer miljøvariabler

Opret `.env.local` med dine Datafordeleren credentials:

```env
DATAFORDELER_API_KEY=din-api-key-her
DATAFORDELER_CLIENT_ID=din-client-id-her
DATAFORDELER_CLIENT_SECRET=din-shared-secret-her
```

### 3. Start udviklingsserver

```bash
npm run dev
```

Åbn [http://localhost:3000](http://localhost:3000) i browseren.

## Deploy til Vercel

1. Push projektet til GitHub
2. Opret konto på [Vercel](https://vercel.com)
3. Importer projektet fra GitHub
4. Tilføj miljøvariabler i Vercel dashboard:
   - `DATAFORDELER_API_KEY`
   - `DATAFORDELER_CLIENT_ID`
   - `DATAFORDELER_CLIENT_SECRET`
5. Deploy

## API Endpoints

| Endpoint | Beskrivelse |
|----------|-------------|
| `GET /api/adresse?q=...` | Autocomplete adresse-søgning |
| `POST /api/ejendom` | Hent samlet ejendomsdata |

## Bemærkninger

- **DAWA er lukket** (1. oktober 2026) - projektet bruger DAR GraphQL i stedet
- **BBR Light er lukket** (3. april 2024) - projektet bruger BBR GraphQL
- **Tinglysning** kræver virksomhedsregistrering og ansøgning hos Datafordeleren
- **OIS.dk** er et åbent API uden krav om registrering

## Licens

Privat projekt - alle rettigheder forbeholdes.

