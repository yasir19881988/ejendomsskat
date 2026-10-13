import { NextRequest, NextResponse } from 'next/server';
import { hentEjendomBasis, EjendomBasis } from '@/lib/dawa';
import { datafordelerenClient, beregnNabosammenligning, SalgsReference } from '@/lib/datafordeleren';
import { oisClient, parseOisVurdering } from '@/lib/ois';

// ---------- Response Types ----------

export interface EjendomResponse {
  success: boolean;
  data?: {
    basis: EjendomBasis;
    vurdering: {
      ejendomsvaerdi2024: number | null;
      ejendomsvaerdi2025: number | null;
      grundvaerdi2024: number | null;
      grundvaerdi2025: number | null;
      beskatningsgrundlag2025: number | null; // 80% af ejendomsværdi efter 20% forsigtighedsfradrag
    };
    senesteSalg: {
      koebesum: number | null;
      dato: string | null;
      m2Pris: number | null;
    };
    nabosammenligning: ReturnType<typeof beregnNabosammenligning> | null;
    indsigelse: {
      potentiale: boolean;
      procentOverMarked: number | null;
      begrundelse: string;
    };
  };
  error?: string;
  meta: {
    adresseId: string;
    hentet: string;
    dawaStatus: 'ok' | 'lukket' | 'fejl';
    datafordelerStatus: 'ok' | 'mangler-auth' | 'fejl';
  };
}

// ---------- POST /api/ejendom ----------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adresseId, bfeNummer: direkteBfe } = body as { adresseId?: string; bfeNummer?: string };

    // Hvis der er indtastet BFE direkte, brug det i stedet for adresse-opslag
    if (direkteBfe && /^\d+$/.test(direkteBfe)) {
      return await hentEjendomFraBfe(direkteBfe);
    }

    if (!adresseId || typeof adresseId !== 'string') {
      return NextResponse.json<EjendomResponse>(
        {
          success: false,
          error: 'Manglende eller ugyldigt adresseId',
          meta: {
            adresseId: '',
            hentet: new Date().toISOString(),
            dawaStatus: 'fejl',
            datafordelerStatus: 'fejl',
          },
        },
        { status: 400 }
      );
    }

    // 1. Hent basisdata fra DAWA (adresse + BBR)
    const basis = await hentEjendomBasis(adresseId);

    if (!basis) {
      return NextResponse.json<EjendomResponse>(
        {
          success: false,
          error: 'Kunne ikke hente adresse fra DAWA. Servicen kan være lukket eller adressen findes ikke.',
          meta: {
            adresseId,
            hentet: new Date().toISOString(),
            dawaStatus: 'lukket',
            datafordelerStatus: 'fejl',
          },
        },
        { status: 404 }
      );
    }

    // 2. Hent tinglyst købesum fra Datafordeleren (hvis BFE-nummer findes)
    let senesteSalg = {
      koebesum: null as number | null,
      dato: null as string | null,
      m2Pris: null as number | null,
    };
    let datafordelerStatus: 'ok' | 'mangler-auth' | 'fejl' = 'mangler-auth';

    if (basis.bfeNummer) {
      try {
        const tinglysninger = await datafordelerenClient.hentTinglystKoebesum(basis.bfeNummer);
        datafordelerStatus = 'ok';

        if (tinglysninger.length > 0) {
          const seneste = tinglysninger.sort((a, b) => {
            const datoA = a.overfoerselsdato ?? '';
            const datoB = b.overfoerselsdato ?? '';
            return datoB.localeCompare(datoA);
          })[0];

          senesteSalg = {
            koebesum: seneste.beloeb ?? null,
            dato: seneste.overfoerselsdato ?? null,
            m2Pris:
              seneste.beloeb && basis.boligArealM2
                ? Math.round(seneste.beloeb / basis.boligArealM2)
                : null,
          };
        }
      } catch (error) {
        console.error('Fejl ved hentning af tinglyst købesum:', error);
        datafordelerStatus = 'fejl';
      }
    }

    // 3. Hent offentlig ejendomsværdi fra OIS.dk (Vurderingsstyrelsens data via OIS)
    let vurdering = {
      ejendomsvaerdi2024: null as number | null,
      ejendomsvaerdi2025: null as number | null,
      grundvaerdi2024: null as number | null,
      grundvaerdi2025: null as number | null,
      beskatningsgrundlag2025: null as number | null,
    };

    if (basis.bfeNummer) {
      try {
        const oisData = await oisClient.hentEjendomData(basis.bfeNummer);
        if (oisData) {
          const parsed = parseOisVurdering(oisData);
          vurdering = {
            ejendomsvaerdi2024: parsed.ejendomsvaerdi2024,
            ejendomsvaerdi2025: parsed.ejendomsvaerdi2025,
            grundvaerdi2024: parsed.grundvaerdi2024,
            grundvaerdi2025: parsed.grundvaerdi2025,
            beskatningsgrundlag2025: parsed.beskatningsgrundlag2025,
          };

          // Hvis OIS har seneste salg, brug det som fallback hvis Datafordeleren fejlede
          if (!senesteSalg.koebesum && oisData.senesteSalgKoebesum) {
            senesteSalg = {
              koebesum: oisData.senesteSalgKoebesum,
              dato: oisData.senesteSalgDato,
              m2Pris: oisData.senesteSalgKoebesum && basis.boligArealM2
                ? Math.round(oisData.senesteSalgKoebesum / basis.boligArealM2)
                : null,
            };
          }
        }
      } catch (error) {
        console.error('Fejl ved hentning af OIS-vurdering:', error);
      }
    }

    // 4. Beregn nabosammenligning via OIS (kræver ikke Tinglysning-godkendelse)
    let nabosammenligning: ReturnType<typeof beregnNabosammenligning> | null = null;

    if (basis.boligArealM2 && basis.bfeNummer) {
      try {
        // Generer liste af BFE-numre i området (forløbende sekvens)
        // Brug 40 BFE'er for at få nok data efter filtrering
        const bfeListe = oisClient.genererBfeListe(basis.bfeNummer, 40);

        // Hent salgsdata for alle BFE-numre
        const oisDataListe = await oisClient.hentSalgsdataForBfeListe(bfeListe);

        // Filtrer ejendomme med både salgspris og areal, og kun seneste 2 år
        const toAarSiden = new Date();
        toAarSiden.setFullYear(toAarSiden.getFullYear() - 2);

        const referencer: SalgsReference[] = oisDataListe
          .filter((d) => {
            if (!d.senesteSalgKoebesum || d.senesteSalgKoebesum <= 0) return false;
            if (!d.senesteSalgDato) return false;
            const salgsDato = new Date(d.senesteSalgDato);
            return salgsDato >= toAarSiden;
          })
          .map((d) => ({
            adresse: `BFE ${d.bfeNummer}`,
            bfeNummer: d.bfeNummer,
            koebesum: d.senesteSalgKoebesum!,
            salgsdato: d.senesteSalgDato ?? '',
            boligArealM2: basis.boligArealM2!, // Vi bruger basis-areal som reference
            m2Pris: d.senesteSalgKoebesum! / basis.boligArealM2!,
          }));

        nabosammenligning = beregnNabosammenligning(referencer);
      } catch (error) {
        console.error('Fejl ved nabosammenligning:', error);
      }
    }

    // 5. Beregn indsigelses-indikator
    let indsigelse = {
      potentiale: false,
      procentOverMarked: null as number | null,
      begrundelse: 'Manglende data til sammenligning',
    };

    if (vurdering.ejendomsvaerdi2025 && nabosammenligning && nabosammenligning.antalReferencer > 0) {
      const markedM2Pris = nabosammenligning.gennemsnitM2Pris;
      const vurderingM2Pris = vurdering.ejendomsvaerdi2025 / (basis.boligArealM2 ?? 1);
      const procentOver = ((vurderingM2Pris - markedM2Pris) / markedM2Pris) * 100;

      indsigelse = {
        potentiale: procentOver > 15,
        procentOverMarked: Math.round(procentOver * 10) / 10,
        begrundelse:
          procentOver > 15
            ? `Vurderingen er ${Math.round(procentOver)}% over markedets gennemsnitlige m²-pris (${markedM2Pris.toLocaleString('da-DK')} kr/m²)`
            : 'Vurderingen ligger inden for normalt interval i forhold til markedet',
      };
    }

    const response: EjendomResponse = {
      success: true,
      data: {
        basis,
        vurdering,
        senesteSalg,
        nabosammenligning,
        indsigelse,
      },
      meta: {
        adresseId,
        hentet: new Date().toISOString(),
        dawaStatus: 'ok',
        datafordelerStatus,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Uventet fejl i /api/ejendom:', error);
    return NextResponse.json<EjendomResponse>(
      {
        success: false,
        error: 'Intern serverfejl',
        meta: {
          adresseId: '',
          hentet: new Date().toISOString(),
          dawaStatus: 'fejl',
          datafordelerStatus: 'fejl',
        },
      },
      { status: 500 }
    );
  }
}

// ---------- Hjælpefunktion: Hent ejendom direkte fra BFE ----------

async function hentEjendomFraBfe(bfeNummer: string): Promise<NextResponse> {
  try {
    // Hent data fra OIS
    const oisData = await oisClient.hentEjendomData(bfeNummer);
    const generelInfo = await oisClient.hentGenerelInfo(bfeNummer);

    const sfeInfo = generelInfo?.GeneralInfoSFE as Record<string, unknown> | undefined;
    const ejlInfo = generelInfo?.GeneralInfoEJL as Record<string, unknown> | undefined;
    const beliggenhed = String(sfeInfo?.beliggenhed ?? ejlInfo?.beliggenhed ?? `BFE ${bfeNummer}`);

    // Parse vurdering
    const vurdering = parseOisVurdering(oisData);

    // Parse seneste salg
    const senesteSalg = {
      koebesum: oisData?.senesteSalgKoebesum ?? null,
      dato: oisData?.senesteSalgDato ?? null,
      m2Pris: null as number | null,
    };

    // Beregn nabotjek
    let nabosammenligning: ReturnType<typeof beregnNabosammenligning> | null = null;
    const bfeListe = oisClient.genererBfeListe(bfeNummer, 40);
    const oisDataListe = await oisClient.hentSalgsdataForBfeListe(bfeListe);

    const toAarSiden = new Date();
    toAarSiden.setFullYear(toAarSiden.getFullYear() - 2);

    const referencer: SalgsReference[] = oisDataListe
      .filter((d) => {
        if (!d.senesteSalgKoebesum || d.senesteSalgKoebesum <= 0) return false;
        if (!d.senesteSalgDato) return false;
        const salgsDato = new Date(d.senesteSalgDato);
        return salgsDato >= toAarSiden;
      })
      .map((d) => ({
        adresse: `BFE ${d.bfeNummer}`,
        bfeNummer: d.bfeNummer,
        koebesum: d.senesteSalgKoebesum!,
        salgsdato: d.senesteSalgDato ?? '',
        boligArealM2: 0,
        m2Pris: 0,
      }));

    nabosammenligning = beregnNabosammenligning(referencer);

    // Beregn indsigelse
    const indsigelse = {
      potentiale: false,
      procentOverMarked: null as number | null,
      begrundelse: 'Manglende data til sammenligning',
    };

    const response: EjendomResponse = {
      success: true,
      data: {
        basis: {
          adresseId: bfeNummer,
          adresseTekst: beliggenhed,
          vejnavn: beliggenhed.split(',')[0] ?? '',
          husnr: '',
          postnr: '',
          postnrnavn: '',
          kommunekode: null,
          bfeNummer,
          matrikelnr: null,
          boligArealM2: null,
          byggeaar: null,
          samletArealM2: null,
        },
        vurdering,
        senesteSalg,
        nabosammenligning,
        indsigelse,
      },
      meta: {
        adresseId: bfeNummer,
        hentet: new Date().toISOString(),
        dawaStatus: 'ok',
        datafordelerStatus: 'ok',
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Fejl ved hentning af ejendom fra BFE:', error);
    return NextResponse.json<EjendomResponse>(
      {
        success: false,
        error: 'Kunne ikke hente ejendomsdata fra BFE',
        meta: {
          adresseId: bfeNummer,
          hentet: new Date().toISOString(),
          dawaStatus: 'fejl',
          datafordelerStatus: 'fejl',
        },
      },
      { status: 500 }
    );
  }
}

// ---------- GET /api/ejendom (health check) ----------

export async function GET() {
  return NextResponse.json({
    service: 'ejendomsskat.dk API',
    status: 'ok',
    endpoints: {
      'POST /api/ejendom': {
        description: 'Hent samlet ejendomsdata for en adresse',
        body: { adresseId: 'string (DAWA adresse UUID)' },
      },
    },
    miljoe: {
      dawa: 'lukket 1. oktober 2026 - migrer til Datafordeleren DAR',
      bbrLight: 'lukket 3. april 2024 - brug BBR GraphQL',
      datafordeler: 'kræver DATAFORDELER_USERNAME og DATAFORDELER_PASSWORD',
    },
  });
}
