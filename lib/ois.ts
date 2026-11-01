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
   * Hent BFE'er for adresser inden for en radius omkring et punkt.
   * Bruger DAR's geografiske søgning på Adressepunkt → husnummer → BFE via OIS.
   */
  async hentBfeListeFraGeografi(
    apiKey: string,
    x: number,
    y: number,
    radiusMeter: number = 300
  ): Promise<string[]> {
    try {
      // Byg buffer-polygon omkring punktet (kvadrat for simpelhed)
      const halv = radiusMeter;
      const minX = x - halv;
      const maxX = x + halv;
      const minY = y - halv;
      const maxY = y + halv;
      const wkt = `POLYGON((${minX} ${minY}, ${maxX} ${minY}, ${maxX} ${maxY}, ${minX} ${maxY}, ${minX} ${minY}))`;

      // 1. Find alle adressepunkter inden for radius
      const punkterResponse = await axios.post(
        `https://graphql.datafordeler.dk/DAR/v3?apiKey=${apiKey}`,
        {
          query: `
            query FindPunkter($wkt: String!) {
              DAR_Adressepunkt(
                where: { position: { within: { crs: 25832, wkt: $wkt } } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 50
              ) {
                nodes { id_lokalId }
              }
            }
          `,
          variables: { wkt },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const punktIds: string[] = (punkterResponse?.data?.data?.DAR_Adressepunkt?.nodes ?? [])
        .map((n: any) => n.id_lokalId)
        .filter(Boolean);

      if (punktIds.length === 0) return [];

      // 2. Find husnumre tilknyttet disse adressepunkter
      const husnummerResponse = await axios.post(
        `https://graphql.datafordeler.dk/DAR/v3?apiKey=${apiKey}`,
        {
          query: `
            query FindHusnumre($ids: [String!]!) {
              DAR_Husnummer(
                where: { adgangspunkt: { in: $ids } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 50
              ) {
                nodes { id_lokalId adgangsadressebetegnelse }
              }
            }
          `,
          variables: { ids: punktIds },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const husnumre = husnummerResponse?.data?.data?.DAR_Husnummer?.nodes ?? [];

      // 3. Hent BFE for hvert husnummer via OIS
      const bfeListe: string[] = [];
      for (const hus of husnumre.slice(0, 30)) {
        const bfe = await this.hentBfeFraAdresseId(hus.id_lokalId);
        if (bfe) bfeListe.push(bfe);
      }

      return [...new Set(bfeListe)];
    } catch (error) {
      console.error('Fejl ved geografisk BFE-søgning:', error);
      return [];
    }
  }

  /**
   * Hent koordinater for en adresse via DAR Adressepunkt.
   */
  async hentKoordinaterFraAdresseId(apiKey: string, adresseIdLokalId: string): Promise<{ x: number; y: number } | null> {
    try {
      // Find først husnummer for adressen
      const adresseResponse = await axios.post(
        `https://graphql.datafordeler.dk/DAR/v3?apiKey=${apiKey}`,
        {
          query: `
            query HentHusnummer($id: String!) {
              DAR_Adresse(
                where: { id_lokalId: { eq: $id } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes { husnummer }
              }
            }
          `,
          variables: { id: adresseIdLokalId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const husnummerId = adresseResponse?.data?.data?.DAR_Adresse?.nodes?.[0]?.husnummer;
      if (!husnummerId) return null;

      // Find adressepunkt for husnummeret
      const punktResponse = await axios.post(
        `https://graphql.datafordeler.dk/DAR/v3?apiKey=${apiKey}`,
        {
          query: `
            query HentPunkt($id: String!) {
              DAR_Husnummer(
                where: { id_lokalId: { eq: $id } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes { adgangspunkt }
              }
            }
          `,
          variables: { id: husnummerId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const adgangspunktId = punktResponse?.data?.data?.DAR_Husnummer?.nodes?.[0]?.adgangspunkt;
      if (!adgangspunktId) return null;

      // Hent selve punktet
      const geoResponse = await axios.post(
        `https://graphql.datafordeler.dk/DAR/v3?apiKey=${apiKey}`,
        {
          query: `
            query HentGeometri($id: String!) {
              DAR_Adressepunkt(
                where: { id_lokalId: { eq: $id } }
                virkningstid: "2026-01-01T00:00:00Z"
                first: 1
              ) {
                nodes { position { wkt crs } }
              }
            }
          `,
          variables: { id: adgangspunktId },
        },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const wkt = geoResponse?.data?.data?.DAR_Adressepunkt?.nodes?.[0]?.position?.wkt;
      if (!wkt) return null;

      // Parse "POINT (591940.12 6143533.62)"
      const match = wkt.match(/POINT\s*\(\s*([\d.]+)\s+([\d.]+)\s*\)/);
      if (!match) return null;

      return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
    } catch (error) {
      console.error('Fejl ved hentning af koordinater:', error);
      return null;
    }
  }

  /**
   * Hent ejendomsstruktur fra GetPropertyFromBFE (SFE, EJL-intervaller).
   */
  async hentEjendomStruktur(bfe: string): Promise<{ bfe: number; sfeBfe: number | null; ejlBfe: number | null; ejlInterval: string } | null> {
    const cacheKey = `ois:struktur:${bfe}`;
    const cached = cache.get<{ bfe: number; sfeBfe: number | null; ejlBfe: number | null; ejlInterval: string }>(cacheKey);
    if (cached) return cached;

    try {
      const { data } = await this.http.get<Record<string, unknown>>(
        `/api/property/GetPropertyFromBFE?bfe=${encodeURIComponent(bfe)}`
      );

      const result = {
        bfe: Number(data.bfe ?? bfe),
        sfeBfe: data.sfe_bfe ? Number(data.sfe_bfe) : null,
        ejlBfe: data.ejl_bfe ? Number(data.ejl_bfe) : null,
        ejlInterval: String(data.ejlBfes ?? ''),
      };

      cache.set(cacheKey, result, 60 * 60 * 1000);
      return result;
    } catch {
      return null;
    }
  }

  /**
   * Find den korrekte EJL-BFE for en adresse inden for et SFE-interval.
   * Matcher adressebetegnelse mod hver EJL's beliggenhed.
   */
  async findEjlBfeForAdresse(sfeBfe: string, adresseTekst: string): Promise<string | null> {
    const struktur = await this.hentEjendomStruktur(sfeBfe);
    if (!struktur?.ejlInterval) return null;

    // Parse interval "123454-123465"
    const match = struktur.ejlInterval.match(/^(\d+)-(\d+)$/);
    if (!match) return null;

    const start = parseInt(match[1], 10);
    const slut = parseInt(match[2], 10);
    if (slut - start > 200) return null; // for stort interval

    const normaliseret = adresseTekst.toLowerCase();

    // Søg i batches for hastighed
    const bfeListe: string[] = [];
    for (let i = start; i <= slut; i++) bfeListe.push(String(i));

    const batchSize = 10;
    for (let i = 0; i < bfeListe.length; i += batchSize) {
      const batch = bfeListe.slice(i, i + batchSize);
      const resultater = await Promise.all(
        batch.map(async (bfe) => {
          const info = await this.hentGenerelInfo(bfe);
          if (!info) return null;
          const ejlInfo = info.GeneralInfoEJL as Record<string, unknown> | undefined;
          const sfeInfo = info.GeneralInfoSFE as Record<string, unknown> | undefined;
          // OIS staver feltet "beligenhed" (med én g)
          const beliggenhed = String(ejlInfo?.beligenhed ?? sfeInfo?.beligenhed ?? '').toLowerCase();
          // Match på fuld adresse (vej + husnr + evt. etage/dør)
          if (beliggenhed && this.adresseMatch(normaliseret, beliggenhed)) {
            return bfe;
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
   * Sammenlign to adressetekster (tolerant mod etage/dør-forskelle).
   */
  private adresseMatch(soegt: string, fundet: string): boolean {
    // Udtræk vejnavn + husnr fra begge
    const parse = (s: string) => {
      const m = s.match(/^(.+?)\s+(\d+[A-Za-z]?)/);
      return m ? { vej: m[1].toLowerCase().trim(), nr: m[2].toLowerCase() } : null;
    };
    const a = parse(soegt);
    const b = parse(fundet);
    if (!a || !b) return false;
    return a.vej === b.vej && a.nr === b.nr;
  }

  /**
   * Søg efter adresser i OIS.
   * OIS har en intern søgefunktion der returnerer adresser med BFE-numre.
   */
  async soegAdresse(query: string, limit = 10): Promise<OisAdresse[]> {
    try {
      // OIS's søge-endpoint returnerer HTML, ikke JSON
      // Vi bruger deres Property/Search og parser resultatet
      const { data } = await this.http.get<string>(
        `/Property/Search?searchText=${encodeURIComponent(query)}`,
        {
          headers: {
            Accept: 'text/html',
          },
        }
      );

      // OIS returnerer en React-app, så vi kan ikke parse HTML direkte
      // I stedet bruger vi deres API til at hente BFE fra adresse
      // For nu returnerer vi en tom liste - implementeres når vi finder deres søge-API
      console.warn('OIS adresse-søgning ikke implementeret endnu');
      return [];
    } catch {
      return [];
    }
  }

  /**
   * Hent BFE-nummer fra adresse-tekst.
   * Bruger OIS's GetBFEFromAddressId hvis vi har et addressId.
   */
  async hentBfeFraAdresseTekst(adresseTekst: string): Promise<string | null> {
    // OIS har ikke en direkte adresse-til-BFE API
    // Vi skal først finde addressId via deres søgefunktion
    // For nu returnerer vi null - implementeres når vi finder deres søge-API
    return null;
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
          // OIS staver feltet "beligenhed" (med én g)
          const beliggenhed = String(sfeInfo?.beligenhed ?? ejlInfo?.beligenhed ?? '').toLowerCase();

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
