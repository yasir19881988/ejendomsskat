import axios, { AxiosInstance } from 'axios';
import { cache } from './cache';

// ---------- Types: OIS.dk API ----------

export interface OisAdresse {
  id: string;
  tekst: string;
  forslagstekst: string;
}

export interface OisVurdering {
  id: number;
  vur_aar: number;
  vur_aendr_dato: string;
  ejd_vaerdi: number;
  grund_vaerdi: number;
  vur_benyt_tekst: string;
  ejd_vur_arl: number;
  lejl_ant_vur: number;
  vur_kreds_nr: number;
  vur_kreds_navn: string;
  vur_aend_tekst: string;
  datakilde: string;
  kommunekode: number;
}

export interface OisSalg {
  salg_id: string;
  hissalgMain: {
    omregnings_dato: string;
    slutseddel_dato: string;
    skoede_dato: string;
    modtagelse_dato: string;
    koebesum_beloeb: string;
    kontant_pris: string;
    kontant_koebesum: string;
    overdragelses_tekst: string;
    register: string;
    bfes_i_salg: string;
  };
}

export interface OisEjendomResponse {
  aktvurd: unknown | null;
  aktvurdVUR: {
    [kommunekode: string]: {
      aktvurdMainVUR: OisVurdering;
      grundvaerVURList: unknown[];
    };
  } | null;
  senestSalg: OisSalg | null;
  ejendomsskat: unknown | null;
  salgList: unknown[];
}

export interface OisEjendomData {
  bfeNummer: string;
  ejendomsvaerdi: number | null;
  grundvaerdi: number | null;
  vurderingsaar: number | null;
  senesteSalgKoebesum: number | null;
  senesteSalgDato: string | null;
  kommuneKode: number | null;
}

// ---------- Client ----------

const OIS_BASE_URL = 'https://www.ois.dk';

class OisClient {
  private http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: OIS_BASE_URL,
      timeout: 15000,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; ejendomsskat.dk/1.0)',
      },
    });
  }

  /**
   * Hent BFE-nummer fra adresse-ID.
   */
  async hentBfeFraAdresseId(adresseId: string): Promise<string | null> {
    try {
      const { data } = await this.http.get<string>(
        `/api/property/GetBFEFromAddressId?addressId=${encodeURIComponent(adresseId)}`
      );
      return data || null;
    } catch {
      return null;
    }
  }

  /**
   * Hent fuld ejendomsdata inkl. vurdering og salg via BFE-nummer.
   * Caches resultatet i 1 time da vurderingsdata sjældent ændrer sig.
   */
  async hentEjendomData(bfeNummer: string): Promise<OisEjendomData | null> {
    const cacheKey = `ois:ejendom:${bfeNummer}`;
    const cached = cache.get<OisEjendomData>(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.http.get<OisEjendomResponse>(
        `/api/svur/get?bfe=${encodeURIComponent(bfeNummer)}`
      );

      // Find første aktive vurdering (der er typisk kun én kommune)
      const vurdering = data.aktvurdVUR
        ? Object.values(data.aktvurdVUR)[0]?.aktvurdMainVUR
        : null;

      // Parse seneste salg
      let senesteSalgKoebesum: number | null = null;
      let senesteSalgDato: string | null = null;

      if (data.senestSalg?.hissalgMain) {
        const salg = data.senestSalg.hissalgMain;
        // Parse "10.250.000 DKK" format til tal - prøv kontant_koebesum først, derefter kontant_pris
        const koebesumTekst = salg.kontant_koebesum ?? salg.kontant_pris ?? '';
        const koebesumMatch = koebesumTekst.match(/([\d.]+)/);
        senesteSalgKoebesum = koebesumMatch
          ? parseInt(koebesumMatch[1].replace(/\./g, ''), 10)
          : null;
        senesteSalgDato = salg.skoede_dato ?? null;
      }

      const result = {
        bfeNummer,
        ejendomsvaerdi: vurdering?.ejd_vaerdi ?? null,
        grundvaerdi: vurdering?.grund_vaerdi ?? null,
        vurderingsaar: vurdering?.vur_aar ?? null,
        senesteSalgKoebesum,
        senesteSalgDato,
        kommuneKode: vurdering?.kommunekode ?? null,
      };

      // Gem i cache (1 time for ejendomsdata)
      cache.set(cacheKey, result, 60 * 60 * 1000);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Hent generel ejendomsinfo (BBR-data) via BFE-nummer.
   */
  async hentGenerelInfo(bfeNummer: string): Promise<Record<string, unknown> | null> {
    try {
      const { data } = await this.http.get<Record<string, unknown>>(
        `/api/property/GetGeneralInfoFromBFE?bfe=${encodeURIComponent(bfeNummer)}`
      );
      return data;
    } catch {
      return null;
    }
  }

  /**
   * Hent salgsdata for en række BFE-numre (til nabotjek).
   * Returnerer kun ejendomme med kendt salgspris.
   */
  async hentSalgsdataForBfeListe(bfeListe: string[]): Promise<OisEjendomData[]> {
    const resultater: OisEjendomData[] = [];

    // Begræns antal samtidige requests for at undgå at overbelaste OIS
    const batchSize = 5;
    for (let i = 0; i < bfeListe.length; i += batchSize) {
      const batch = bfeListe.slice(i, i + batchSize);
      const batchResultater = await Promise.all(
        batch.map((bfe) => this.hentEjendomData(bfe))
      );
      resultater.push(...batchResultater.filter((r): r is OisEjendomData => r !== null));

      // Vent 200ms mellem batches for at være høflig mod OIS
      if (i + batchSize < bfeListe.length) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    return resultater;
  }

  /**
   * Generer en liste af mulige BFE-numre i et område (til nabotjek).
   * BFE-numre er fortløbende inden for en kommune, så vi kan generere en sekvens.
   */
  genererBfeListe(basisBfe: string, antal: number = 20): string[] {
    const basisNummer = parseInt(basisBfe, 10);
    if (isNaN(basisNummer)) return [];

    const liste: string[] = [];
    const halvdel = Math.floor(antal / 2);

    for (let i = -halvdel; i <= halvdel; i++) {
      const bfe = basisNummer + i;
      if (bfe > 0) {
        liste.push(String(bfe));
      }
    }

    return liste;
  }

  /**
   * Find BFE-nummer for en adresse ved at søge i et interval og matche på adresse.
   * Bruger OIS's GetGeneralInfoFromBFE til at hente adresse for hver BFE.
   * Bruger parallelle requests for hastighed.
   */
  async findBfeFraAdresse(adresseTekst: string, intervalCenter?: string, intervalSize: number = 50): Promise<string | null> {
    const center = intervalCenter ? parseInt(intervalCenter, 10) : 100000;
    const halvdel = Math.floor(intervalSize / 2);
    const normaliseretAdresse = adresseTekst.toLowerCase().trim();

    // Generer liste af BFE'er at tjekke
    const bfeListe: number[] = [];
    for (let i = -halvdel; i <= halvdel; i++) {
      const bfe = center + i;
      if (bfe > 0) bfeListe.push(bfe);
    }

    // Søg i batches af 10 for hastighed
    const batchSize = 10;
    for (let i = 0; i < bfeListe.length; i += batchSize) {
      const batch = bfeListe.slice(i, i + batchSize);
      const resultater = await Promise.all(
        batch.map(async (bfe) => {
          const info = await this.hentGenerelInfo(String(bfe));
          if (!info) return null;

          const sfeInfo = info.GeneralInfoSFE as Record<string, unknown> | undefined;
          const ejlInfo = info.GeneralInfoEJL as Record<string, unknown> | undefined;
          const beliggenhed = String(sfeInfo?.beliggenhed ?? ejlInfo?.beliggenhed ?? '').toLowerCase();

          if (beliggenhed.includes(normaliseretAdresse) || normaliseretAdresse.includes(beliggenhed)) {
            return String(bfe);
          }
          return null;
        })
      );

      const fundet = resultater.find((r) => r !== null);
      if (fundet) return fundet;
    }

    return null;
  }

  /**
   * Hent BFE-numre i et geografisk område via DAR (kræver koordinater).
   * Returnerer BFE-numre for adresser inden for en given radius.
   */
  async hentBfeListeFraGeografi(
    koordinater: [number, number],
    radiusMeter: number,
    apiKey: string
  ): Promise<string[]> {
    try {
      // DAR understøtter ikke direkte geografisk søgning i GraphQL
      // Vi bruger en simpel tilgang: find adresser i samme postnummer
      // og filtrer derefter på afstand (hvis vi havde koordinater)
      // For nu returnerer vi en tom liste - dette kræver yderligere implementation
      console.warn('Geografisk BFE-søgning ikke implementeret endnu');
      return [];
    } catch (error) {
      console.error('Fejl ved geografisk BFE-søgning:', error);
      return [];
    }
  }
}

export const oisClient = new OisClient();

// ---------- Hjælpefunktioner ----------

export interface OisVurderingResult {
  ejendomsvaerdi2024: number | null;
  ejendomsvaerdi2025: number | null;
  grundvaerdi2024: number | null;
  grundvaerdi2025: number | null;
  beskatningsgrundlag2025: number | null;
  vurderingsaar: number | null;
}

/**
 * Konverter OIS data til vores standard vurderingsformat.
 * Beregner beskatningsgrundlag som 80% af ejendomsværdi (20% forsigtighedsfradrag).
 */
export function parseOisVurdering(data: OisEjendomData | null): OisVurderingResult {
  if (!data) {
    return {
      ejendomsvaerdi2024: null,
      ejendomsvaerdi2025: null,
      grundvaerdi2024: null,
      grundvaerdi2025: null,
      beskatningsgrundlag2025: null,
      vurderingsaar: null,
    };
  }

  const beskatningsgrundlag = data.ejendomsvaerdi
    ? Math.round(data.ejendomsvaerdi * 0.8)
    : null;

  // OIS returnerer typisk kun seneste vurdering. Vis den i relevant år-felt.
  const aar = data.vurderingsaar;

  return {
    ejendomsvaerdi2024: aar === 2024 ? data.ejendomsvaerdi : null,
    ejendomsvaerdi2025: aar === 2025 ? data.ejendomsvaerdi : (aar && aar < 2025 ? data.ejendomsvaerdi : null), // Vis ældre vurderinger som 2025 fallback
    grundvaerdi2024: aar === 2024 ? data.grundvaerdi : null,
    grundvaerdi2025: aar === 2025 ? data.grundvaerdi : (aar && aar < 2025 ? data.grundvaerdi : null), // Vis ældre vurderinger som 2025 fallback
    beskatningsgrundlag2025: aar === 2025 ? beskatningsgrundlag : (aar && aar < 2025 ? beskatningsgrundlag : null),
    vurderingsaar: aar,
  };
}
