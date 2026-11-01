import { NextRequest, NextResponse } from 'next/server';
import { oisClient, parseOisVurdering, OisEjendomData } from '@/lib/ois';
import { hentEjendomBasis } from '@/lib/dawa';
import { beregnNabosammenligning, SalgsReference } from '@/lib/datafordeleren';

// ---------- Response Types ----------

export interface EjendomResponse {
  success: boolean;
  data?: {
    basis: {
      adresseId: string;
      adresseTekst: string;
      bfeNummer: string | null;
      boligArealM2: number | null;
      byggeaar: number | null;
    };
    vurdering: {
      ejendomsvaerdi2024: number | null;
      ejendomsvaerdi2025: number | null;
      grundvaerdi2024: number | null;
      grundvaerdi2025: number | null;
      beskatningsgrundlag2025: number | null;
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
    oisStatus: 'ok' | 'fejl';
  };
}

// ---------- POST /api/ejendom ----------

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { adresseId, bfeNummer: direkteBfe } = body as { adresseId?: string; bfeNummer?: string };

    // Hvis der er indtastet BFE direkte, brug det
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
            oisStatus: 'fejl',
          },
        },
        { status: 400 }
      );
    }

    // Hent data fra DAR (adresse) og derefter OIS via BFE
    const basis = await hentEjendomBasis(adresseId);

    if (!basis) {
      return NextResponse.json<EjendomResponse>(
        {
          success: false,
          error: 'Kunne ikke finde adressen. Prøv igen eller brug BFE-nummer.',
          meta: {
            adresseId,
            hentet: new Date().toISOString(),
            oisStatus: 'fejl',
          },
        },
        { status: 404 }
      );
    }

    // Hvis vi har BFE fra adresse-opslaget, brug det
    if (basis.bfeNummer) {
      return await hentEjendomFraBfeMedBasis(basis.bfeNummer, basis);
    }

    // Ellers returner basis-info uden vurdering
    return NextResponse.json<EjendomResponse>({
      success: true,
      data: {
        basis: {
          adresseId: basis.adresseId,
          adresseTekst: basis.adresseTekst,
          bfeNummer: null,
          boligArealM2: basis.boligArealM2,
          byggeaar: basis.byggeaar,
        },
        vurdering: {
          ejendomsvaerdi2024: null,
          ejendomsvaerdi2025: null,
          grundvaerdi2024: null,
          grundvaerdi2025: null,
          beskatningsgrundlag2025: null,
        },
        senesteSalg: { koebesum: null, dato: null, m2Pris: null },
        nabosammenligning: null,
        indsigelse: {
          potentiale: false,
          procentOverMarked: null,
          begrundelse: 'BFE-nummer ikke fundet for denne adresse. Indtast BFE manuelt for fuld analyse.',
        },
      },
      meta: {
        adresseId,
        hentet: new Date().toISOString(),
        oisStatus: 'ok',
      },
    });

  } catch (error) {
    console.error('Uventet fejl i /api/ejendom:', error);
    return NextResponse.json<EjendomResponse>(
      {
        success: false,
        error: 'Intern serverfejl',
        meta: {
          adresseId: '',
          hentet: new Date().toISOString(),
          oisStatus: 'fejl',
        },
      },
      { status: 500 }
    );
  }
}

// ---------- Hjælpefunktion: Hent ejendom fra BFE med basis-data ----------

async function hentEjendomFraBfeMedBasis(bfeNummer: string, basis: { adresseId: string; adresseTekst: string; boligArealM2: number | null; byggeaar: number | null }): Promise<NextResponse> {
  try {
    let oisData = await oisClient.hentEjendomData(bfeNummer);
    let aktivBfe = bfeNummer;

    // Hvis SFE-BFE'et ikke har vurderingsdata, find den korrekte EJL-BFE via adresse-match
    if (!oisData || (!oisData.ejendomsvaerdi && !oisData.senesteSalgKoebesum)) {
      const ejlBfe = await oisClient.findEjlBfeForAdresse(bfeNummer, basis.adresseTekst);
      if (ejlBfe) {
        const ejlData = await oisClient.hentEjendomData(ejlBfe);
        if (ejlData) {
          oisData = ejlData;
          aktivBfe = ejlBfe;
        }
      }
    }

    if (!oisData) {
      return NextResponse.json<EjendomResponse>(
        {
          success: false,
          error: 'Kunne ikke hente data for BFE-nummer',
          meta: { adresseId: bfeNummer, hentet: new Date().toISOString(), oisStatus: 'fejl' },
        },
        { status: 404 }
      );
    }

    const vurdering = parseOisVurdering(oisData);

    const senesteSalg = {
      koebesum: oisData.senesteSalgKoebesum,
      dato: oisData.senesteSalgDato,
      m2Pris: oisData.senesteSalgKoebesum && basis.boligArealM2
        ? Math.round(oisData.senesteSalgKoebesum / basis.boligArealM2)
        : null,
    };

    // Beregn nabotjek - geografisk baseret hvis muligt, ellers BFE-sekvens som fallback
    let nabosammenligning: ReturnType<typeof beregnNabosammenligning> | null = null;
    let bfeListe: string[] = [];

    const apiKey = process.env.DATAFORDELER_API_KEY ?? '';

    // Forsøg geografisk søgning først (find naboer inden for 300m)
    if (apiKey) {
      const koordinater = await oisClient.hentKoordinaterFraAdresseId(apiKey, basis.adresseId);
      if (koordinater) {
        console.log(`Geografisk søgning omkring ${koordinater.x}, ${koordinater.y}`);
        bfeListe = await oisClient.hentBfeListeFraGeografi(apiKey, koordinater.x, koordinater.y, 300);
        console.log(`Geografisk søgning fandt ${bfeListe.length} BFE'er`);
      } else {
        console.log('Kunne ikke hente koordinater for adresse');
      }
    }

    // Fallback til BFE-sekvens hvis geografisk søgning ikke fandt naboer
    if (bfeListe.length === 0) {
      bfeListe = oisClient.genererBfeListe(aktivBfe, 40);
      console.log(`Fallback til BFE-sekvens omkring ${aktivBfe}`);
    }

    const oisDataListe = await oisClient.hentSalgsdataForBfeListe(bfeListe);
    console.log(`Nabotjek: ${bfeListe.length} BFE'er fundet, ${oisDataListe.filter(d => d.senesteSalgKoebesum).length} med salgsdata`);

    // Debug: log salgsdatoer
    oisDataListe.forEach((d) => {
      if (d.senesteSalgKoebesum) {
        console.log(`  BFE ${d.bfeNummer}: ${d.senesteSalgKoebesum} kr, dato: ${d.senesteSalgDato}`);
      }
    });

    const toAarSiden = new Date();
    toAarSiden.setFullYear(toAarSiden.getFullYear() - 2);

    const referencer: SalgsReference[] = (
      await Promise.all(
        oisDataListe
          .filter((d) => {
            // Inkluder kun hvis der er salgspris
            if (!d.senesteSalgKoebesum || d.senesteSalgKoebesum <= 0) return false;
            // Hvis der er en dato, skal den være inden for seneste 2 år
            // Hvis der ikke er en dato, inkluderer vi den alligevel (bedre end ingenting)
            if (d.senesteSalgDato) {
              const salgsDato = new Date(d.senesteSalgDato);
              return salgsDato >= toAarSiden;
            }
            return true;
          })
          .map(async (d) => {
            // Hent adresse for denne reference
            const info = await oisClient.hentGenerelInfo(d.bfeNummer);
            const sfeInfo = info?.GeneralInfoSFE as Record<string, unknown> | undefined;
            const ejlInfo = info?.GeneralInfoEJL as Record<string, unknown> | undefined;
            const beliggenhed = String(sfeInfo?.beligenhed ?? ejlInfo?.beligenhed ?? `BFE ${d.bfeNummer}`);

            return {
              adresse: beliggenhed,
              bfeNummer: d.bfeNummer,
              koebesum: d.senesteSalgKoebesum!,
              salgsdato: d.senesteSalgDato ?? '',
              boligArealM2: basis.boligArealM2 ?? 0,
              m2Pris: basis.boligArealM2 ? d.senesteSalgKoebesum! / basis.boligArealM2 : 0,
            };
          })
      )
    );

    nabosammenligning = beregnNabosammenligning(referencer);

    // Beregn indsigelse
    let indsigelse = {
      potentiale: false,
      procentOverMarked: null as number | null,
      begrundelse: 'Manglende data til sammenligning',
    };

    if (vurdering.ejendomsvaerdi2025 && nabosammenligning && nabosammenligning.antalReferencer > 0 && basis.boligArealM2) {
      const markedM2Pris = nabosammenligning.gennemsnitM2Pris;
      const vurderingM2Pris = vurdering.ejendomsvaerdi2025 / basis.boligArealM2;
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
        basis: {
          adresseId: basis.adresseId,
          adresseTekst: basis.adresseTekst,
          bfeNummer: aktivBfe,
          boligArealM2: basis.boligArealM2,
          byggeaar: basis.byggeaar,
        },
        vurdering,
        senesteSalg,
        nabosammenligning,
        indsigelse,
      },
      meta: {
        adresseId: basis.adresseId,
        hentet: new Date().toISOString(),
        oisStatus: 'ok',
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Fejl ved hentning af ejendom fra BFE:', error);
    return NextResponse.json<EjendomResponse>(
      {
        success: false,
        error: 'Kunne ikke hente ejendomsdata fra OIS',
        meta: { adresseId: bfeNummer, hentet: new Date().toISOString(), oisStatus: 'fejl' },
      },
      { status: 500 }
    );
  }
}

// ---------- Hjælpefunktion: Hent ejendom fra BFE ----------

async function hentEjendomFraBfe(bfeNummer: string): Promise<NextResponse> {
  try {
    // Hent data fra OIS
    const oisData = await oisClient.hentEjendomData(bfeNummer);

    if (!oisData) {
      return NextResponse.json<EjendomResponse>(
        {
          success: false,
          error: 'Kunne ikke hente data for BFE-nummer',
          meta: {
            adresseId: bfeNummer,
            hentet: new Date().toISOString(),
            oisStatus: 'fejl',
          },
        },
        { status: 404 }
      );
    }

    // Hent generel info for at få adresse
    const generelInfo = await oisClient.hentGenerelInfo(bfeNummer);
    const sfeInfo = generelInfo?.GeneralInfoSFE as Record<string, unknown> | undefined;
    const ejlInfo = generelInfo?.GeneralInfoEJL as Record<string, unknown> | undefined;
    const beliggenhed = String(sfeInfo?.beliggenhed ?? ejlInfo?.beliggenhed ?? `BFE ${bfeNummer}`);

    // Parse vurdering
    const vurdering = parseOisVurdering(oisData);

    // Parse seneste salg
    const senesteSalg = {
      koebesum: oisData.senesteSalgKoebesum,
      dato: oisData.senesteSalgDato,
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
    let indsigelse = {
      potentiale: false,
      procentOverMarked: null as number | null,
      begrundelse: 'Manglende data til sammenligning',
    };

    if (vurdering.ejendomsvaerdi2025 && nabosammenligning && nabosammenligning.antalReferencer > 0) {
      const markedM2Pris = nabosammenligning.gennemsnitM2Pris;
      const vurderingM2Pris = vurdering.ejendomsvaerdi2025;
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
        basis: {
          adresseId: bfeNummer,
          adresseTekst: beliggenhed,
          bfeNummer,
          boligArealM2: null, // OIS returnerer ikke areal
          byggeaar: null, // OIS returnerer ikke byggeår
        },
        vurdering,
        senesteSalg,
        nabosammenligning,
        indsigelse,
      },
      meta: {
        adresseId: bfeNummer,
        hentet: new Date().toISOString(),
        oisStatus: 'ok',
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Fejl ved hentning af ejendom fra BFE:', error);
    return NextResponse.json<EjendomResponse>(
      {
        success: false,
        error: 'Kunne ikke hente ejendomsdata fra OIS',
        meta: {
          adresseId: bfeNummer,
          hentet: new Date().toISOString(),
          oisStatus: 'fejl',
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
        description: 'Hent samlet ejendomsdata for et BFE-nummer',
        body: { bfeNummer: 'string (BFE-nummer)' },
      },
    },
    note: 'Bruger OIS.dk som datakilde',
  });
}
